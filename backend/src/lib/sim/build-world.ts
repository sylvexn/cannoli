/**
 * buildSimWorld — construct the season-simulator world.
 *
 * The Cannoli mock deployment is an interactive season SIMULATOR populated with
 * fully fictional data (no real coaches, no real teams). This builder produces
 * that world from scratch:
 *
 *   • system accounts (syl/root) + a `demo` admin user
 *   • site settings, pin definitions, move categories
 *   • the real Pokemon reference table (tiers/costs/types) via importPokemonOnly
 *   • a FINISHED fictional season — 3 gem leagues, drafted, full regular season,
 *     playoffs played out, champions crowned, finish positions stamped, pins
 *     minted, phase = offseason
 *   • a LIVE fictional season — 3 gem leagues, drafted, regular season played
 *     through week 4, phase = regular
 *
 * Everything is deterministic: a `MockRng(masterSeed)` seeds the world and each
 * league derives its own sub-seed, so the same masterSeed always rebuilds the
 * identical world. This function is exported (not CLI-bound) so a future
 * sim-reset API route can call it directly after wiping the DB.
 *
 * MOCK-ONLY. The sim core asserts mock mode on every writer; this builder is
 * never run against the live deployment.
 */
import { db, schema, sqlite } from '../../db';
import { eq } from 'drizzle-orm';
import { hashSync } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { tx } from '../tx';
import { simulateDraft } from './simulate-draft';
import { simulateSeason, simulatePlayoffs } from './simulate-season';
import { MockRng } from './mock-rng';
import { generateCoachName, generateTeam, UniqueNamer } from './fictional-data';
import { assertMockMode } from './sim-guard';
import {
  seedSystemAccounts,
  seedSiteSettings,
  seedPinDefinitions,
  seedMoveCategories,
} from '../../../scripts/seed-helpers';
import { importPokemonOnly, assignFinishPositions } from '../../../scripts/import-xlsx';
import { runAutoAwards } from '../pins/auto-award';
import { mintArchivePins } from '../pins/archive-mint';
import { seedLeagueTrades } from './seed-trades';

// Tunables

/** Default master seed — fixed so `bun run seed:sim` is reproducible. */
export const DEFAULT_SIM_SEED = 0xcafe;

const TEAMS_PER_LEAGUE = 12;
const ROSTER_SIZE = 10;
const PLAYOFF_TEAMS = 6;
const POINT_CAP = 110;
const TERA_CAPTAIN_SLOTS = 2;
const LIVE_THROUGH_WEEK = 4;

/** The three gem leagues, in display order. */
const GEMS = [
  { gem: 'sapphire', name: 'Sapphire League', color: '#2563eb' },
  { gem: 'ruby', name: 'Ruby League', color: '#dc2626' },
  { gem: 'emerald', name: 'Emerald League', color: '#16a34a' },
] as const;

export interface SimWorldLeagueSummary {
  leagueId: string;
  teams: number;
  picks: number;
  regularMatches: number;
  playoffMatches: number;
  championId: string | null;
}

export interface SimWorldSeasonSummary {
  seasonId: number;
  seasonNumber: number;
  status: 'finished' | 'live';
  leagues: SimWorldLeagueSummary[];
}

export interface BuildSimWorldResult {
  masterSeed: number;
  demoUserId: number;
  seasons: SimWorldSeasonSummary[];
  totals: { seasons: number; leagues: number; teams: number; matches: number };
}

// Helpers

/**
 * Derive a stable per-(season,gem) sub-seed from the master seed so each
 * league simulates independently yet reproducibly.
 */
function subSeed(master: number, seasonNumber: number, gemIndex: number): number {
  let h = (master >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ seasonNumber, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (gemIndex + 1), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Slug a fictional coach name into a unique lowercase username. */
function coachUsername(coachName: string, taken: Set<string>): string {
  const base = coachName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'coach';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}${n++}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Create one fictional season + its three gem leagues, each with
 * `TEAMS_PER_LEAGUE` fictional teams/coaches and a fictional user per coach.
 * Leagues land in phase='draft' with a populated draftOrder, ready for
 * `simulateDraft`. Returns the season id + per-league team-id lists.
 */
function createFictionalSeason(opts: {
  seasonNumber: number;
  rng: MockRng;
  usernamesTaken: Set<string>;
  weekDates: Record<string, string>;
  draftDate: string;
}): { seasonId: number; leagues: { leagueId: string; teamIds: string[] }[] } {
  const { seasonNumber, rng, usernamesTaken, weekDates, draftDate } = opts;

  // Names are deduped within a season so no two leagues collide.
  const coachNamer = new UniqueNamer();
  const teamNamer = new UniqueNamer();

  return tx(() => {
    const season = db.insert(schema.seasons).values({
      seasonNumber,
      pointCap: POINT_CAP,
      teraCaptainSlots: TERA_CAPTAIN_SLOTS,
    }).returning().get();

    const leagues: { leagueId: string; teamIds: string[] }[] = [];

    for (let gi = 0; gi < GEMS.length; gi++) {
      const gem = GEMS[gi]!;
      // Season-namespaced league id so S-finished and S-live don't collide.
      const leagueId = `s${seasonNumber}-${gem.gem}`;

      // League row first — teams.leagueId is an FK onto it. draftOrder is
      // backfilled below once the teams exist.
      db.insert(schema.leagues).values({
        id: leagueId,
        name: gem.name,
        color: gem.color,
        seasonId: season.id,
        draftDate,
        playoffTeamCount: PLAYOFF_TEAMS,
        phase: 'draft',
        currentWeek: 0,
        totalWeeks: TEAMS_PER_LEAGUE - 1,
        rosterSize: ROSTER_SIZE,
        weekDates: JSON.stringify(weekDates),
        weekDatesAutoFilled: true,
      }).run();

      const teamIds: string[] = [];
      for (let ti = 0; ti < TEAMS_PER_LEAGUE; ti++) {
        const coachName = coachNamer.take(() => generateCoachName(rng));
        // generateTeam returns name+abbrev+colors together. UniqueNamer.take
        // dedupes on the team name; we regenerate the whole identity each
        // retry and capture the last-generated object via a closure.
        let identity = generateTeam(rng, gem.gem);
        teamNamer.take(() => {
          identity = generateTeam(rng, gem.gem);
          return identity.teamName;
        });

        // Fictional user for this coach (role 'user'). Pins attach to users
        // via team.userId, so every team needs a real account behind it.
        const username = coachUsername(coachName, usernamesTaken);
        const user = db.insert(schema.users).values({
          username,
          passwordHash: hashSync(randomBytes(12).toString('hex'), 10),
          role: 'user',
          mustChangePassword: false,
          active: true,
          displayName: coachName,
          primaryColor: identity.teamColor,
          secondaryColor: identity.secondaryColor,
        }).returning().get();

        const teamId = `${leagueId}-t${ti + 1}`;
        db.insert(schema.teams).values({
          id: teamId,
          leagueId,
          userId: user.id,
          coachName,
          teamName: identity.teamName,
          teamAbbrev: identity.teamAbbrev,
          teamColor: identity.teamColor,
        }).run();
        teamIds.push(teamId);
      }

      // Snake-draft order is the team list shuffled once.
      const draftOrder = rng.shuffle(teamIds);
      db.update(schema.leagues)
        .set({ draftOrder: JSON.stringify(draftOrder) })
        .where(eq(schema.leagues.id, leagueId))
        .run();

      leagues.push({ leagueId, teamIds });
    }

    return { seasonId: season.id, leagues };
  });
}

/** Snap a date BACK to the most-recent Tuesday — the start of a league week,
 *  which runs Tuesday→Monday. */
function snapToTuesday(d: Date): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() - 2 + 7) % 7));
  return out;
}

/** Build a {week → ISO date} map: week 1 on `week1`, +7d per week. */
function buildWeekDates(week1: Date, weeks: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let w = 1; w <= weeks; w++) {
    const d = new Date(week1);
    d.setUTCDate(d.getUTCDate() + (w - 1) * 7);
    out[String(w)] = d.toISOString().slice(0, 10);
  }
  return out;
}

/**
 * Seed a randomized player-availability grid for one league's teams across the
 * current week ± 2. Deterministic given `rng`. Mirrors seed.ts's pattern.
 */
function seedAvailability(leagueId: string, currentWeek: number, weekDates: Record<string, string>, rng: MockRng): number {
  const teams = sqlite.prepare(
    `SELECT id FROM teams WHERE league_id = ?`,
  ).all(leagueId) as { id: string }[];

  const STATUS_W: Array<'available' | 'maybe' | 'unavailable'> = ['available', 'maybe', 'unavailable'];
  const pickStatus = (weekend: boolean) => {
    const weights = weekend ? [0.75, 0.18, 0.07] : [0.4, 0.3, 0.3];
    const r = rng.next();
    let acc = 0;
    for (let i = 0; i < 3; i++) {
      acc += weights[i]!;
      if (r < acc) return STATUS_W[i]!;
    }
    return STATUS_W[0]!;
  };
  const NOTES_BUSY = ['out of town', 'work shift', 'family event', 'travel day', null, null];
  const NOTES_MAYBE = ['after 8pm', 'might be late', 'depends on day-of', null, null, null];

  const insert = sqlite.prepare(
    `INSERT INTO player_availability (team_id, league_id, week, day, status, note) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  const weeks = [currentWeek - 2, currentWeek - 1, currentWeek, currentWeek + 1, currentWeek + 2].filter((w) => w >= 1);
  const run = sqlite.transaction(() => {
    for (const team of teams) {
      for (const week of weeks) {
        const wd = weekDates[String(week)];
        const start = wd ? new Date(wd + 'T00:00:00Z') : new Date();
        for (let i = 0; i < 7; i++) {
          if (rng.next() < 0.1) continue; // ~10% gaps
          const d = new Date(start);
          d.setUTCDate(d.getUTCDate() + i);
          const dow = d.getUTCDay();
          const weekend = dow === 0 || dow === 6;
          const status = pickStatus(weekend);
          let note: string | null = null;
          if (status === 'unavailable') note = rng.pick(NOTES_BUSY);
          else if (status === 'maybe') note = rng.pick(NOTES_MAYBE);
          insert.run(team.id, leagueId, week, d.toISOString().slice(0, 10), status, note);
          inserted++;
        }
      }
    }
  });
  run();
  return inserted;
}

// Entry point

/**
 * Build the full simulator world. Assumes the DB is freshly migrated and empty
 * (the CLI `seed-sim.ts` wipes it first; the future reset API route does the
 * same). Returns a structured summary for logging.
 */
export function buildSimWorld(opts: { masterSeed?: number } = {}): BuildSimWorldResult {
  assertMockMode();

  const masterSeed = (opts.masterSeed ?? DEFAULT_SIM_SEED) >>> 0;
  console.log(`\nBuilding simulator world (masterSeed=0x${masterSeed.toString(16)})…`);

  // Disable FK enforcement for the bulk build (this is a trusted, mock-only,
  // full-rebuild operation — the same posture as the XLSX importer). NB: the
  // playoff bracket now stores not-yet-determined SF/F slots as NULL (FK-safe),
  // so this is no longer strictly required for the bracket, but we keep it for
  // the broader bulk insert/delete ordering. Re-enabled in the finally below.
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    return buildSimWorldInner(masterSeed);
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

/** Inner builder — runs with FK enforcement off (see {@link buildSimWorld}). */
function buildSimWorldInner(masterSeed: number): BuildSimWorldResult {

  // Base data
  seedSystemAccounts(sqlite, db);
  seedSiteSettings(sqlite, db);
  // Sim-only welcome notice, now an announcement (site_settings.announcement
  // was retired when the announcement systems unified). 'both' surface → shows
  // as the site-wide banner and in the notifications bell.
  db.insert(schema.announcements).values({
    title: 'Welcome to the simulator',
    body: 'Welcome to the Cannoli season simulator — every coach, team, and result here is fictional.',
    category: 'info',
    surface: 'both',
  }).run();
  seedPinDefinitions(sqlite, db);
  seedMoveCategories(sqlite, db);

  // demo admin user (login is via a separate demo-session endpoint)
  let demoUser = db.select().from(schema.users)
    .where(eq(schema.users.username, 'demo')).get();
  if (!demoUser) {
    demoUser = db.insert(schema.users).values({
      username: 'demo',
      // Unusable password — the demo-session endpoint never password-checks.
      passwordHash: hashSync(randomBytes(24).toString('hex'), 10),
      role: 'admin',
      mustChangePassword: false,
      active: true,
      displayName: 'Demo Admin',
    }).returning().get();
    console.log('  Created: demo (admin)');
  } else {
    console.log('  demo user already exists, skipping.');
  }

  // Pokemon reference data
  importPokemonOnly(sqlite);

  const usernamesTaken = new Set<string>(
    (sqlite.prepare('SELECT username FROM users').all() as { username: string }[])
      .map((u) => u.username.toLowerCase()),
  );

  const rng = new MockRng(masterSeed);
  const seasons: SimWorldSeasonSummary[] = [];

  // FINISHED season
  // Season number 1 of the simulator world. Drafted last autumn, fully played.
  {
    const seasonNumber = 1;
    console.log(`\n── Finished season (S${seasonNumber}) ──`);
    // 2025-09-09 is a Tuesday — league weeks run Tuesday→Monday.
    const weekDates = buildWeekDates(new Date(Date.UTC(2025, 8, 9)), TEAMS_PER_LEAGUE - 1);
    const { seasonId, leagues } = createFictionalSeason({
      seasonNumber,
      rng,
      usernamesTaken,
      weekDates,
      draftDate: '2025-09-01T19:00:00Z',
    });

    const leagueSummaries: SimWorldLeagueSummary[] = [];
    for (let gi = 0; gi < leagues.length; gi++) {
      const { leagueId } = leagues[gi]!;
      const leagueRng = new MockRng(subSeed(masterSeed, seasonNumber, gi));

      const draft = simulateDraft(leagueId, leagueRng);
      if (!draft.success) throw new Error(`[${leagueId}] draft failed: ${draft.error}`);

      const season = simulateSeason({ leagueId, rng: leagueRng });
      if (!season.success) throw new Error(`[${leagueId}] season failed: ${season.error}`);

      const playoffs = simulatePlayoffs(leagueId, leagueRng);
      if (!playoffs.success) throw new Error(`[${leagueId}] playoffs failed: ${playoffs.error}`);

      // simulatePlayoffs already flips the league to phase='offseason'.
      // Stamp finish positions from the played-out bracket so standings +
      // profile badges render. generatePlayoffBracket set teams.rank.
      assignFinishPositions(sqlite, [leagueId]);

      // Mint season-end + archive pins (champion / sweeper / high-score / …).
      runAutoAwards(leagueId, { trigger: 'season-end' });
      mintArchivePins(leagueId);

      // Historical trade activity — a finished season has only accepted
      // (completed) trades + trade-block listings, no open proposals.
      const trades = seedLeagueTrades(leagueId, leagueRng, true, TEAMS_PER_LEAGUE - 1);
      console.log(
        `    ${leagueId}: ${trades.accepted} accepted trades, ${trades.listings} block listings`,
      );

      const counts = sqlite.prepare(
        `SELECT phase, COUNT(*) c FROM matches WHERE league_id = ? GROUP BY phase`,
      ).all(leagueId) as { phase: string; c: number }[];
      const reg = counts.find((c) => c.phase === 'regular')?.c ?? 0;
      const po = counts.find((c) => c.phase === 'playoffs')?.c ?? 0;

      console.log(
        `  ${leagueId}: ${draft.picks} picks, ${season.matchesPlayed} regular, ` +
        `${playoffs.matchesPlayed} playoff, champion=${playoffs.championId}`,
      );
      leagueSummaries.push({
        leagueId, teams: TEAMS_PER_LEAGUE, picks: draft.picks,
        regularMatches: reg, playoffMatches: po, championId: playoffs.championId,
      });
    }

    // Archive the finished season. Done LAST — after every per-league write
    // (finish positions, pin minting, trade seeding) has completed — so the
    // route-level archive-write guards never fire mid-build. archived=1 makes
    // S1 a read-only history surface: it powers the /archive pages and gates
    // coach "past seasons" history (users.ts pastTeams on seasonArchived).
    db.update(schema.seasons)
      .set({ archived: true })
      .where(eq(schema.seasons.id, seasonId))
      .run();
    console.log(`  Season ${seasonNumber} archived (read-only history).`);

    seasons.push({ seasonId, seasonNumber, status: 'finished', leagues: leagueSummaries });
  }

  // LIVE season
  // Season 2: drafted, regular season played through week 4, still running.
  {
    const seasonNumber = 2;
    console.log(`\n── Live season (S${seasonNumber}) ──`);
    // Week 1 sits ~3 weeks in the past so week 4 reads as "this week". Anchor
    // to a Tuesday so the sim's weeks run Tuesday→Monday like the live league.
    const week1 = snapToTuesday(new Date());
    week1.setUTCDate(week1.getUTCDate() - (LIVE_THROUGH_WEEK - 1) * 7);
    week1.setUTCHours(0, 0, 0, 0);
    const weekDates = buildWeekDates(week1, TEAMS_PER_LEAGUE - 1);
    const draftDateD = new Date(week1);
    draftDateD.setUTCDate(draftDateD.getUTCDate() - 7);

    const { seasonId, leagues } = createFictionalSeason({
      seasonNumber,
      rng,
      usernamesTaken,
      weekDates,
      draftDate: draftDateD.toISOString(),
    });

    const leagueSummaries: SimWorldLeagueSummary[] = [];
    for (let gi = 0; gi < leagues.length; gi++) {
      const { leagueId } = leagues[gi]!;
      const leagueRng = new MockRng(subSeed(masterSeed, seasonNumber, gi));

      const draft = simulateDraft(leagueId, leagueRng);
      if (!draft.success) throw new Error(`[${leagueId}] draft failed: ${draft.error}`);

      const season = simulateSeason({ leagueId, throughWeek: LIVE_THROUGH_WEEK, rng: leagueRng });
      if (!season.success) throw new Error(`[${leagueId}] season failed: ${season.error}`);

      // Leave the league mid-season: phase='regular', pointer at week 4.
      seedAvailability(leagueId, LIVE_THROUGH_WEEK, weekDates, leagueRng);

      // Live trade activity — accepted (history) + open pending proposals +
      // trade-block listings. Trades stamp weeks within the played range.
      const trades = seedLeagueTrades(leagueId, leagueRng, false, LIVE_THROUGH_WEEK);
      console.log(
        `    ${leagueId}: ${trades.accepted} accepted, ${trades.pending} pending, ` +
        `${trades.listings} block listings`,
      );

      const reg = (sqlite.prepare(
        `SELECT COUNT(*) c FROM matches WHERE league_id = ? AND phase = 'regular'`,
      ).get(leagueId) as { c: number }).c;

      console.log(
        `  ${leagueId}: ${draft.picks} picks, ${season.matchesPlayed} matches played ` +
        `through week ${season.throughWeek} (${reg} total scheduled)`,
      );
      leagueSummaries.push({
        leagueId, teams: TEAMS_PER_LEAGUE, picks: draft.picks,
        regularMatches: reg, playoffMatches: 0, championId: null,
      });
    }

    seasons.push({ seasonId, seasonNumber, status: 'live', leagues: leagueSummaries });
  }

  // Totals
  const totals = {
    seasons: (sqlite.prepare('SELECT COUNT(*) c FROM seasons').get() as { c: number }).c,
    leagues: (sqlite.prepare('SELECT COUNT(*) c FROM leagues').get() as { c: number }).c,
    teams: (sqlite.prepare('SELECT COUNT(*) c FROM teams').get() as { c: number }).c,
    matches: (sqlite.prepare('SELECT COUNT(*) c FROM matches').get() as { c: number }).c,
  };

  return { masterSeed, demoUserId: demoUser.id, seasons, totals };
}
