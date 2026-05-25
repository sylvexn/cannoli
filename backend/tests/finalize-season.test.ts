/**
 * Launch-readiness tests for season finalization — the pipeline that runs at
 * the end of the platform's first live season (S11).
 *
 * `scripts/finalize-season.ts` performs five DB writes per league: score any
 * pending finals (4-3, higher seed wins), stamp finish positions, advance the
 * phase to offseason, and mark the season `archived = 1`. It is documented as
 * **idempotent** and must archive S11 *alongside* the already-archived S9/S10
 * without disturbing them.
 *
 * Two failure modes this guards against:
 *  1. Re-running finalize re-scores or double-stamps a season.
 *  2. Finalizing S11 accidentally flips S9/S10 back to un-archived (or the
 *     reverse — archiving everything indiscriminately).
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * The high-value cores are pure-but-DB-bound: `assignFinishPositions` (exported
 * from `scripts/import-xlsx.ts`) operates over only the `teams` and `matches`
 * tables, and the score-pending-finals + archive steps are plain scoped SQL.
 * We build a minimal self-contained `bun:sqlite` Database (`:memory:`) with
 * just the columns those steps touch, exercise them directly, and assert
 * idempotency + archive isolation. No app DB, no seed, no migrations.
 */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { assignFinishPositions } from '../scripts/import-xlsx';

// ─── Minimal fixture schema ──────────────────────────────────────────────────
// Only the columns finalize-season.ts / assignFinishPositions actually read or
// write. Kept deliberately tiny and self-contained.

function makeDb(): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE seasons (
      id            INTEGER PRIMARY KEY,
      season_number INTEGER NOT NULL,
      archived      INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE leagues (
      id        TEXT PRIMARY KEY,
      season_id INTEGER NOT NULL,
      phase     TEXT NOT NULL
    );
    CREATE TABLE teams (
      id              TEXT PRIMARY KEY,
      league_id       TEXT NOT NULL,
      rank            INTEGER,
      finish_position INTEGER,
      finish_label    TEXT
    );
    CREATE TABLE matches (
      id            TEXT PRIMARY KEY,
      league_id     TEXT NOT NULL,
      phase         TEXT NOT NULL,
      playoff_round TEXT,
      home_team_id  TEXT NOT NULL,
      away_team_id  TEXT NOT NULL,
      home_seed     INTEGER,
      away_seed     INTEGER,
      home_score    INTEGER,
      away_score    INTEGER,
      status        TEXT NOT NULL DEFAULT 'scheduled',
      completed_at  TEXT
    );
  `);
  return db;
}

/** Insert a season row. */
function addSeason(db: Database, id: number, num: number, archived = 0) {
  db.prepare(`INSERT INTO seasons (id, season_number, archived) VALUES (?, ?, ?)`)
    .run(id, num, archived);
}

/** Insert a league plus its 10 teams (rank 1-10) and return team ids. */
function addLeagueWithTeams(db: Database, leagueId: string, seasonId: number, phase = 'playoffs'): string[] {
  db.prepare(`INSERT INTO leagues (id, season_id, phase) VALUES (?, ?, ?)`)
    .run(leagueId, seasonId, phase);
  const ids: string[] = [];
  for (let r = 1; r <= 10; r++) {
    const tid = `${leagueId}-t${r}`;
    db.prepare(`INSERT INTO teams (id, league_id, rank) VALUES (?, ?, ?)`)
      .run(tid, leagueId, r);
    ids.push(tid);
  }
  return ids;
}

/** Insert a playoff match. */
function addPlayoffMatch(
  db: Database,
  id: string,
  leagueId: string,
  round: 'qf' | 'sf' | 'f',
  home: string,
  away: string,
  homeScore: number | null,
  awayScore: number | null,
  opts: { homeSeed?: number; awaySeed?: number; status?: string } = {},
) {
  db.prepare(
    `INSERT INTO matches
       (id, league_id, phase, playoff_round, home_team_id, away_team_id,
        home_seed, away_seed, home_score, away_score, status)
     VALUES (?, ?, 'playoffs', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, leagueId, round, home, away,
    opts.homeSeed ?? null, opts.awaySeed ?? null,
    homeScore, awayScore, opts.status ?? (homeScore != null ? 'completed' : 'scheduled'),
  );
}

function teamFinish(db: Database, teamId: string): { pos: number | null; label: string | null } {
  const row = db.prepare(`SELECT finish_position AS pos, finish_label AS label FROM teams WHERE id = ?`)
    .get(teamId) as { pos: number | null; label: string | null };
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. assignFinishPositions — placement labels
// ─────────────────────────────────────────────────────────────────────────────

describe('assignFinishPositions', () => {
  test('stamps champion / runner-up / SF / QF / regular labels', () => {
    const db = makeDb();
    addSeason(db, 11, 11);
    const t = addLeagueWithTeams(db, 'sapphire', 11);
    // Bracket: QF (t5 v t8, t6 v t7) → SF (t1 v t8, t2 v t7) → F (t1 v t2).
    addPlayoffMatch(db, 'qf1', 'sapphire', 'qf', t[4], t[7], 4, 1); // t5 beats t8
    addPlayoffMatch(db, 'qf2', 'sapphire', 'qf', t[5], t[6], 1, 4); // t7 beats t6
    addPlayoffMatch(db, 'sf1', 'sapphire', 'sf', t[0], t[4], 4, 2); // t1 beats t5
    addPlayoffMatch(db, 'sf2', 'sapphire', 'sf', t[1], t[6], 4, 0); // t2 beats t7
    addPlayoffMatch(db, 'f1',  'sapphire', 'f',  t[0], t[1], 4, 3); // t1 champion

    const out = assignFinishPositions(db, ['sapphire']);
    expect(out.teamsUpdated).toBe(10);

    expect(teamFinish(db, t[0])).toEqual({ pos: 1, label: 'Champion' });
    expect(teamFinish(db, t[1])).toEqual({ pos: 2, label: 'Runner-up' });
    // SF losers: t5 and t7.
    expect(teamFinish(db, t[4])).toEqual({ pos: 3, label: 'Semifinalist' });
    expect(teamFinish(db, t[6])).toEqual({ pos: 3, label: 'Semifinalist' });
    // QF losers: t8 and t6.
    expect(teamFinish(db, t[7])).toEqual({ pos: 5, label: 'Quarterfinalist' });
    expect(teamFinish(db, t[5])).toEqual({ pos: 5, label: 'Quarterfinalist' });
    // Non-playoff teams (rank 9-10) get sequential Regular Season positions.
    expect(teamFinish(db, t[8]).label).toBe('Regular Season');
    expect(teamFinish(db, t[9]).label).toBe('Regular Season');
  });

  test('is idempotent — re-running yields identical placements', () => {
    const db = makeDb();
    addSeason(db, 11, 11);
    const t = addLeagueWithTeams(db, 'ruby', 11);
    addPlayoffMatch(db, 'f1', 'ruby', 'f', t[0], t[1], 4, 3);

    const first = assignFinishPositions(db, ['ruby']);
    const snapshot = t.map(id => teamFinish(db, id));

    const second = assignFinishPositions(db, ['ruby']);
    expect(second.teamsUpdated).toBe(first.teamsUpdated);
    expect(t.map(id => teamFinish(db, id))).toEqual(snapshot);
  });

  test('skips unscored playoff matches (no champion stamped)', () => {
    const db = makeDb();
    addSeason(db, 11, 11);
    const t = addLeagueWithTeams(db, 'emerald', 11);
    addPlayoffMatch(db, 'f1', 'emerald', 'f', t[0], t[1], null, null);

    assignFinishPositions(db, ['emerald']);
    // No decided final → nobody is Champion; everyone falls to Regular Season.
    expect(teamFinish(db, t[0]).label).toBe('Regular Season');
    expect(teamFinish(db, t[1]).label).toBe('Regular Season');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Score-pending-finals logic — higher seed wins 4-3
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors the score step in finalize-season.ts: a scheduled finals match with
// NULL scores is stamped 4-3 in favour of the better (lower-numbered) seed.

/** The exact rule finalize-season.ts uses to decide the synthetic finals score. */
function scoreFinals(homeSeed: number | null, awaySeed: number | null): { home: number; away: number } {
  const homeBetter = homeSeed != null && awaySeed != null ? homeSeed <= awaySeed : true;
  return { home: homeBetter ? 4 : 3, away: homeBetter ? 3 : 4 };
}

describe('score-pending-finals', () => {
  test('higher-seeded home team wins 4-3', () => {
    expect(scoreFinals(1, 2)).toEqual({ home: 4, away: 3 });
  });

  test('higher-seeded away team wins 3-4', () => {
    expect(scoreFinals(3, 1)).toEqual({ home: 3, away: 4 });
  });

  test('equal seeds default to the home team', () => {
    expect(scoreFinals(2, 2)).toEqual({ home: 4, away: 3 });
  });

  test('missing seed data defaults to the home team', () => {
    expect(scoreFinals(null, 4)).toEqual({ home: 4, away: 3 });
    expect(scoreFinals(2, null)).toEqual({ home: 4, away: 3 });
  });

  test('a stamped finals result drives assignFinishPositions correctly', () => {
    const db = makeDb();
    addSeason(db, 11, 11);
    const t = addLeagueWithTeams(db, 'topaz', 11);
    // Finals scheduled, NULL scores, home is the better seed.
    addPlayoffMatch(db, 'f1', 'topaz', 'f', t[0], t[1], null, null,
      { homeSeed: 1, awaySeed: 2, status: 'scheduled' });

    const { home, away } = scoreFinals(1, 2);
    db.prepare(
      `UPDATE matches SET home_score = ?, away_score = ?, status = 'completed' WHERE id = 'f1'`,
    ).run(home, away);

    assignFinishPositions(db, ['topaz']);
    expect(teamFinish(db, t[0])).toEqual({ pos: 1, label: 'Champion' });
    expect(teamFinish(db, t[1])).toEqual({ pos: 2, label: 'Runner-up' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Archive isolation — finalizing S11 must not touch S9/S10
// ─────────────────────────────────────────────────────────────────────────────
//
// finalize-season.ts archives via `UPDATE seasons SET archived = 1 WHERE id = ?`
// — scoped to the single resolved season id. We verify that scoping holds.

/** The archive step: mark exactly one season archived by id. */
function archiveSeason(db: Database, seasonId: number) {
  db.prepare(`UPDATE seasons SET archived = 1 WHERE id = ?`).run(seasonId);
}

function isArchived(db: Database, seasonId: number): boolean {
  const row = db.prepare(`SELECT archived FROM seasons WHERE id = ?`)
    .get(seasonId) as { archived: number };
  return row.archived === 1;
}

describe('archive isolation — finalizing S11 alongside S9/S10', () => {
  test('archiving S11 leaves S9 and S10 archived flags untouched', () => {
    const db = makeDb();
    addSeason(db, 9, 9, /* archived */ 1);
    addSeason(db, 10, 10, /* archived */ 1);
    addSeason(db, 11, 11, /* archived */ 0);

    expect(isArchived(db, 11)).toBe(false);
    archiveSeason(db, 11);

    expect(isArchived(db, 11)).toBe(true);
    // S9 and S10 must remain exactly as they were.
    expect(isArchived(db, 9)).toBe(true);
    expect(isArchived(db, 10)).toBe(true);
  });

  test('re-archiving an already-archived season is a no-op (idempotent)', () => {
    const db = makeDb();
    addSeason(db, 11, 11, /* archived */ 1);

    archiveSeason(db, 11);
    expect(isArchived(db, 11)).toBe(true);
  });

  test('archiving never un-archives a sibling season', () => {
    const db = makeDb();
    addSeason(db, 9, 9, 1);
    addSeason(db, 10, 10, 1);
    addSeason(db, 11, 11, 0);

    // Finalize S11 twice — siblings stay archived through both runs.
    archiveSeason(db, 11);
    archiveSeason(db, 11);

    const archivedCount = (db.prepare(
      `SELECT COUNT(*) AS c FROM seasons WHERE archived = 1`,
    ).get() as { c: number }).c;
    expect(archivedCount).toBe(3);
  });

  test('finalizing one league does not stamp another season\'s teams', () => {
    const db = makeDb();
    addSeason(db, 10, 10, 1);
    addSeason(db, 11, 11, 0);
    const s10teams = addLeagueWithTeams(db, 's10-league', 10);
    const s11teams = addLeagueWithTeams(db, 's11-league', 11);
    addPlayoffMatch(db, 'f-11', 's11-league', 'f', s11teams[0], s11teams[1], 4, 3);

    // Finalize only the S11 league.
    assignFinishPositions(db, ['s11-league']);

    // S11 teams are stamped.
    expect(teamFinish(db, s11teams[0]).label).toBe('Champion');
    // S10 teams were not in the league-id list → untouched (still NULL).
    expect(teamFinish(db, s10teams[0])).toEqual({ pos: null, label: null });
  });
});
