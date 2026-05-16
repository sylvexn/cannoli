/**
 * seedLeagueTrades — populate a league's Trade Block surface with believable,
 * deterministic fictional activity.
 *
 * The simulator builder (`build-world.ts`) plays out drafts, seasons and
 * playoffs but never produces trade activity, leaving the Trade Block page
 * empty in every league. This helper backfills it from a league's real
 * drafted rosters using the shared `MockRng`, so the same masterSeed always
 * produces the same trades.
 *
 * Per league it generates:
 *   • a few ACCEPTED trades — each also executes the roster swap and writes
 *     `transactions` rows (type='trade'), so they appear in Trade History
 *   • a couple PENDING proposals — appear under Proposals (live leagues only;
 *     a finished/archived season has no open proposals)
 *   • several `tradeBlockListings` — appear under "On the Block"
 *
 * MOCK-ONLY. Called from `buildSimWorld` after rosters exist. Writes directly
 * (FK enforcement is already disabled for the bulk build).
 */
import { db, schema, sqlite } from '../../db';
import { and, eq } from 'drizzle-orm';
import type { MockRng } from './mock-rng';

interface RosterRow {
  id: number;
  teamId: string;
  pokemonName: string;
  tier: number;
  costAtDraft: number;
}

const BLOCK_NOTES = [
  'open to offers',
  'looking for speed control',
  'need a physical wall',
  'will move for the right piece',
  'prefer a 1-for-1',
  null,
  null,
];

const PENDING_NOTE = ['eyeing a playoff push', 'roster reshuffle', null, null];

export interface SeedTradesResult {
  accepted: number;
  pending: number;
  listings: number;
}

/**
 * Swap one Pokemon between two teams and record `transactions` rows. Mirrors
 * the production `executeRosterSwap` in `routes/trades.ts` (1-for-1 only here)
 * so the resulting state is indistinguishable from a real accepted trade.
 */
function executeSwap(
  leagueId: string,
  week: number,
  proposer: RosterRow,
  recipient: RosterRow,
): void {
  // proposer's mon → recipient
  db.update(schema.rosters).set({
    teamId: recipient.teamId,
    acquiredVia: 'trade',
    acquiredWeek: week,
    isTeraCaptain: false,
    teraType1: null, teraType2: null, teraType3: null,
  }).where(eq(schema.rosters.id, proposer.id)).run();
  // recipient's mon → proposer
  db.update(schema.rosters).set({
    teamId: proposer.teamId,
    acquiredVia: 'trade',
    acquiredWeek: week,
    isTeraCaptain: false,
    teraType1: null, teraType2: null, teraType3: null,
  }).where(eq(schema.rosters.id, recipient.id)).run();

  db.insert(schema.transactions).values([
    {
      leagueId, week, type: 'trade',
      teamId: proposer.teamId, otherTeamId: recipient.teamId,
      pokemonOut: proposer.pokemonName, pointsOut: proposer.tier,
    },
    {
      leagueId, week, type: 'trade',
      teamId: recipient.teamId, otherTeamId: proposer.teamId,
      pokemonOut: recipient.pokemonName, pointsOut: recipient.tier,
    },
  ]).run();
}

/**
 * Seed a deterministic set of trades + trade-block listings for one league.
 *
 * @param leagueId    target league
 * @param rng         the league's sub-seeded MockRng (deterministic)
 * @param finished    true for the finished (archived) season — produces only
 *                    historical accepted trades, no open proposals
 * @param maxWeek     highest week number to stamp trades/proposals against
 */
export function seedLeagueTrades(
  leagueId: string,
  rng: MockRng,
  finished: boolean,
  maxWeek: number,
): SeedTradesResult {
  // Pull every team's roster, grouped by team. A roster row only becomes a
  // captain in the draft sim; we keep clear of captains so swaps stay simple.
  const rosterRows = sqlite.prepare(
    `SELECT id, team_id AS teamId, pokemon_name AS pokemonName, tier, cost_at_draft AS costAtDraft
       FROM rosters
      WHERE team_id IN (SELECT id FROM teams WHERE league_id = ?)
        AND is_tera_captain = 0`,
  ).all(leagueId) as RosterRow[];

  const byTeam = new Map<string, RosterRow[]>();
  for (const r of rosterRows) {
    const list = byTeam.get(r.teamId) ?? [];
    list.push(r);
    byTeam.set(r.teamId, list);
  }
  const teamIds = [...byTeam.keys()];
  if (teamIds.length < 2) return { accepted: 0, pending: 0, listings: 0 };

  // Pick one tradeable (non-captain) mon from a team's CURRENT roster.
  const pickMon = (teamId: string): RosterRow | null => {
    const list = byTeam.get(teamId)!;
    if (list.length === 0) return null;
    return rng.pick(list);
  };
  // Move a row between team buckets so subsequent picks see the new owner.
  const moveBucket = (row: RosterRow, toTeam: string) => {
    const from = byTeam.get(row.teamId)!;
    const idx = from.indexOf(row);
    if (idx >= 0) from.splice(idx, 1);
    row.teamId = toTeam;
    byTeam.get(toTeam)!.push(row);
  };

  let accepted = 0;
  let pending = 0;
  let listings = 0;

  // ── Accepted trades (Trade History) ─────────────────────────────────────
  // 3–4 historical 1-for-1 swaps. Tiers are kept within 2 of each other so a
  // glance at the history reads as a fair trade. Each slot retries a few
  // pairings to find a fair one rather than silently producing nothing — so
  // every league reliably lands a handful of trades.
  const acceptedCount = rng.int(3, 4);
  for (let i = 0; i < acceptedCount; i++) {
    let monA: RosterRow | null = null;
    let monB: RosterRow | null = null;
    let a = '';
    let b = '';
    for (let attempt = 0; attempt < 12; attempt++) {
      const order = rng.shuffle(teamIds);
      a = order[0]!;
      b = order[1]!;
      const pa = pickMon(a);
      const pb = pickMon(b);
      if (pa && pb && Math.abs(pa.tier - pb.tier) <= 2) {
        monA = pa; monB = pb;
        break;
      }
    }
    if (!monA || !monB) continue; // exhausted retries — leave this slot empty

    const week = rng.int(1, Math.max(1, maxWeek));
    executeSwap(leagueId, week, monA, monB);

    db.insert(schema.trades).values({
      leagueId, week, status: 'accepted',
      proposerId: a, recipientId: b,
      offering: JSON.stringify([monA.pokemonName]),
      requesting: JSON.stringify([monB.pokemonName]),
      resolvedBy: 'simulator',
    }).run();
    // Keep the in-memory buckets consistent for later picks.
    moveBucket(monA, b);
    moveBucket(monB, a);
    accepted++;
  }

  // ── Pending proposals (Proposals tab) — live leagues only ───────────────
  if (!finished) {
    const pendingCount = rng.int(2, 3);
    for (let i = 0; i < pendingCount; i++) {
      const order = rng.shuffle(teamIds);
      const a = order[0]!;
      const b = order[1]!;
      const monA = pickMon(a);
      const monB = pickMon(b);
      if (!monA || !monB) continue;
      // Pending = not yet executed; no roster swap, no transactions row.
      db.insert(schema.trades).values({
        leagueId, week: maxWeek, status: 'pending',
        proposerId: a, recipientId: b,
        offering: JSON.stringify([monA.pokemonName]),
        requesting: JSON.stringify([monB.pokemonName]),
        rejectReason: rng.pick(PENDING_NOTE),
      }).run();
      pending++;
    }
  }

  // ── Trade-block listings ("On the Block") ───────────────────────────────
  // ~half the teams list a single mon. Skip any mon already listed (the
  // accepted-trade swaps above won't have re-listed anything).
  const listed = new Set<string>();
  for (const teamId of rng.shuffle(teamIds)) {
    if (rng.bool(0.5)) continue;
    const mon = pickMon(teamId);
    if (!mon) continue;
    const key = `${teamId}:${mon.pokemonName}`;
    if (listed.has(key)) continue;
    listed.add(key);
    db.insert(schema.tradeBlockListings).values({
      leagueId,
      teamId,
      pokemonName: mon.pokemonName,
      note: rng.pick(BLOCK_NOTES),
    }).run();
    listings++;
  }

  return { accepted, pending, listings };
}
