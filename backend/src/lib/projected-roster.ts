/**
 * Roster projection — "what will this roster look like when the move lands?"
 *
 * Trades and FA requests are approved for a FUTURE week (see
 * scheduled-transactions.ts): the row is committed but rosters are untouched
 * until the league reaches its effective week. Validating a NEW trade against
 * the raw current roster therefore rejects moves that are perfectly legal by
 * the time they take effect — a coach whose approved FA drops a mon on Monday
 * night could not enter a trade that needs that point headroom, even though
 * the trade itself can't land before the FA does.
 *
 * So trade validation runs against the PROJECTED roster: the current roster
 * plus every approved-but-unapplied FA request and accepted-but-unapplied
 * trade. Effective weeks aren't filtered — an approval lands next week by
 * default and a brand-new proposal can't be approved for any earlier week, so
 * everything still pending is something the trade will meet on arrival.
 */
import { db, schema } from '../db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getTeamRoster } from './queries';
import { getLeagueCostMap } from './league-costs';

/** Minimal roster shape the legality validators need. */
export type ProjectedSlot = {
  pokemonName: string;
  costAtDraft: number | null;
  isTeraCaptain: boolean;
};

export type Projection = {
  /** Roster as it will stand once every pending move has been applied. */
  roster: ProjectedSlot[];
  /** How many pending rows fed the projection (0 = roster is already current). */
  moves: number;
  /** Names the pending moves take OFF this roster (dropped or traded away). */
  outgoing: string[];
};

export function projectRoster(
  teamId: string,
  leagueId: string,
  opts: { excludeTradeId?: number } = {},
): Projection {
  const current = getTeamRoster(teamId);
  let roster: ProjectedSlot[] = current.map(r => ({
    pokemonName: r.pokemonName,
    costAtDraft: r.costAtDraft,
    isTeraCaptain: !!r.isTeraCaptain,
  }));
  let moves = 0;

  // FA first — pickups/drops are the usual source of point headroom.
  const faRows = db.select().from(schema.faRequests)
    .where(and(
      eq(schema.faRequests.leagueId, leagueId),
      eq(schema.faRequests.teamId, teamId),
      eq(schema.faRequests.status, 'approved'),
      isNull(schema.faRequests.appliedAt),
    ))
    .orderBy(asc(schema.faRequests.id))
    .all();

  const leagueCosts = faRows.length > 0 ? getLeagueCostMap(leagueId) : null;
  for (const req of faRows) {
    moves++;
    if (req.requestType === 'tera_change') {
      // applyTeraCaptains replaces the whole captain set, so mirror that:
      // a mon not named in the request loses its markup.
      const named = new Set(
        (JSON.parse(req.teraChanges || '[]') as { pokemonName: string }[]).map(c => c.pokemonName),
      );
      roster = roster.map(s => ({ ...s, isTeraCaptain: named.has(s.pokemonName) }));
      continue;
    }
    const drops = new Set(JSON.parse(req.drops || '[]') as string[]);
    roster = roster.filter(s => !drops.has(s.pokemonName));
    for (const name of JSON.parse(req.pickups || '[]') as string[]) {
      roster.push({
        pokemonName: name,
        costAtDraft: leagueCosts!.get(name)?.tier ?? null,
        isTeraCaptain: false,
      });
    }
  }

  // Scheduled trades, oldest approval first (same order applyDueTransactions uses).
  const tradeRows = db.select().from(schema.trades)
    .where(and(
      eq(schema.trades.leagueId, leagueId),
      eq(schema.trades.status, 'accepted'),
      isNull(schema.trades.appliedAt),
    ))
    .orderBy(asc(schema.trades.resolvedAt), asc(schema.trades.id))
    .all();

  for (const t of tradeRows) {
    if (t.id === opts.excludeTradeId) continue;
    const isProposer = t.proposerId === teamId;
    if (!isProposer && t.recipientId !== teamId) continue;
    moves++;
    const outNames = new Set(JSON.parse(isProposer ? t.offering : t.requesting) as string[]);
    const inNames = JSON.parse(isProposer ? t.requesting : t.offering) as string[];
    // ponytail: costAtDraft is read off the counterparty's CURRENT roster, so a
    // mon in a chain of two pending trades resolves to null here and falls back
    // to the league format cost downstream. Chain-aware lookup if that ever bites.
    const fromRoster = getTeamRoster(isProposer ? t.recipientId : t.proposerId);
    roster = roster.filter(s => !outNames.has(s.pokemonName));
    for (const name of inNames) {
      // Tera captaincy does not transfer (mirrors executeRosterSwap).
      roster.push({
        pokemonName: name,
        costAtDraft: fromRoster.find(r => r.pokemonName === name)?.costAtDraft ?? null,
        isTeraCaptain: false,
      });
    }
  }

  const kept = new Set(roster.map(s => s.pokemonName));
  return {
    roster,
    moves,
    outgoing: current.map(r => r.pokemonName).filter(n => !kept.has(n)),
  };
}

/**
 * Per-team projections for a whole league, keyed by team id — only teams that
 * actually have something pending. Feeds the trade composer so the client's
 * point meter agrees with the server's validator.
 */
export function leaguePendingMoves(leagueId: string) {
  const teams = db.select().from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all();
  const leagueCosts = getLeagueCostMap(leagueId);
  const out: Record<string, { moves: number; outgoing: string[]; roster: { name: string; tier: number; isTeraCaptain: boolean }[] }> = {};

  for (const team of teams) {
    const p = projectRoster(team.id, leagueId);
    if (p.moves === 0) continue;
    out[team.id] = {
      moves: p.moves,
      outgoing: p.outgoing,
      roster: p.roster.map(s => ({
        name: s.pokemonName,
        tier: s.costAtDraft ?? leagueCosts.get(s.pokemonName)?.tier ?? 0,
        isTeraCaptain: s.isTeraCaptain,
      })),
    };
  }
  return out;
}
