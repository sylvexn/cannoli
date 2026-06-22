import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, inArray } from 'drizzle-orm';
import { isStaff } from '../../lib/auth';
import { tx } from '../../lib/tx';
import { effectiveCost } from '../../lib/tera-cost';
import { getLeagueCostMap } from '../../lib/league-costs';
import { generateLeagueSchedule } from '../../lib/schedule-generator';
import { checkLeagueArchived, checkTeamArchived } from '../../lib/archive-guard';
import { validateRosterLegality } from '../../lib/roster-legality';
import { applyFaPickup } from '../../lib/free-agency';
import { refreshUserMap } from '../../lib/ps-bot';

export const teamRoutes = new Elysia()

  // ─── Tera Captain Management ──────────────────────────────────────

  .put('/api/teams/:teamId/tera-captains', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }

    // Check authorization: team owner or staff (admin/dev can override any team)
    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403;
      return { error: 'Not your team' };
    }

    const { captains } = body as {
      captains: { pokemonName: string; teraTypes: string[] }[];
    };

    if (!Array.isArray(captains)) {
      set.status = 400;
      return { error: 'captains array required' };
    }

    // Get league + season config (phase lives on league; captain slot limit lives on season).
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;

    // Tera captains (and their 3 tera types) are freely editable at any point in
    // the season per league rules — not locked when the league enters regular
    // play. The only hard stop is an archived (read-only) team, handled by the
    // checkTeamArchived guard above. The post-draft captain-gate auto-advance
    // (see `willLock` below) still only fires during phase=draft, so editing
    // captains mid-season never advances the phase.
    const maxCaptains = season?.teraCaptainSlots ?? 2;

    if (captains.length > maxCaptains) {
      set.status = 400;
      return { error: `Max ${maxCaptains} tera captains allowed` };
    }

    // Validate eligibility: not tera-banned, tier ≤ 9 — resolved from THIS
    // league's cost format so format-specific overrides are respected.
    const leagueCosts = getLeagueCostMap(team.leagueId);
    for (const c of captains) {
      const resolved = leagueCosts.get(c.pokemonName);
      if (resolved?.teraBanned) {
        set.status = 400;
        return { error: `${c.pokemonName} is tera-banned` };
      }
      if (resolved && resolved.tier > 9) {
        set.status = 400;
        return { error: `${c.pokemonName} is tier ${resolved.tier} — captains must be tier 9 or below` };
      }
      if (c.teraTypes.length > 3) {
        set.status = 400;
        return { error: `Max 3 tera types per captain` };
      }
    }

    // Tera-cost markup point cap check: simulate the new captain assignments
    // against the team's full roster and verify total ≤ pointCap.
    const roster = db.select().from(schema.rosters)
      .where(eq(schema.rosters.teamId, params.teamId))
      .all();
    const captainSet = new Set(captains.map(c => c.pokemonName));
    // Use costAtDraft (snapshot) so admin tier-list edits between draft end and
    // captain reassignment don't unexpectedly bust the point cap.
    const totalCost = roster.reduce(
      (sum, r) => sum + effectiveCost(r.costAtDraft || r.tier, captainSet.has(r.pokemonName)),
      0,
    );
    const cap = season?.pointCap ?? 110;
    if (totalCost > cap) {
      set.status = 400;
      return { error: `Tera captain markup would exceed point cap (${totalCost} > ${cap})`, code: 'POINT_CAP_EXCEEDED' };
    }

    // Determine whether this save should also LOCK captains (and potentially
    // advance the league phase). Locking is triggered when:
    //   1. The league is in phase=draft AND the draft itself has completed
    //      (= the post-draft captain gate is open), AND
    //   2. The team has saved exactly `teraCaptainSlots` captains (full set).
    // Locking flips the `captainsLocked` flag on the team. Once every team in
    // the league is locked, we advance phase → regular and currentWeek → 1.
    const draftStateRow = db.select().from(schema.draftState)
      .where(eq(schema.draftState.leagueId, team.leagueId))
      .get();
    const inCaptainGate = league?.phase === 'draft' && draftStateRow?.status === 'completed';
    const willLock = inCaptainGate && captains.length === maxCaptains;

    return tx(() => {
      // Clear all existing tera captains for this team
      db.update(schema.rosters).set({
        isTeraCaptain: false,
        teraType1: null,
        teraType2: null,
        teraType3: null,
      }).where(eq(schema.rosters.teamId, params.teamId)).run();

      // Set new captains
      for (const c of captains) {
        db.update(schema.rosters).set({
          isTeraCaptain: true,
          teraType1: c.teraTypes[0] ?? null,
          teraType2: c.teraTypes[1] ?? null,
          teraType3: c.teraTypes[2] ?? null,
        }).where(and(
          eq(schema.rosters.teamId, params.teamId),
          eq(schema.rosters.pokemonName, c.pokemonName),
        )).run();
      }

      let phaseAdvanced = false;
      if (willLock) {
        db.update(schema.teams)
          .set({ captainsLocked: true })
          .where(eq(schema.teams.id, params.teamId))
          .run();

        // If every team in this league is now locked, transition to regular.
        const remaining = db.select({ id: schema.teams.id })
          .from(schema.teams)
          .where(and(
            eq(schema.teams.leagueId, team.leagueId),
            eq(schema.teams.captainsLocked, false),
          ))
          .all();
        if (remaining.length === 0) {
          db.update(schema.leagues)
            .set({ phase: 'regular', currentWeek: 1 })
            .where(eq(schema.leagues.id, team.leagueId))
            .run();
          phaseAdvanced = true;
          // Auto-generate schedule on draft → regular transition. Without this
          // the league lands in regular phase with currentWeek=1 but zero
          // matches, and the admin has to manually re-trigger phase advance.
          const scheduleResult = generateLeagueSchedule(team.leagueId);
          db.insert(schema.activityLog).values({
            type: 'league_phase_advanced',
            category: 'config',
            actor: 'system',
            leagueId: team.leagueId,
            description: `${league!.name} advanced from draft → regular (all captains locked)`,
            metadata: JSON.stringify({
              leagueId: team.leagueId,
              fromPhase: 'draft',
              toPhase: 'regular',
              scheduleGenerated: scheduleResult.success,
              matchCount: scheduleResult.matchCount,
            }),
          }).run();
        }
      }

      // Log tera change transaction
      if (league) {
        const week = league.currentWeek ?? 0;
        for (const c of captains) {
          db.insert(schema.transactions).values({
            leagueId: team.leagueId,
            week,
            type: 'tera_change',
            teamId: params.teamId,
            teraPokemon: c.pokemonName,
          }).run();
        }

        db.insert(schema.activityLog).values({
          type: willLock ? 'tera_captains_locked' : 'tera_captains_updated',
          category: 'team',
          actor: user.username,
          leagueId: team.leagueId,
          description: willLock
            ? `Locked tera captains: ${captains.map(c => c.pokemonName).join(', ')}`
            : `Updated tera captains: ${captains.map(c => c.pokemonName).join(', ')}`,
          metadata: JSON.stringify({ teamId: params.teamId, captains, locked: willLock }),
        }).run();
      }

      return {
        success: true,
        captainsLocked: willLock,
        phaseAdvanced,
      };
    });
  })

  // ─── Shiny Toggle ─────────────────────────────────────────────────

  .put('/api/teams/:teamId/shiny', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }

    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403;
      return { error: 'Not your team' };
    }

    const { pokemonName, isShiny } = body as { pokemonName: string; isShiny: boolean };
    if (!pokemonName || typeof isShiny !== 'boolean') {
      set.status = 400;
      return { error: 'pokemonName and isShiny required' };
    }

    const roster = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, params.teamId), eq(schema.rosters.pokemonName, pokemonName)))
      .get();
    if (!roster) { set.status = 404; return { error: 'Pokemon not on roster' }; }

    db.update(schema.rosters).set({ isShiny })
      .where(and(eq(schema.rosters.teamId, params.teamId), eq(schema.rosters.pokemonName, pokemonName)))
      .run();

    return { success: true };
  })

  // ─── Free Agent Pool ────────────────────────────────────────────────

  .get('/api/leagues/:leagueId/free-agents', ({ params, query }) => {
    // Get all rostered pokemon names in this league
    const teams = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, params.leagueId))
      .all();
    const teamIds = teams.map(t => t.id);

    const rostered = new Set(
      teamIds.flatMap(tid =>
        db.select({ name: schema.rosters.pokemonName })
          .from(schema.rosters)
          .where(eq(schema.rosters.teamId, tid))
          .all()
          .map(r => r.name)
      )
    );

    // Fetch per-pokemon display data (types, stats) from the reference table.
    // Draftability + cost come from THIS league's format map.
    const costs = getLeagueCostMap(params.leagueId);

    const allPokemon = db.select({
      name: schema.pokemon.name,
      type1: schema.pokemon.type1,
      type2: schema.pokemon.type2,
      hp: schema.pokemon.hp,
      atk: schema.pokemon.atk,
      def: schema.pokemon.def,
      spa: schema.pokemon.spa,
      spd: schema.pokemon.spd,
      spe: schema.pokemon.spe,
    }).from(schema.pokemon).all();

    const freeAgents = allPokemon
      .filter(p => {
        if (rostered.has(p.name)) return false;
        const c = costs.get(p.name);
        // Only include mons that are draftable in THIS league's format
        return c !== undefined && c.tier > 0 && !c.banned;
      })
      .map(p => {
        const c = costs.get(p.name)!;
        return {
          name: p.name,
          tier: c.tier,       // league-format cost, not global pokemon.tier
          type1: p.type1,
          type2: p.type2,
          stats: { hp: p.hp, atk: p.atk, def: p.def, spa: p.spa, spd: p.spd, spe: p.spe },
        };
      });

    // Optional: if the caller passes ?teamId=<id>, include FA budget info for
    // that team. This avoids a second round-trip in the FA page on load.
    const teamId = (query as Record<string, string>).teamId;
    if (teamId) {
      const settings = db.select().from(schema.siteSettings).get();
      const faPickupsPerSeason = settings?.faPickupsPerSeason ?? 6;
      const usedPickups = db.select().from(schema.transactions)
        .where(and(
          eq(schema.transactions.leagueId, params.leagueId),
          eq(schema.transactions.teamId, teamId),
          eq(schema.transactions.type, 'fa'),
        ))
        .all()
        .filter(t => t.pokemonIn != null).length;
      return {
        freeAgents,
        budget: {
          faUsed: usedPickups,
          faRemaining: faPickupsPerSeason - usedPickups,
          faPerSeason: faPickupsPerSeason,
        },
      };
    }

    return freeAgents;
  })

  .post('/api/leagues/:leagueId/free-agents/pickup', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    // Accept both legacy single-mon shape and new multi-mon shape.
    // New: { teamId, pickupNames: string[], dropNames?: string[] }
    // Legacy (still accepted): { teamId, pokemonName, dropPokemonName? }
    const raw = body as {
      teamId: string;
      // multi shape
      pickupNames?: string[];
      dropNames?: string[];
      // legacy single shape
      pokemonName?: string;
      dropPokemonName?: string;
    };

    const teamId = raw.teamId;
    if (!teamId) { set.status = 400; return { error: 'teamId required' }; }

    // Normalise to arrays
    const pickupNames: string[] = raw.pickupNames?.length
      ? raw.pickupNames
      : raw.pokemonName ? [raw.pokemonName] : [];
    const dropNames: string[] = raw.dropNames?.length
      ? raw.dropNames
      : raw.dropPokemonName ? [raw.dropPokemonName] : [];

    if (pickupNames.length === 0) {
      set.status = 400;
      return { error: 'At least one Pokemon to pick up is required' };
    }

    // Resolve target team
    const team = db.select().from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    if (team.leagueId !== params.leagueId) {
      set.status = 400;
      return { error: 'Team does not belong to this league', code: 'team_league_mismatch' };
    }

    // Authorization: staff can pick up onto any team; otherwise the caller must
    // own the target team.
    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403;
      return { error: 'Not your team' };
    }

    // Non-staff pickups are queued for admin approval (feedback #42): validate
    // against the live rules with a dry run (no mutation), park the request as
    // pending, and return. An admin applies it later via the approve endpoint.
    // Staff (admin tool / acting-as) fall through to immediate apply below.
    if (!isStaff(user)) {
      if (pickupNames.length === 0) {
        set.status = 400;
        return { error: 'At least one Pokemon to pick up is required' };
      }
      const check = applyFaPickup({
        leagueId: params.leagueId, teamId, pickupNames, dropNames,
        actorUsername: user.username, dryRun: true,
      });
      if (!check.ok) { set.status = check.status; return { error: check.error, code: check.code }; }

      const reqWeek = db.select().from(schema.leagues)
        .where(eq(schema.leagues.id, params.leagueId)).get()?.currentWeek ?? 0;
      const row = db.insert(schema.faRequests).values({
        leagueId: params.leagueId, week: reqWeek, teamId, status: 'pending',
        pickups: JSON.stringify(pickupNames), drops: JSON.stringify(dropNames),
        requestedBy: user.username,
      }).returning().get();

      db.insert(schema.activityLog).values({
        type: 'fa_requested', category: 'fa', actor: user.username, leagueId: params.leagueId,
        description: `FA request: ${team.teamName} requested ${pickupNames.join(', ')}${dropNames.length ? `, dropping ${dropNames.join(', ')}` : ''}`,
        metadata: JSON.stringify({ teamId, pickupNames, dropNames, requestId: row.id }),
      }).run();

      return {
        success: true, pending: true, requestId: row.id,
        faUsed: check.faUsed, faRemaining: check.faRemaining, faPerSeason: check.faPerSeason,
      };
    }

    // Verify all pickups exist and are draftable in THIS league's format.
    const leagueCosts = getLeagueCostMap(params.leagueId);
    const pickupCosts: { name: string; tier: number }[] = [];
    for (const pokemonName of pickupNames) {
      const pkmnGlobal = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, pokemonName)).get();
      if (!pkmnGlobal) { set.status = 404; return { error: `Pokemon not found: ${pokemonName}` }; }
      const pkmnCost = leagueCosts.get(pokemonName);
      if (!pkmnCost || pkmnCost.tier <= 0) { set.status = 400; return { error: `${pokemonName} is not draftable` }; }
      if (pkmnCost.banned) { set.status = 400; return { error: `${pokemonName} is banned` }; }
      pickupCosts.push({ name: pokemonName, tier: pkmnCost.tier });
    }

    // Check for duplicate pickups in the batch
    const pickupSet = new Set(pickupNames);
    if (pickupSet.size !== pickupNames.length) {
      set.status = 400;
      return { error: 'Duplicate Pokemon in pickup list' };
    }

    // Check for duplicate drops in the batch (a repeated name would delete once
    // then fail "not on roster" on the second pass — guard for a clear error).
    if (new Set(dropNames).size !== dropNames.length) {
      set.status = 400;
      return { error: 'Duplicate Pokemon in drop list' };
    }

    // NOTE: the "already rostered in this league" check runs INSIDE the tx
    // below (not here) so the read-check and the roster insert are one atomic
    // unit — otherwise a concurrent pickup/trade could claim the same mon
    // between the check and our insert.

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
    const week = league?.currentWeek ?? 0;
    const settings = db.select().from(schema.siteSettings).get();

    // ── Phase / deadline gate ──
    if (league) {
      if (league.phase === 'playoffs') {
        set.status = 409;
        return { error: 'Free agent pickups are closed during playoffs', code: 'fa_playoffs_closed' };
      }
      if (league.phase === 'regular') {
        const faDeadline = settings?.faDeadlineWeek ?? 7;
        if (week > faDeadline) {
          set.status = 409;
          return {
            error: `Free agent deadline has passed (week ${faDeadline}, current week ${week})`,
            code: 'fa_deadline_passed',
            faDeadlineWeek: faDeadline,
            currentWeek: week,
          };
        }
      }
    }

    // ── FA budget check ──
    // Count how many FA pickups this team has used this season by summing
    // transactions of type 'fa' where pokemonIn IS NOT NULL (drops have
    // pokemonIn=null). Each mon picked up costs 1 slot.
    const faPickupsPerSeason = settings?.faPickupsPerSeason ?? 6;
    const usedPickups = db.select().from(schema.transactions)
      .where(and(
        eq(schema.transactions.leagueId, params.leagueId),
        eq(schema.transactions.teamId, teamId),
        eq(schema.transactions.type, 'fa'),
      ))
      .all()
      .filter(t => t.pokemonIn != null).length;

    const budgetRemaining = faPickupsPerSeason - usedPickups;
    if (pickupNames.length > budgetRemaining) {
      set.status = 400;
      return {
        error: `FA budget exceeded — picking up ${pickupNames.length} would use ${usedPickups + pickupNames.length} of ${faPickupsPerSeason} allowed pickups (${budgetRemaining} remaining)`,
        code: 'fa_budget_exceeded',
        faUsed: usedPickups,
        faRemaining: budgetRemaining,
        faPerSeason: faPickupsPerSeason,
      };
    }

    let pickupResult: { success: boolean; faUsed: number; faRemaining: number; faPerSeason: number };
    try {
      pickupResult = tx(() => {
        // ── Already-rostered guard (atomic with the inserts) ──
        // Run inside the tx so the read-check and the roster insert are one
        // unit: no other pickup/trade can claim the same mon in between.
        const teamsInLeague = db.select({ id: schema.teams.id })
          .from(schema.teams)
          .where(eq(schema.teams.leagueId, params.leagueId))
          .all()
          .map(t => t.id);
        for (const pokemonName of pickupNames) {
          const alreadyRostered = teamsInLeague.some(tid =>
            db.select().from(schema.rosters)
              .where(and(eq(schema.rosters.teamId, tid), eq(schema.rosters.pokemonName, pokemonName)))
              .get() != null,
          );
          if (alreadyRostered) {
            throw Object.assign(
              new Error(`${pokemonName} is already rostered`),
              { _status: 400, _code: 'fa_already_rostered' },
            );
          }
        }

        // ── Apply drops first ──
        // Snapshot what each dropped mon actually cost (costAtDraft) so the
        // transaction ledger records the paid value, not the current tier.
        const droppedCosts = new Map<string, number>();
        for (const dropPokemonName of dropNames) {
          const droppedRow = db.select().from(schema.rosters)
            .where(and(
              eq(schema.rosters.teamId, teamId),
              eq(schema.rosters.pokemonName, dropPokemonName),
            ))
            .get();
          if (!droppedRow) {
            throw Object.assign(
              new Error(`${dropPokemonName} is not on ${team.teamName}'s roster`),
              { _status: 400, _code: 'fa_drop_not_found' },
            );
          }
          droppedCosts.set(dropPokemonName, droppedRow.costAtDraft ?? droppedRow.tier);
          db.delete(schema.rosters)
            .where(eq(schema.rosters.id, droppedRow.id))
            .run();

          // Drop also clears any trade-block listing on that mon for this team
          db.delete(schema.tradeBlockListings)
            .where(and(
              eq(schema.tradeBlockListings.leagueId, params.leagueId),
              eq(schema.tradeBlockListings.teamId, teamId),
              eq(schema.tradeBlockListings.pokemonName, dropPokemonName),
            ))
            .run();
        }

        // ── Apply pickups ──
        for (const { name: pokemonName, tier } of pickupCosts) {
          db.insert(schema.rosters).values({
            teamId,
            pokemonName,
            tier,
            costAtDraft: tier,
            acquiredVia: 'fa',
            acquiredWeek: week,
          }).run();
        }

        // ── Post-swap roster legality re-check (run once on final roster) ──
        const newRoster = db.select().from(schema.rosters)
          .where(eq(schema.rosters.teamId, teamId))
          .all();

        // Roster band: effective min/max. NULL columns fall back to rosterSize,
        // so an unbanded league still requires exactly rosterSize.
        if (league) {
          const effMax = league.maxRosterSize ?? league.rosterSize;
          const effMin = league.minRosterSize ?? league.rosterSize;
          if (newRoster.length > effMax) {
            throw Object.assign(
              new Error(`Pickup would put roster at ${newRoster.length} (max ${effMax}) — additional drops are required`),
              { _status: 400, _code: 'fa_roster_size_exceeded' },
            );
          }
          if (newRoster.length < effMin) {
            throw Object.assign(
              new Error(`Roster would drop to ${newRoster.length} (min ${effMin}) — keep at least ${effMin} Pokemon`),
              { _status: 400, _code: 'fa_roster_below_min' },
            );
          }
        }

        // Pull pokemon metadata for shared legality validator (mega/dex/species).
        const newPokemonRows = db.select().from(schema.pokemon)
          .where(inArray(schema.pokemon.name, newRoster.map(r => r.pokemonName)))
          .all();
        const pokeByName = new Map(newPokemonRows.map(p => [p.name, p]));

        // Shared legality check: point cap + mega cap + dup natdex + dup species.
        // Use ?? so a legit 0-cost mon isn't treated as missing.
        const pointCap = season?.pointCap ?? 110;
        const rosterEntries = newRoster.map(r => ({
          pokemonName: r.pokemonName,
          cost: r.costAtDraft ?? r.tier ?? 0,
          isTeraCaptain: !!r.isTeraCaptain,
        }));
        const violation = validateRosterLegality(rosterEntries, pokeByName, { pointCap });
        if (violation) {
          const codeMap: Record<string, string> = {
            point_cap: 'fa_over_cap',
            mega_cap: 'fa_mega_cap',
            dup_natdex: 'fa_dup_natdex',
            dup_species: 'fa_dup_species',
          };
          throw Object.assign(
            new Error(violation.message),
            { _status: 400, _code: codeMap[violation.code] ?? 'fa_invalid' },
          );
        }

        // ── Transaction records ──
        // Pair each pickup with a drop so the common "drop X, add Y" pickup is
        // ONE row carrying both sides (pokemonOut + pokemonIn). Writing them as
        // two half-empty rows made the activity feeds render "— for Y" and
        // "X for —" on separate lines (feedback #41). Unequal counts leave the
        // leftovers as legitimate one-sided rows (pure add / pure drop).
        const dropCostOf = (name: string) =>
          droppedCosts.get(name) ?? leagueCosts.get(name)?.tier ?? null;
        const rowCount = Math.max(pickupCosts.length, dropNames.length);
        for (let i = 0; i < rowCount; i++) {
          const pickup = pickupCosts[i];
          const drop = dropNames[i];
          db.insert(schema.transactions).values({
            leagueId: params.leagueId,
            week,
            type: 'fa',
            teamId,
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
          type: 'fa_pickup',
          category: 'fa',
          actor: user.username,
          leagueId: params.leagueId,
          description: `FA: ${team.teamName} picked up ${pickupStr}${dropStr}`,
          metadata: JSON.stringify({ teamId, pickupNames, dropNames }),
        }).run();

        const newFaUsed = usedPickups + pickupNames.length;
        return {
          success: true,
          faUsed: newFaUsed,
          faRemaining: faPickupsPerSeason - newFaUsed,
          faPerSeason: faPickupsPerSeason,
        };
      });
    } catch (e: any) {
      if (e?._status) {
        set.status = e._status;
        return { error: e.message, code: e._code };
      }
      throw e;
    }

    // Best-effort: refresh the PS bot's user→team map after roster change.
    try { refreshUserMap(); } catch {}

    return pickupResult!;
  })

  // Standalone release (drop only) — no pickup paired. Same phase + deadline
  // gating as pickup. Used by the team-profile "Release" button.
  .post('/api/leagues/:leagueId/free-agents/release', ({ params, query, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }

    const { teamId, pokemonName } = body as { teamId: string; pokemonName: string };
    if (!teamId || !pokemonName) {
      set.status = 400;
      return { error: 'teamId and pokemonName required' };
    }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    if (team.leagueId !== params.leagueId) {
      set.status = 400;
      return { error: 'Team does not belong to this league', code: 'team_league_mismatch' };
    }
    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403; return { error: 'Not your team' };
    }

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    const week = league?.currentWeek ?? 0;

    // Mirror pickup gating: no FA in playoffs, deadline-gated in regular.
    if (league) {
      if (league.phase === 'playoffs') {
        set.status = 409;
        return { error: 'Free agent moves are closed during playoffs', code: 'fa_playoffs_closed' };
      }
      if (league.phase === 'regular') {
        const settings = db.select().from(schema.siteSettings).get();
        const faDeadline = settings?.faDeadlineWeek ?? 7;
        if (week > faDeadline) {
          set.status = 409;
          return {
            error: `Free agent deadline has passed (week ${faDeadline}, current week ${week})`,
            code: 'fa_deadline_passed',
          };
        }
      }
    }

    const rosterRow = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, teamId), eq(schema.rosters.pokemonName, pokemonName)))
      .get();
    if (!rosterRow) {
      set.status = 400;
      return { error: `${pokemonName} is not on ${team.teamName}'s roster`, code: 'fa_drop_not_found' };
    }

    tx(() => {
      db.delete(schema.rosters).where(eq(schema.rosters.id, rosterRow.id)).run();

      // Clear any trade-block listing on the released mon for this team
      db.delete(schema.tradeBlockListings)
        .where(and(
          eq(schema.tradeBlockListings.leagueId, params.leagueId),
          eq(schema.tradeBlockListings.teamId, teamId),
          eq(schema.tradeBlockListings.pokemonName, pokemonName),
        ))
        .run();

      db.insert(schema.transactions).values({
        leagueId: params.leagueId,
        week,
        type: 'fa',
        teamId,
        pokemonOut: pokemonName,
        pointsOut: rosterRow.costAtDraft ?? rosterRow.tier,
      }).run();

      db.insert(schema.activityLog).values({
        type: 'fa_release',
        category: 'fa',
        actor: user.username,
        leagueId: params.leagueId,
        description: `FA: ${team.teamName} released ${pokemonName}`,
        metadata: JSON.stringify({ teamId, pokemonName }),
      }).run();
    });

    // Best-effort: refresh the PS bot's user→team map after roster change.
    try { refreshUserMap(); } catch {}

    return { success: true };
  });
