/**
 * Free-agency pickup core — extracted from the FA route so it can run in two
 * contexts (feedback #42):
 *   - immediate apply (staff acting directly, or approving a queued request)
 *   - dry-run validation (a non-staff submission is checked, then parked in the
 *     fa_requests queue without touching rosters until an admin approves it)
 *
 * The dry-run path runs the SAME mutation transaction and rolls it back, so a
 * queued request is validated against exactly the rules a real pickup enforces
 * (point cap, mega cap, dup dex/species, roster size, already-rostered, FA
 * budget, phase/deadline) — no parallel, drift-prone validator.
 */
import { db, schema } from '../db';
import { eq, and, inArray } from 'drizzle-orm';
import { tx } from './tx';
import { getLeagueCostMap } from './league-costs';
import { validateRosterLegality } from './roster-legality';
import { effectiveCost } from './tera-cost';

export interface FaPickupInput {
  leagueId: string;
  teamId: string;
  pickupNames: string[];
  dropNames: string[];
  /** Username recorded on the activity-log entry when applied. */
  actorUsername: string;
  /** Run all validation + the mutation tx, then roll it back. */
  dryRun?: boolean;
  /** League week to stamp on transactions.week / rosters.acquiredWeek
   *  (admin-chosen "effective week" at approve time). Defaults to the
   *  league's currentWeek when omitted — the pickup still applies
   *  immediately; this only labels which week the ledger records it under. */
  effectiveWeek?: number;
}

export interface FaPickupOk {
  ok: true;
  faUsed: number;
  faRemaining: number;
  faPerSeason: number;
}
export interface FaPickupErr {
  ok: false;
  status: number;
  error: string;
  code?: string;
}
export type FaPickupResult = FaPickupOk | FaPickupErr;

const err = (status: number, error: string, code?: string): FaPickupErr =>
  ({ ok: false, status, error, code });

export function applyFaPickup(input: FaPickupInput): FaPickupResult {
  const { leagueId, teamId, pickupNames, dropNames, actorUsername, dryRun } = input;

  if (pickupNames.length === 0) {
    return err(400, 'At least one Pokemon to pick up is required');
  }

  const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
  if (!team) return err(404, 'Team not found');
  if (team.leagueId !== leagueId) {
    return err(400, 'Team does not belong to this league', 'team_league_mismatch');
  }

  // Verify all pickups exist and are draftable in THIS league's format.
  const leagueCosts = getLeagueCostMap(leagueId);
  const pickupCosts: { name: string; tier: number }[] = [];
  for (const pokemonName of pickupNames) {
    const pkmnGlobal = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, pokemonName)).get();
    if (!pkmnGlobal) return err(404, `Pokemon not found: ${pokemonName}`);
    const pkmnCost = leagueCosts.get(pokemonName);
    if (!pkmnCost || pkmnCost.tier <= 0) return err(400, `${pokemonName} is not draftable`);
    if (pkmnCost.banned) return err(400, `${pokemonName} is banned`);
    pickupCosts.push({ name: pokemonName, tier: pkmnCost.tier });
  }

  if (new Set(pickupNames).size !== pickupNames.length) {
    return err(400, 'Duplicate Pokemon in pickup list');
  }
  if (new Set(dropNames).size !== dropNames.length) {
    return err(400, 'Duplicate Pokemon in drop list');
  }

  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
  const week = league?.currentWeek ?? 0;
  // Ledger stamp week: admin-chosen effective week if given, else the actual
  // current week. Deadline/phase gating below always uses `week` (the real
  // current week) — only the ledger writes (rosters.acquiredWeek,
  // transactions.week) use `stampWeek`.
  const stampWeek = input.effectiveWeek ?? week;
  const settings = db.select().from(schema.siteSettings).get();

  // ── Phase / deadline gate ──
  if (league) {
    if (league.phase === 'playoffs') {
      return err(409, 'Free agent pickups are closed during playoffs', 'fa_playoffs_closed');
    }
    if (league.phase === 'regular') {
      const faDeadline = settings?.faDeadlineWeek ?? 7;
      if (week > faDeadline) {
        return err(409, `Free agent deadline has passed (week ${faDeadline}, current week ${week})`, 'fa_deadline_passed');
      }
    }
  }

  // ── FA budget check ── (each picked-up mon costs 1 slot)
  const faPickupsPerSeason = settings?.faPickupsPerSeason ?? 6;
  const usedPickups = db.select().from(schema.transactions)
    .where(and(
      eq(schema.transactions.leagueId, leagueId),
      eq(schema.transactions.teamId, teamId),
      eq(schema.transactions.type, 'fa'),
    ))
    .all()
    .filter(t => t.pokemonIn != null).length;

  const budgetRemaining = faPickupsPerSeason - usedPickups;
  if (pickupNames.length > budgetRemaining) {
    return err(400,
      `FA budget exceeded — picking up ${pickupNames.length} would use ${usedPickups + pickupNames.length} of ${faPickupsPerSeason} allowed pickups (${budgetRemaining} remaining)`,
      'fa_budget_exceeded');
  }

  const DRY_RUN_OK = Symbol('fa-dry-run-ok');

  try {
    const result = tx(() => {
      // ── Already-rostered guard (atomic with the inserts) ──
      const teamsInLeague = db.select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.leagueId, leagueId))
        .all()
        .map(t => t.id);
      for (const pokemonName of pickupNames) {
        const alreadyRostered = teamsInLeague.some(tid =>
          db.select().from(schema.rosters)
            .where(and(eq(schema.rosters.teamId, tid), eq(schema.rosters.pokemonName, pokemonName)))
            .get() != null,
        );
        if (alreadyRostered) {
          throw Object.assign(new Error(`${pokemonName} is already rostered`), { _status: 400, _code: 'fa_already_rostered' });
        }
      }

      // ── Apply drops first ──
      const droppedCosts = new Map<string, number>();
      for (const dropPokemonName of dropNames) {
        const droppedRow = db.select().from(schema.rosters)
          .where(and(eq(schema.rosters.teamId, teamId), eq(schema.rosters.pokemonName, dropPokemonName)))
          .get();
        if (!droppedRow) {
          throw Object.assign(new Error(`${dropPokemonName} is not on ${team.teamName}'s roster`), { _status: 400, _code: 'fa_drop_not_found' });
        }
        droppedCosts.set(dropPokemonName, droppedRow.costAtDraft ?? droppedRow.tier);
        db.delete(schema.rosters).where(eq(schema.rosters.id, droppedRow.id)).run();
        db.delete(schema.tradeBlockListings)
          .where(and(
            eq(schema.tradeBlockListings.leagueId, leagueId),
            eq(schema.tradeBlockListings.teamId, teamId),
            eq(schema.tradeBlockListings.pokemonName, dropPokemonName),
          ))
          .run();
      }

      // ── Apply pickups ──
      for (const { name: pokemonName, tier } of pickupCosts) {
        db.insert(schema.rosters).values({
          teamId, pokemonName, tier, costAtDraft: tier, acquiredVia: 'fa', acquiredWeek: stampWeek,
        }).run();
      }

      // ── Post-swap roster legality re-check ──
      const newRoster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, teamId)).all();
      if (league) {
        // Effective band: a per-league min/max range. NULL falls back to
        // rosterSize, so an unbanded league still requires exactly rosterSize.
        const effMax = league.maxRosterSize ?? league.rosterSize;
        const effMin = league.minRosterSize ?? league.rosterSize;
        if (newRoster.length > effMax) {
          throw Object.assign(new Error(`Pickup would put roster at ${newRoster.length} (max ${effMax}) — additional drops are required`), { _status: 400, _code: 'fa_roster_size_exceeded' });
        }
        if (newRoster.length < effMin) {
          throw Object.assign(new Error(`Roster would drop to ${newRoster.length} (min ${effMin}) — keep at least ${effMin} Pokemon`), { _status: 400, _code: 'fa_roster_below_min' });
        }
      }

      const newPokemonRows = db.select().from(schema.pokemon)
        .where(inArray(schema.pokemon.name, newRoster.map(r => r.pokemonName)))
        .all();
      const pokeByName = new Map(newPokemonRows.map(p => [p.name, p]));
      const pointCap = season?.pointCap ?? 110;
      const rosterEntries = newRoster.map(r => ({
        pokemonName: r.pokemonName,
        cost: r.costAtDraft ?? r.tier ?? 0,
        isTeraCaptain: !!r.isTeraCaptain,
      }));
      const violation = validateRosterLegality(rosterEntries, pokeByName, { pointCap });
      if (violation) {
        const codeMap: Record<string, string> = {
          point_cap: 'fa_over_cap', mega_cap: 'fa_mega_cap',
          dup_natdex: 'fa_dup_natdex', dup_species: 'fa_dup_species',
        };
        throw Object.assign(new Error(violation.message), { _status: 400, _code: codeMap[violation.code] ?? 'fa_invalid' });
      }

      const newFaUsed = usedPickups + pickupNames.length;
      const okResult: FaPickupOk = {
        ok: true, faUsed: newFaUsed, faRemaining: faPickupsPerSeason - newFaUsed, faPerSeason: faPickupsPerSeason,
      };

      // Dry run: everything is legal — bail out so the tx rolls back and no
      // roster/ledger rows persist. The thrown payload carries the result.
      if (dryRun) throw Object.assign(new Error('dry-run-ok'), { [DRY_RUN_OK]: okResult });

      // ── Transaction records (pair each drop with a pickup — feedback #41) ──
      const dropCostOf = (name: string) => droppedCosts.get(name) ?? leagueCosts.get(name)?.tier ?? null;
      const rowCount = Math.max(pickupCosts.length, dropNames.length);
      for (let i = 0; i < rowCount; i++) {
        const pickup = pickupCosts[i];
        const drop = dropNames[i];
        db.insert(schema.transactions).values({
          leagueId, week: stampWeek, type: 'fa', teamId,
          pokemonOut: drop ?? null,
          pointsOut: drop ? dropCostOf(drop) : null,
          pokemonIn: pickup?.name ?? null,
          pointsIn: pickup?.tier ?? null,
        }).run();
      }

      // Activity log
      const pickupStr = pickupNames.join(', ');
      const dropStr = dropNames.length > 0 ? `, dropped ${dropNames.join(', ')}` : '';
      db.insert(schema.activityLog).values({
        type: 'fa_pickup', category: 'fa', actor: actorUsername, leagueId,
        description: `FA: ${team.teamName} picked up ${pickupStr}${dropStr}`,
        metadata: JSON.stringify({ teamId, pickupNames, dropNames }),
      }).run();

      return okResult;
    });

    return result;
  } catch (e: any) {
    if (e && e[DRY_RUN_OK]) return e[DRY_RUN_OK] as FaPickupOk;
    if (e?._status) return err(e._status, e.message, e._code);
    throw e;
  }
}

// ─── Tera-captain change core (feedback #51) ────────────────────────────────
// Coaches can change their tera captains (which mons, and each captain's up-to-3
// tera types) freely BEFORE the captain-gate lock. Once locked, the change must
// be requested and an admin approves it. Both the direct PUT (staff / pre-lock)
// and the approval path share one validator + one applier so a queued request is
// checked against exactly the same rules a direct save enforces.

export interface TeraCaptainInput { pokemonName: string; teraTypes: string[] }

export type TeraValidateResult = { ok: true } | { ok: false; status: number; error: string; code?: string };

/**
 * Validate a proposed tera-captain set against the team's current roster.
 * Mirrors the rules of the direct PUT: tera-ban, tier ≤ 9, max 3 types per
 * captain, captain-slot limit, and point-cap (using the `costAtDraft` snapshot
 * so a later tier-list edit can't retroactively bust a pending request).
 */
export function validateTeraCaptains(teamId: string, captains: TeraCaptainInput[]): TeraValidateResult {
  if (!Array.isArray(captains)) {
    return { ok: false, status: 400, error: 'captains array required' };
  }

  const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
  if (!team) return { ok: false, status: 404, error: 'Team not found' };

  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get();
  const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;

  const maxCaptains = season?.teraCaptainSlots ?? 2;
  if (captains.length > maxCaptains) {
    return { ok: false, status: 400, error: `Max ${maxCaptains} tera captains allowed` };
  }

  // Eligibility: not tera-banned, tier ≤ 9, ≤ 3 tera types — resolved from THIS
  // league's cost format so format-specific overrides are respected.
  const leagueCosts = getLeagueCostMap(team.leagueId);
  for (const c of captains) {
    const resolved = leagueCosts.get(c.pokemonName);
    if (resolved?.teraBanned) {
      return { ok: false, status: 400, error: `${c.pokemonName} is tera-banned` };
    }
    if (resolved && resolved.tier > 9) {
      return { ok: false, status: 400, error: `${c.pokemonName} is tier ${resolved.tier} — captains must be tier 9 or below` };
    }
    if (c.teraTypes.length > 3) {
      return { ok: false, status: 400, error: `Max 3 tera types per captain` };
    }
  }

  // Every proposed captain must actually be on the roster.
  const roster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, teamId)).all();
  const rosterNames = new Set(roster.map(r => r.pokemonName));
  for (const c of captains) {
    if (!rosterNames.has(c.pokemonName)) {
      return { ok: false, status: 400, error: `${c.pokemonName} is not on this team's roster` };
    }
  }

  // Point-cap markup check against the proposed captain set. Use costAtDraft so
  // a tier-list edit between request and approval can't invalidate it.
  const captainSet = new Set(captains.map(c => c.pokemonName));
  const totalCost = roster.reduce(
    (sum, r) => sum + effectiveCost(r.costAtDraft || r.tier, captainSet.has(r.pokemonName)),
    0,
  );
  const cap = season?.pointCap ?? 110;
  if (totalCost > cap) {
    return { ok: false, status: 400, error: `Tera captain markup would exceed point cap (${totalCost} > ${cap})`, code: 'POINT_CAP_EXCEEDED' };
  }

  return { ok: true };
}

export type TeraApplyResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Validate + apply a tera-captain set to a team's roster: clears all existing
 * captains, then sets `isTeraCaptain` + `teraType1/2/3` on the chosen mons.
 * Records `tera_change` transactions and an activity entry. Used by both the
 * direct PUT (staff / pre-lock) and the FA approval path.
 *
 * Does NOT touch `captainsLocked` or advance the league phase — the captain
 * gate's auto-lock/advance lives only in the PUT handler (it must not fire on
 * an approved mid-season change).
 */
export function applyTeraCaptains(
  teamId: string,
  captains: TeraCaptainInput[],
  actorUsername: string,
  /** League week to stamp on the tera_change transactions (admin-chosen
   *  "effective week" at approve time). Defaults to the league's currentWeek. */
  effectiveWeek?: number,
): TeraApplyResult {
  const check = validateTeraCaptains(teamId, captains);
  if (!check.ok) return check;

  const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
  if (!team) return { ok: false, status: 404, error: 'Team not found' };
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get();

  tx(() => {
    // Clear all existing tera captains for this team.
    db.update(schema.rosters).set({
      isTeraCaptain: false,
      teraType1: null,
      teraType2: null,
      teraType3: null,
    }).where(eq(schema.rosters.teamId, teamId)).run();

    // Set new captains.
    for (const c of captains) {
      db.update(schema.rosters).set({
        isTeraCaptain: true,
        teraType1: c.teraTypes[0] ?? null,
        teraType2: c.teraTypes[1] ?? null,
        teraType3: c.teraTypes[2] ?? null,
      }).where(and(
        eq(schema.rosters.teamId, teamId),
        eq(schema.rosters.pokemonName, c.pokemonName),
      )).run();
    }

    if (league) {
      const week = effectiveWeek ?? (league.currentWeek ?? 0);
      for (const c of captains) {
        db.insert(schema.transactions).values({
          leagueId: team.leagueId,
          week,
          type: 'tera_change',
          teamId,
          teraPokemon: c.pokemonName,
        }).run();
      }

      db.insert(schema.activityLog).values({
        type: 'tera_captains_updated',
        category: 'team',
        actor: actorUsername,
        leagueId: team.leagueId,
        description: `Updated tera captains: ${captains.map(c => c.pokemonName).join(', ')}`,
        metadata: JSON.stringify({ teamId, captains }),
      }).run();
    }
  });

  return { ok: true };
}
