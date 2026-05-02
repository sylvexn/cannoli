import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { isStaff } from '../../lib/auth';
import { tx } from '../../lib/tx';
import { effectiveCost } from '../../lib/tera-cost';
import { generateLeagueSchedule } from '../../lib/schedule-generator';

export const teamRoutes = new Elysia()

  // ─── Tera Captain Management ──────────────────────────────────────

  .put('/api/teams/:teamId/tera-captains', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

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

    // Phase gate: captain assignments lock once the league enters regular play.
    // Allowed during predraft (pre-draft prep) and draft (live drafting); rejected
    // for regular/playoffs/offseason. Locking is per-league.
    if (league && (league.phase === 'regular' || league.phase === 'playoffs' || league.phase === 'offseason')) {
      set.status = 409;
      return {
        error: `Tera captains are locked once the draft ends (current phase: ${league.phase})`,
        code: 'captains_locked',
        phase: league.phase,
      };
    }

    const maxCaptains = season?.teraCaptainSlots ?? 2;

    if (captains.length > maxCaptains) {
      set.status = 400;
      return { error: `Max ${maxCaptains} tera captains allowed` };
    }

    // Validate eligibility: not tera-banned, tier ≤ 9
    for (const c of captains) {
      const pkmn = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, c.pokemonName)).get();
      if (pkmn?.teraBanned) {
        set.status = 400;
        return { error: `${c.pokemonName} is tera-banned` };
      }
      if (pkmn && pkmn.tier > 9) {
        set.status = 400;
        return { error: `${c.pokemonName} is tier ${pkmn.tier} — captains must be tier 9 or below` };
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

  .put('/api/teams/:teamId/shiny', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

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

  .get('/api/leagues/:leagueId/free-agents', ({ params }) => {
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

    // Get all draftable pokemon (tier > 0, not banned)
    const allPokemon = db.select({
      name: schema.pokemon.name,
      tier: schema.pokemon.tier,
      type1: schema.pokemon.type1,
      type2: schema.pokemon.type2,
      hp: schema.pokemon.hp,
      atk: schema.pokemon.atk,
      def: schema.pokemon.def,
      spa: schema.pokemon.spa,
      spd: schema.pokemon.spd,
      spe: schema.pokemon.spe,
    }).from(schema.pokemon)
      .where(and(sql`${schema.pokemon.tier} > 0`, eq(schema.pokemon.banned, false)))
      .all();

    return allPokemon
      .filter(p => !rostered.has(p.name))
      .map(p => ({
        name: p.name,
        tier: p.tier,
        type1: p.type1,
        type2: p.type2,
        stats: { hp: p.hp, atk: p.atk, def: p.def, spa: p.spa, spd: p.spd, spe: p.spe },
      }));
  })

  .post('/api/leagues/:leagueId/free-agents/pickup', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    const { teamId, pokemonName, dropPokemonName } = body as {
      teamId: string;
      pokemonName: string;
      dropPokemonName?: string;
    };

    if (!teamId || !pokemonName) {
      set.status = 400;
      return { error: 'teamId and pokemonName required' };
    }

    // Resolve target team (whichever teamId was supplied — including a staff
    // override). Always assert the resolved team belongs to the path league
    // before mutating rosters/transactions, even though staff may override
    // `teamId` in the body.
    const team = db.select().from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    if (team.leagueId !== params.leagueId) {
      set.status = 400;
      return { error: 'Team does not belong to this league', code: 'team_league_mismatch' };
    }

    // Authorization: staff can pick up onto any team; otherwise the caller must
    // own the target team (and can only act on their own team).
    if (!isStaff(user) && team.userId !== parseInt(user.id)) {
      set.status = 403;
      return { error: 'Not your team' };
    }

    // Verify pokemon exists, is draftable (tier > 0), and isn't banned
    const pkmn = db.select().from(schema.pokemon).where(eq(schema.pokemon.name, pokemonName)).get();
    if (!pkmn) { set.status = 404; return { error: 'Pokemon not found' }; }
    if (pkmn.tier <= 0) { set.status = 400; return { error: `${pokemonName} is not draftable` }; }
    if (pkmn.banned) { set.status = 400; return { error: `${pokemonName} is banned` }; }

    const alreadyRostered = db.select().from(schema.rosters)
      .where(eq(schema.rosters.pokemonName, pokemonName))
      .all()
      .some(r => {
        const t = db.select().from(schema.teams).where(eq(schema.teams.id, r.teamId)).get();
        return t?.leagueId === params.leagueId;
      });
    if (alreadyRostered) { set.status = 400; return { error: `${pokemonName} is already rostered` }; }

    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, params.leagueId)).get();
    const season = league ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get() : null;
    const week = league?.currentWeek ?? 0;

    // ── Phase / deadline gate ──
    // - predraft / draft / offseason: drafting is the pickup mechanism; if hit,
    //   allow (no-op gate, explicit per spec).
    // - regular: blocked once currentWeek > faDeadlineWeek (site setting).
    // - playoffs: always blocked, no FA in playoffs.
    if (league) {
      if (league.phase === 'playoffs') {
        set.status = 409;
        return { error: 'Free agent pickups are closed during playoffs', code: 'fa_playoffs_closed' };
      }
      if (league.phase === 'regular') {
        const settings = db.select().from(schema.siteSettings).get();
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

    try {
      return tx(() => {
        // Drop pokemon if specified — fail loudly if the named mon isn't on
        // the team. Previously this silently no-op'd, letting the pickup
        // succeed and bust the point cap.
        if (dropPokemonName) {
          const droppedRow = db.select().from(schema.rosters)
            .where(and(
              eq(schema.rosters.teamId, teamId),
              eq(schema.rosters.pokemonName, dropPokemonName),
            ))
            .get();
          if (!droppedRow) {
            throw Object.assign(new Error(`${dropPokemonName} is not on ${team.teamName}'s roster`), { _status: 400, _code: 'fa_drop_not_found' });
          }
          db.delete(schema.rosters)
            .where(eq(schema.rosters.id, droppedRow.id))
            .run();

          // Drop also clears any trade-block listing on that mon for this
          // team — they no longer own it.
          db.delete(schema.tradeBlockListings)
            .where(and(
              eq(schema.tradeBlockListings.leagueId, params.leagueId),
              eq(schema.tradeBlockListings.teamId, teamId),
              eq(schema.tradeBlockListings.pokemonName, dropPokemonName),
            ))
            .run();
        }

        // Add new pokemon to roster — snapshot costAtDraft so later admin
        // tier-list edits don't retroactively rewrite this team's point total.
        db.insert(schema.rosters).values({
          teamId,
          pokemonName,
          tier: pkmn.tier,
          costAtDraft: pkmn.tier,
          acquiredVia: 'fa',
          acquiredWeek: week,
        }).run();

        // ── Post-swap roster legality re-check ──
        // Re-run the same invariants that draft/trade enforce against the
        // resulting roster. Must abort the tx on any violation.
        const newRoster = db.select().from(schema.rosters)
          .where(eq(schema.rosters.teamId, teamId))
          .all();

        // Roster size cap. Must NOT exceed league.rosterSize. Teams may sit
        // below the cap (e.g. mid-recovery from a release), but a pickup
        // that would push them over requires a paired drop.
        if (league && newRoster.length > league.rosterSize) {
          throw Object.assign(
            new Error(`Pickup would put roster at ${newRoster.length} (max ${league.rosterSize}) — a drop is required`),
            { _status: 400, _code: 'fa_roster_size_exceeded' },
          );
        }

        // Pull pokemon metadata for mega + dex checks
        const newPokemonRows = db.select().from(schema.pokemon)
          .where(inArray(schema.pokemon.name, newRoster.map(r => r.pokemonName)))
          .all();
        const pokeByName = new Map(newPokemonRows.map(p => [p.name, p]));

        // Mega cap (max 1 per team)
        let megaCount = 0;
        for (const r of newRoster) {
          if (pokeByName.get(r.pokemonName)?.formCategory === 'mega') megaCount++;
        }
        if (megaCount > 1) {
          throw Object.assign(
            new Error(`Adding ${pokemonName} would put 2 Megas on the team (max 1)`),
            { _status: 400, _code: 'fa_mega_cap' },
          );
        }

        // Duplicate national dex
        const dexSeen = new Map<number, string>();
        for (const r of newRoster) {
          const dex = pokeByName.get(r.pokemonName)?.nationalDexNumber;
          if (dex == null) continue;
          const prev = dexSeen.get(dex);
          if (prev) {
            throw Object.assign(
              new Error(`${prev} and ${r.pokemonName} share National Dex #${dex}`),
              { _status: 400, _code: 'fa_dup_natdex' },
            );
          }
          dexSeen.set(dex, r.pokemonName);
        }

        // Point cap including captain markup. Use costAtDraft (snapshot).
        const pointCap = season?.pointCap ?? 110;
        const totalCost = newRoster.reduce(
          (sum, r) => sum + effectiveCost(r.costAtDraft || r.tier, !!r.isTeraCaptain),
          0,
        );
        if (totalCost > pointCap) {
          throw Object.assign(
            new Error(`Pickup would exceed point cap (${totalCost} > ${pointCap}) including captain markup`),
            { _status: 400, _code: 'fa_over_cap' },
          );
        }

        // Transaction record
        db.insert(schema.transactions).values({
          leagueId: params.leagueId,
          week,
          type: 'fa',
          teamId,
          pokemonIn: pokemonName,
          pointsIn: pkmn.tier,
          pokemonOut: dropPokemonName || null,
        }).run();

        // Activity log — category 'fa' so the activity feed/filters can
        // distinguish FA movement from trades. (Type 'fa_pickup' was
        // mismatched against category 'trade' historically.)
        db.insert(schema.activityLog).values({
          type: 'fa_pickup',
          category: 'fa',
          actor: user.username,
          leagueId: params.leagueId,
          description: `FA: ${team.teamName} picked up ${pokemonName}${dropPokemonName ? `, dropped ${dropPokemonName}` : ''}`,
          metadata: JSON.stringify({ teamId, pokemonName, dropPokemonName }),
        }).run();

        return { success: true };
      });
    } catch (e: any) {
      if (e?._status) {
        set.status = e._status;
        return { error: e.message, code: e._code };
      }
      throw e;
    }
  })

  // Standalone release (drop only) — no pickup paired. Same phase + deadline
  // gating as pickup. Used by the team-profile "Release" button.
  .post('/api/leagues/:leagueId/free-agents/release', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

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

    return tx(() => {
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
        pointsOut: rosterRow.costAtDraft || rosterRow.tier,
      }).run();

      db.insert(schema.activityLog).values({
        type: 'fa_release',
        category: 'fa',
        actor: user.username,
        leagueId: params.leagueId,
        description: `FA: ${team.teamName} released ${pokemonName}`,
        metadata: JSON.stringify({ teamId, pokemonName }),
      }).run();

      return { success: true };
    });
  });
