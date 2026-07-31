import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { isStaff, isStaffOrTeamOwner } from '../../lib/auth';
import { tx } from '../../lib/tx';
import { checkLeagueArchived, checkTeamArchived } from '../../lib/archive-guard';
import { deleteTeamCascade } from '../../lib/team-cascade';
import { isR2Configured, r2Put, r2Delete, r2PublicUrl } from '../../lib/r2';
import { writeUpload, uploadsPath } from '../../lib/uploads';
import { getLeagueCostMap } from '../../lib/league-costs';
import { validateRosterLegality, type RosterEntry, type PokeMeta } from '../../lib/roster-legality';
import { refreshUserMap } from '../../lib/ps-bot';

/**
 * Non-throwing whole-roster legality scan for the admin roster-override tool.
 *
 * `validateRosterLegality` returns only the FIRST invariant it finds violated,
 * but the override tool wants to surface EVERY currently-broken invariant as a
 * soft warning. We reuse the shared validator (never reimplement the rules) and
 * isolate each of its four checks by feeding tuned inputs so exactly one
 * invariant can trip per call:
 *   - point_cap  : real entries + empty meta ⇒ no mega/dup can fire; if the cap
 *                  isn't busted the call returns something else which we ignore.
 *   - mega_cap   : synthetic-unique names + form-only meta, caps ∞ ⇒ only mega.
 *   - dup_species: real names + stripped meta, caps ∞ ⇒ only species collisions.
 *   - dup_natdex : real names + dex-only meta, caps ∞ ⇒ dex collisions (a rare
 *                  co-occurring species dup is already reported separately).
 * Messages that embed Pokemon names use REAL names; the name-free point/mega
 * messages are unaffected by the synthetic slot names.
 */
function collectRosterLegalityWarnings(
  entries: RosterEntry[],
  pokeByName: Map<string, PokeMeta>,
  pointCap: number,
): string[] {
  if (entries.length === 0) return [];
  const out: string[] = [];
  const slot = (i: number) => `__slot${i}`;
  const INF = Number.POSITIVE_INFINITY;

  // point_cap — empty meta means no mega/dup can preempt; the point-cap check
  // runs first, so a bust surfaces here regardless of anything else.
  const capV = validateRosterLegality(entries, new Map(), { pointCap, megaCap: INF });
  if (capV?.code === 'point_cap') out.push(capV.message);

  // mega_cap — synthetic-unique names kill dup_species/dup_natdex; caps ∞ kill
  // point_cap. The mega message carries no names, so the slot renaming is safe.
  const megaEntries: RosterEntry[] = entries.map((e, i) => ({
    pokemonName: slot(i), cost: e.cost, isTeraCaptain: e.isTeraCaptain,
  }));
  const megaMeta = new Map<string, PokeMeta>(
    entries.map((e, i) => [slot(i), { formCategory: pokeByName.get(e.pokemonName)?.formCategory ?? null, nationalDexNumber: null }]),
  );
  const megaV = validateRosterLegality(megaEntries, megaMeta, { pointCap: INF, megaCap: 1 });
  if (megaV?.code === 'mega_cap') out.push(megaV.message);

  // dup_species — real names (message names the pair), meta stripped so neither
  // mega nor dup_natdex can fire; caps ∞ so point_cap can't fire.
  const speciesMeta = new Map<string, PokeMeta>(
    entries.map((e) => [e.pokemonName, { formCategory: null, nationalDexNumber: null }]),
  );
  const speciesV = validateRosterLegality(entries, speciesMeta, { pointCap: INF, megaCap: INF });
  if (speciesV?.code === 'dup_species') out.push(speciesV.message);

  // dup_natdex — real names + real dex numbers, formCategory stripped. A species
  // dup would preempt this, but that case is already covered by the check above.
  const dexMeta = new Map<string, PokeMeta>(
    entries.map((e) => [e.pokemonName, { formCategory: null, nationalDexNumber: pokeByName.get(e.pokemonName)?.nationalDexNumber ?? null }]),
  );
  const dexV = validateRosterLegality(entries, dexMeta, { pointCap: INF, megaCap: INF });
  if (dexV?.code === 'dup_natdex') out.push(dexV.message);

  return out;
}

export const teamAdminRoutes = new Elysia()

  // Team creation (per-league)

  .post('/api/leagues/:leagueId/teams', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkLeagueArchived(params.leagueId, query.force);
    if (archived) { set.status = 409; return archived; }
    const { id, coachName, teamName, teamAbbrev, teamColor, userId } = body as {
      id?: string;
      coachName: string;
      teamName: string;
      teamAbbrev: string;
      teamColor?: string;
      userId?: number | null;
    };
    if (!coachName || !teamName || !teamAbbrev) {
      set.status = 400; return { error: 'coachName, teamName, teamAbbrev required' };
    }
    const teamId = id ?? `${params.leagueId}-${teamAbbrev.toLowerCase()}`;
    const exists = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    if (exists) { set.status = 409; return { error: `Team ${teamId} already exists` }; }

    tx(() => {
      db.insert(schema.teams).values({
        id: teamId,
        leagueId: params.leagueId,
        userId: userId ?? null,
        coachName,
        teamName,
        teamAbbrev,
        teamColor: teamColor ?? '#888888',
      }).run();
      db.insert(schema.activityLog).values({
        type: 'team_created',
        category: 'admin',
        actor: user.username,
        leagueId: params.leagueId,
        description: `Created team ${teamName} (${teamAbbrev})`,
        metadata: JSON.stringify({ teamId, userId, coachName }),
      }).run();
    });

    return { id: teamId };
  })

  // Team update

  .put('/api/teams/:teamId', ({ params, query, body, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }
    const staff = isStaff(user);

    const { coachName, teamName, teamAbbrev, teamColor, userId, bio, captainNote } = body as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    // Owner-allowed fields:
    if (typeof teamColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(teamColor)) updates.teamColor = teamColor;
    if (bio !== undefined) {
      if (bio === null || bio === '') updates.bio = null;
      else if (typeof bio === 'string' && bio.length <= 280) updates.bio = bio;
      else { set.status = 400; return { error: 'bio must be a string ≤ 280 chars' }; }
    }
    if (captainNote !== undefined) {
      if (captainNote === null || captainNote === '') updates.captainNote = null;
      else if (typeof captainNote === 'string' && captainNote.length <= 280) updates.captainNote = captainNote;
      else { set.status = 400; return { error: 'captainNote must be a string ≤ 280 chars' }; }
    }
    // Staff-only fields:
    if (staff) {
      if (typeof coachName === 'string' && coachName.trim()) updates.coachName = coachName.trim();
      if (typeof teamName === 'string' && teamName.trim()) updates.teamName = teamName.trim();
      if (typeof teamAbbrev === 'string' && teamAbbrev.trim()) updates.teamAbbrev = teamAbbrev.trim();
      if (userId === null) updates.userId = null;
      else if (typeof userId === 'number') updates.userId = userId;
    }

    if (Object.keys(updates).length === 0) {
      set.status = 400; return { error: 'No valid fields to update' };
    }

    tx(() => {
      db.update(schema.teams).set(updates).where(eq(schema.teams.id, params.teamId)).run();
      db.insert(schema.activityLog).values({
        type: 'team_updated',
        category: 'admin',
        actor: user.username,
        leagueId: team.leagueId,
        description: `Updated team ${team.teamAbbrev}: ${Object.keys(updates).join(', ')}`,
        metadata: JSON.stringify({ teamId: params.teamId, updates }),
      }).run();
    });

    return { success: true };
  })

  // Roster override (staff-only, free-reign add/remove)
  // Lets an admin freely add/remove Pokemon on ANY team's roster, persisting
  // straight to the rosters table and BYPASSING every free-agency gate (budget,
  // deadline, playoff lockout, already-rostered, roster band, point/mega/legality
  // caps). It never blocks on those — instead each broken invariant comes back as
  // a human-readable SOFT WARNING. "Free reign, but warn."

  .post('/api/teams/:teamId/roster-override', ({ params, query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }

    const raw = (body ?? {}) as {
      add?: Array<{ name: string; isTeraCaptain?: boolean; teraTypes?: string[]; isShiny?: boolean; nickname?: string | null }>;
      removeRosterIds?: number[];
    };
    const adds = Array.isArray(raw.add) ? raw.add : [];
    const removeIds = Array.isArray(raw.removeRosterIds) ? raw.removeRosterIds : [];

    if (adds.length === 0 && removeIds.length === 0) {
      set.status = 400; return { error: 'No changes' };
    }

    // League (currentWeek + phase) and the format cost map for tier resolution.
    const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get();
    const season = league
      ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get()
      : null;
    const costMap = getLeagueCostMap(team.leagueId);

    const result = tx(() => {
      const added: string[] = [];
      const removed: string[] = [];
      const warnings: string[] = [];

      // Removes first
      // Delete only rows that exist AND belong to this team; silently skip ids
      // that don't. Mirror the FA release cleanup (clear any trade-block listing).
      for (const id of removeIds) {
        const row = db.select().from(schema.rosters).where(eq(schema.rosters.id, id)).get();
        if (!row || row.teamId !== params.teamId) continue;
        db.delete(schema.rosters).where(eq(schema.rosters.id, id)).run();
        db.delete(schema.tradeBlockListings)
          .where(and(
            eq(schema.tradeBlockListings.leagueId, team.leagueId),
            eq(schema.tradeBlockListings.teamId, params.teamId),
            eq(schema.tradeBlockListings.pokemonName, row.pokemonName),
          ))
          .run();
        removed.push(row.pokemonName);
      }

      // Adds
      // Track names already on the team AFTER removes so the unique
      // (teamId, pokemonName) index can never be hit — a same-team dup would
      // throw and abort the whole tx, so pre-check and warn instead.
      const onTeam = new Set(
        db.select({ name: schema.rosters.pokemonName })
          .from(schema.rosters)
          .where(eq(schema.rosters.teamId, params.teamId))
          .all()
          .map(r => r.name),
      );

      for (const a of adds) {
        const name = a?.name;
        if (!name || typeof name !== 'string') continue;
        if (onTeam.has(name)) {
          warnings.push(`${name} is already on this team (skipped)`);
          continue;
        }

        // Resolve tier: league format map → global pokemon baseline → 0.
        let tier = costMap.get(name)?.tier;
        if (tier == null) {
          const baseline = db.select({ tier: schema.pokemon.tier })
            .from(schema.pokemon).where(eq(schema.pokemon.name, name)).get();
          tier = baseline?.tier ?? 0;
        }

        const teraTypes = Array.isArray(a.teraTypes) ? a.teraTypes : [];
        const isCaptain = !!a.isTeraCaptain;
        db.insert(schema.rosters).values({
          teamId: params.teamId,
          pokemonName: name,
          tier,
          costAtDraft: tier,
          isTeraCaptain: isCaptain,
          teraType1: isCaptain ? (teraTypes[0] ?? null) : null,
          teraType2: isCaptain ? (teraTypes[1] ?? null) : null,
          teraType3: isCaptain ? (teraTypes[2] ?? null) : null,
          isShiny: !!a.isShiny,
          nickname: a.nickname ?? null,
          acquiredVia: 'admin',
          acquiredWeek: league?.currentWeek ?? null,
        }).run();
        onTeam.add(name);
        added.push(name);
      }

      // Warnings on the RESULTING roster (soft, never blocking)
      const finalRoster = db.select().from(schema.rosters)
        .where(eq(schema.rosters.teamId, params.teamId)).all();

      // Roster size band (effective min/max; NULL columns fall back to rosterSize).
      if (league) {
        const effMax = league.maxRosterSize ?? league.rosterSize;
        const effMin = league.minRosterSize ?? league.rosterSize;
        if (finalRoster.length > effMax) {
          warnings.push(`Roster is at ${finalRoster.length} Pokemon (max ${effMax})`);
        }
        if (finalRoster.length < effMin) {
          warnings.push(`Roster is at ${finalRoster.length} Pokemon (min ${effMin})`);
        }
      }

      // Point cap + mega cap + dup natdex + dup species — reuse the shared
      // validator, collecting ALL applicable violations (not just the first).
      const pokemonRows = finalRoster.length
        ? db.select().from(schema.pokemon)
            .where(inArray(schema.pokemon.name, finalRoster.map(r => r.pokemonName))).all()
        : [];
      const pokeByName = new Map<string, PokeMeta>(pokemonRows.map(p => [p.name, p]));
      const pointCap = season?.pointCap ?? 110;
      const rosterEntries: RosterEntry[] = finalRoster.map(r => ({
        pokemonName: r.pokemonName,
        cost: r.costAtDraft ?? r.tier ?? 0,
        isTeraCaptain: !!r.isTeraCaptain,
      }));
      warnings.push(...collectRosterLegalityWarnings(rosterEntries, pokeByName, pointCap));

      // Format-illegal ADDED mons.
      for (const name of added) {
        const c = costMap.get(name);
        if (!c || c.tier <= 0) warnings.push(`${name} is not draftable in this format`);
        else if (c.banned) warnings.push(`${name} is banned in this format`);
      }

      // ADDED mons already rostered on ANOTHER team in the same league.
      const otherTeams = db.select({
        id: schema.teams.id, teamAbbrev: schema.teams.teamAbbrev, teamName: schema.teams.teamName,
      })
        .from(schema.teams)
        .where(eq(schema.teams.leagueId, team.leagueId))
        .all()
        .filter(t => t.id !== params.teamId);
      for (const name of added) {
        for (const ot of otherTeams) {
          const has = db.select({ id: schema.rosters.id })
            .from(schema.rosters)
            .where(and(eq(schema.rosters.teamId, ot.id), eq(schema.rosters.pokemonName, name)))
            .get();
          if (has) {
            warnings.push(`${name} is also on ${ot.teamAbbrev || ot.teamName}`);
            break;
          }
        }
      }

      db.insert(schema.activityLog).values({
        type: 'roster_override',
        category: 'admin',
        actor: user.username,
        leagueId: team.leagueId,
        description: `Roster override on ${team.teamAbbrev}: +${added.length} -${removed.length}`,
        metadata: JSON.stringify({ teamId: params.teamId, added, removed, warnings }),
      }).run();

      return { success: true as const, added, removed, warnings };
    });

    // Best-effort: refresh the PS bot's user→team map after roster change.
    try { refreshUserMap(); } catch {}

    return result;
  })

  // Roster nickname (owner or admin)

  .put('/api/teams/:teamId/rosters/:rosterId/nickname', ({ params, query, body, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }
    const rosterId = parseInt(params.rosterId);
    if (!Number.isFinite(rosterId)) { set.status = 400; return { error: 'Invalid rosterId' }; }

    const roster = db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.id, rosterId), eq(schema.rosters.teamId, params.teamId)))
      .get();
    if (!roster) { set.status = 404; return { error: 'Roster entry not found for this team' }; }

    const { nickname } = body as { nickname?: string | null };
    let normalized: string | null;
    if (nickname == null) {
      normalized = null;
    } else if (typeof nickname === 'string') {
      const trimmed = nickname.trim();
      if (trimmed.length === 0) {
        normalized = null;
      } else if (trimmed.length > 40) {
        set.status = 400;
        return { error: 'nickname must be ≤ 40 characters' };
      } else {
        normalized = trimmed;
      }
    } else {
      set.status = 400;
      return { error: 'nickname must be a string or null' };
    }

    db.update(schema.rosters)
      .set({ nickname: normalized })
      .where(eq(schema.rosters.id, rosterId))
      .run();

    return { success: true, nickname: normalized };
  })

  // Team delete (with safety: forbid if has roster/picks/match-results)

  .delete('/api/teams/:teamId', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }

    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }

    const force = query.force === '1' || query.force === 'true';

    const rosterCount = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.rosters).where(eq(schema.rosters.teamId, params.teamId)).get()?.c ?? 0;
    const matchPokemonCount = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.matchPokemon).where(eq(schema.matchPokemon.teamId, params.teamId)).get()?.c ?? 0;
    const matchCount = db.select({ c: sql<number>`COUNT(*)` })
      .from(schema.matches)
      .where(sql`(${schema.matches.homeTeamId} = ${params.teamId} OR ${schema.matches.awayTeamId} = ${params.teamId}) AND ${schema.matches.homeScore} IS NOT NULL`)
      .get()?.c ?? 0;

    if (!force && (rosterCount > 0 || matchPokemonCount > 0 || matchCount > 0)) {
      set.status = 409;
      return {
        error: `Team has ${rosterCount} roster entries, ${matchPokemonCount} match stats, ${matchCount} completed matches. Pass ?force=1 to delete anyway.`,
        code: 'TEAM_HAS_DATA',
        rosterCount,
        matchPokemonCount,
        matchCount,
      };
    }

    tx(() => {
      // Cascade clean up team-scoped rows + draft-order reconciliation. Shared
      // with the membership "remove coach" route so both stay in lockstep.
      deleteTeamCascade(params.teamId, team.leagueId);

      db.insert(schema.activityLog).values({
        type: 'team_deleted',
        category: 'admin',
        actor: user.username,
        leagueId: team.leagueId,
        description: `Deleted team ${team.teamName} (${team.teamAbbrev})${force ? ' [forced]' : ''}`,
        metadata: JSON.stringify({ teamId: params.teamId, force, rosterCount, matchPokemonCount, matchCount }),
      }).run();
    });

    return { success: true };
  })

  // Team logo upload

  .post('/api/teams/:teamId/logo', async ({ params, query, request, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }

    const form = await request.formData().catch(() => null);
    const file = form?.get('logo');
    if (!(file instanceof File)) { set.status = 400; return { error: 'No file uploaded under "logo" field' }; }
    if (!file.type.startsWith('image/')) { set.status = 400; return { error: 'File must be an image' }; }
    if (file.size > 2 * 1024 * 1024) { set.status = 400; return { error: 'File must be ≤ 2MB' }; }

    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) ? ext : 'png';
    const filename = `${params.teamId}.${safeExt}`;
    const key = `team-logos/${filename}`;

    let storedPath: string;
    if (isR2Configured()) {
      const buf = await file.arrayBuffer();
      await r2Put(key, buf, file.type);
      storedPath = r2PublicUrl(key);
    } else {
      await writeUpload(key, file);
      storedPath = key;
    }

    db.update(schema.teams).set({ logoPath: storedPath }).where(eq(schema.teams.id, params.teamId)).run();
    db.insert(schema.activityLog).values({
      type: 'team_logo_uploaded',
      category: 'team',
      actor: user!.username,
      leagueId: team.leagueId,
      description: `Uploaded logo for ${team.teamName}`,
      metadata: JSON.stringify({ teamId: params.teamId, path: storedPath, size: file.size }),
    }).run();

    return { success: true, path: storedPath };
  })

  // Team logo remove

  .delete('/api/teams/:teamId/logo', ({ params, query, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }

    db.update(schema.teams).set({ logoPath: null }).where(eq(schema.teams.id, params.teamId)).run();
    db.insert(schema.activityLog).values({
      type: 'team_logo_removed',
      category: 'team',
      actor: user!.username,
      leagueId: team.leagueId,
      description: `Removed logo for ${team.teamName}`,
      metadata: JSON.stringify({ teamId: params.teamId }),
    }).run();

    return { success: true };
  })

  // Team banner upload

  .post('/api/teams/:teamId/banner', async ({ params, query, request, user, set }) => {
    if (!isStaffOrTeamOwner(user, params.teamId)) { set.status = 403; return { error: 'Forbidden' }; }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    const archived = checkTeamArchived(params.teamId, query.force);
    if (archived) { set.status = 409; return archived; }

    const form = await request.formData().catch(() => null);
    const file = form?.get('banner');
    if (!(file instanceof File)) { set.status = 400; return { error: 'No file uploaded under "banner" field' }; }
    if (!file.type.startsWith('image/')) { set.status = 400; return { error: 'File must be an image' }; }
    if (file.size > 1024 * 1024) { set.status = 400; return { error: 'File must be ≤ 1MB' }; }

    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png';
    const filename = `${params.teamId}.${safeExt}`;
    const relativePath = `team-banners/${filename}`;

    await writeUpload(relativePath, file);

    db.update(schema.teams).set({ bannerPath: relativePath }).where(eq(schema.teams.id, params.teamId)).run();
    db.insert(schema.activityLog).values({
      type: 'team_banner_uploaded',
      category: 'team',
      actor: user!.username,
      leagueId: team.leagueId,
      description: `Uploaded banner for ${team.teamName}`,
      metadata: JSON.stringify({ teamId: params.teamId, path: relativePath, size: file.size }),
    }).run();

    return { success: true, path: `/uploads/${relativePath}` };
  })

  // Static upload serving

  .get('/uploads/:dir/:file', async ({ params, set }) => {
    // Whitelist directories — only the ones we write to
    const ALLOWED_DIRS = ['team-logos', 'team-banners', 'user-avatars', 'user-banners', 'feedback-screenshots'];
    if (!ALLOWED_DIRS.includes(params.dir)) { set.status = 404; return 'Not found'; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(params.file)) { set.status = 400; return 'Invalid filename'; }
    const path = uploadsPath(`${params.dir}/${params.file}`);
    const f = Bun.file(path);
    if (!(await f.exists())) { set.status = 404; return 'Not found'; }
    return new Response(f);
  })

;
