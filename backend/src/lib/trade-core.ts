/**
 * Trade validation + roster-swap core — extracted from the trades route so it
 * can run in two contexts:
 *   - immediate apply (admin approves a trade effective THIS week)
 *   - deferred apply (admin approves for a future week; the apply-scheduled
 *     sweep re-validates and runs the swap once the league reaches that week)
 *
 * Both paths run the exact same validator and mutation — no parallel,
 * drift-prone copy.
 */
import { db, schema } from '../db';
import { eq, and, inArray } from 'drizzle-orm';
import { getTeamRoster } from './queries';
import { getLeagueCostMap } from './league-costs';
import { validateRosterLegality } from './roster-legality';

/**
 * Validate that a proposed trade would leave both rosters legal:
 *   - offer count must equal request count (1-for-1, 2-for-2, …)
 *   - no duplicate names within offering or requesting lists
 *   - point cap not exceeded (using EFFECTIVE cost — retained tera-captains
 *     keep their markup; traded mons lose captain status, so their markup is
 *     dropped from the post-trade total)
 *   - max 1 mega per team
 *   - no duplicate national-dex on either team
 *   - no duplicate species/base-form on either team (e.g. Tornadus + Tornadus-Therian)
 *   - roster size: neither team may exceed league.rosterSize after the swap.
 *
 * Returns null if valid, or an error message string.
 */
export function validateProposedTrade(opts: {
  proposerId: string;
  recipientId: string;
  offering: string[];
  requesting: string[];
  pointCap: number;
  leagueId: string;
  minRosterSize?: number;
  maxRosterSize?: number;
}): string | null {
  const { proposerId, recipientId, offering, requesting, pointCap, leagueId, minRosterSize, maxRosterSize } = opts;

  if (offering.length === 0) return 'Must offer at least one Pokemon';
  if (requesting.length === 0) return 'Must request at least one Pokemon';

  // Uneven (N-for-M) trades are allowed — each side just needs >= 1 Pokemon
  // (checked above). The post-trade roster band below enforces final counts.

  // Up-front duplicate-name guard: reject if either list contains a name twice.
  const offeringSet = new Set(offering);
  if (offeringSet.size !== offering.length) {
    return 'Offering list contains duplicate Pokemon names';
  }
  const requestingSet = new Set(requesting);
  if (requestingSet.size !== requesting.length) {
    return 'Requesting list contains duplicate Pokemon names';
  }

  // Pull rosters
  const proposerRoster = getTeamRoster(proposerId);
  const recipientRoster = getTeamRoster(recipientId);

  // Verify ownership
  for (const name of offering) {
    if (!proposerRoster.some(r => r.pokemonName === name)) {
      return `Proposer no longer has ${name}`;
    }
  }
  for (const name of requesting) {
    if (!recipientRoster.some(r => r.pokemonName === name)) {
      return `Recipient no longer has ${name}`;
    }
  }

  // Pull pokemon metadata for all roster mons (natdex/mega/species checks).
  const allNames = new Set<string>([
    ...proposerRoster.map(r => r.pokemonName),
    ...recipientRoster.map(r => r.pokemonName),
  ]);
  const pokemonRows = db.select().from(schema.pokemon).where(inArray(schema.pokemon.name, [...allNames])).all();
  const pokeByName = new Map(pokemonRows.map(p => [p.name, p]));

  // League format cost map — used to resolve the price of traded-IN mons that
  // don't yet have a costAtDraft on the receiving side.
  const leagueCosts = getLeagueCostMap(leagueId);

  // Build post-trade rosters. Incoming (traded-in) mons land as NON-captains —
  // tera-captain status (and its cost markup) does not transfer (mirrors
  // executeRosterSwap). Retained mons keep their existing captain flag.
  const postProposer = [
    ...proposerRoster.filter(r => !offering.includes(r.pokemonName)),
    ...recipientRoster.filter(r => requesting.includes(r.pokemonName)).map(r => ({ ...r, isTeraCaptain: false })),
  ];
  const postRecipient = [
    ...recipientRoster.filter(r => !requesting.includes(r.pokemonName)),
    ...proposerRoster.filter(r => offering.includes(r.pokemonName)).map(r => ({ ...r, isTeraCaptain: false })),
  ];

  // Roster band: each post-trade roster must stay within [minRosterSize,
  // maxRosterSize]. Callers pass the effective bounds (NULL columns already
  // resolved to rosterSize), so an unbanded league pins both to rosterSize.
  if (maxRosterSize != null) {
    if (postProposer.length > maxRosterSize) {
      return `Proposer would have ${postProposer.length} Pokemon after the trade (max ${maxRosterSize})`;
    }
    if (postRecipient.length > maxRosterSize) {
      return `Recipient would have ${postRecipient.length} Pokemon after the trade (max ${maxRosterSize})`;
    }
  }
  if (minRosterSize != null) {
    if (postProposer.length < minRosterSize) {
      return `Proposer would have ${postProposer.length} Pokemon after the trade (min ${minRosterSize})`;
    }
    if (postRecipient.length < minRosterSize) {
      return `Recipient would have ${postRecipient.length} Pokemon after the trade (min ${minRosterSize})`;
    }
  }

  for (const [side, roster] of [['Proposer', postProposer], ['Recipient', postRecipient]] as const) {
    // Map roster rows to RosterEntry shape for the shared validator.
    // Cost resolution: prefer the frozen costAtDraft snapshot; fall back to the
    // league format cost (never the raw global r.tier, which may differ from
    // this league's format). Use ?? so a legit 0-cost mon isn't treated as missing.
    const entries = roster.map(r => ({
      pokemonName: r.pokemonName,
      cost: r.costAtDraft ?? leagueCosts.get(r.pokemonName)?.tier ?? 0,
      isTeraCaptain: !!r.isTeraCaptain,
    }));

    const violation = validateRosterLegality(entries, pokeByName, { pointCap, label: side });
    if (violation) return violation.message;
  }

  return null;
}

/** Move pokemon between two team rosters atomically. Caller must already be inside tx(). */
export function executeRosterSwap(opts: {
  proposerId: string;
  recipientId: string;
  offering: string[];   // proposer → recipient
  requesting: string[]; // recipient → proposer
  week: number;
  leagueId: string;
}) {
  const { proposerId, recipientId, offering, requesting, week, leagueId } = opts;

  // Resolve league format costs once for pointsOut snapshots in the
  // transaction log. We capture costAtDraft from each roster row before
  // moving it (the row is still owned by the original team at read-time).
  const leagueCosts = getLeagueCostMap(leagueId);

  // Capture snapshots before any updates, then apply moves.
  const offeringSnapshots = new Map<string, number | null>();
  for (const name of offering) {
    const row = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, proposerId), eq(schema.rosters.pokemonName, name)))
      .get();
    if (!row) throw new Error(`Trade invalid: ${proposerId} no longer has ${name}`);
    // Prefer the frozen costAtDraft snapshot; fall back to the league format cost.
    offeringSnapshots.set(name, (row.costAtDraft ?? leagueCosts.get(name)?.tier) ?? null);
    db.update(schema.rosters).set({
      teamId: recipientId,
      acquiredVia: 'trade',
      acquiredWeek: week,
      // Tera captain status doesn't transfer; the recipient must redesignate
      isTeraCaptain: false,
      teraType1: null, teraType2: null, teraType3: null,
    }).where(eq(schema.rosters.id, row.id)).run();
  }

  const requestingSnapshots = new Map<string, number | null>();
  for (const name of requesting) {
    const row = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, recipientId), eq(schema.rosters.pokemonName, name)))
      .get();
    if (!row) throw new Error(`Trade invalid: ${recipientId} no longer has ${name}`);
    requestingSnapshots.set(name, (row.costAtDraft ?? leagueCosts.get(name)?.tier) ?? null);
    db.update(schema.rosters).set({
      teamId: proposerId,
      acquiredVia: 'trade',
      acquiredWeek: week,
      isTeraCaptain: false,
      teraType1: null, teraType2: null, teraType3: null,
    }).where(eq(schema.rosters.id, row.id)).run();
  }

  // One transaction row per Pokemon for record-keeping.
  // pointsOut: costAtDraft snapshot (captured above) or league format cost —
  // never the global pokemon.tier baseline, which may differ from this league's format.
  for (const name of offering) {
    db.insert(schema.transactions).values({
      leagueId, week, type: 'trade',
      teamId: proposerId, otherTeamId: recipientId,
      pokemonOut: name, pointsOut: offeringSnapshots.get(name) ?? null,
    }).run();
  }
  for (const name of requesting) {
    db.insert(schema.transactions).values({
      leagueId, week, type: 'trade',
      teamId: recipientId, otherTeamId: proposerId,
      pokemonOut: name, pointsOut: requestingSnapshots.get(name) ?? null,
    }).run();
  }

  // Drop any trade-block listings on EITHER side for any mon that just
  // changed hands — the previous owner no longer has it, so the listing is
  // stale; the new owner may re-list if they want. Same league only.
  const allMoved = [...offering, ...requesting];
  if (allMoved.length > 0) {
    db.delete(schema.tradeBlockListings)
      .where(and(
        eq(schema.tradeBlockListings.leagueId, leagueId),
        inArray(schema.tradeBlockListings.pokemonName, allMoved),
      ))
      .run();
  }
}
