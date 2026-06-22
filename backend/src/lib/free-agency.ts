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

export interface FaPickupInput {
  leagueId: string;
  teamId: string;
  pickupNames: string[];
  dropNames: string[];
  /** Username recorded on the activity-log entry when applied. */
  actorUsername: string;
  /** Run all validation + the mutation tx, then roll it back. */
  dryRun?: boolean;
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
          teamId, pokemonName, tier, costAtDraft: tier, acquiredVia: 'fa', acquiredWeek: week,
        }).run();
      }

      // ── Post-swap roster legality re-check ──
      const newRoster = db.select().from(schema.rosters).where(eq(schema.rosters.teamId, teamId)).all();
      if (league && newRoster.length > league.rosterSize) {
        throw Object.assign(new Error(`Pickup would put roster at ${newRoster.length} (max ${league.rosterSize}) — additional drops are required`), { _status: 400, _code: 'fa_roster_size_exceeded' });
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
          leagueId, week, type: 'fa', teamId,
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
