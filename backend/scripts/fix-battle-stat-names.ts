#!/usr/bin/env bun
/**
 * fix-battle-stat-names.ts — one-time repair for per-Pokemon match stats that
 * never attached to a team page because the stored `match_pokemon.pokemon_name`
 * (as it appeared in the Showdown battle log) differs from the drafted roster
 * name the read-side JOINs against.
 *
 * The live-battle pipeline used to store the raw in-battle forme name, so:
 *   - "Palafin-Hero"  never joined roster "Palafin"        (Zero to Hero)
 *   - "Lopunny" / "Lopunny-Mega" never joined "Mega Lopunny"
 *   - "Indeedee" never joined "Indeedee-F"                 (default-forme collapse)
 * The write paths now call resolveRosterPokemonName() so new rows land correct;
 * this backfills the rows already written.
 *
 * For every match_pokemon row we load the drafted roster of its team and compute
 * resolveRosterPokemonName(rosterNames, storedName). A rewrite is proposed ONLY
 * when the resolved name differs AND genuinely exists in that team's roster (a
 * real drafted slot — never the passthrough fallback), so legitimate trades /
 * free-agents / never-rostered mons are left untouched.
 *
 * SAFETY: a rewrite that would collide with an existing (match, team, name) row
 * (or with another proposed rewrite) is NOT applied — it's printed loudly for
 * manual review and skipped. Rows that share a species with a roster slot but a
 * DIFFERING forme (Mega Charizard Y vs roster X, Rotom-Mow vs Rotom-Heat) are a
 * genuine data discrepancy, never auto-rewritten — reported for manual review.
 *
 * Dry-run by default; pass --apply to write. Optional `--season <prefix>` scopes
 * to matches whose id starts with that prefix. No VACUUM, no schema changes.
 *
 *   bun run scripts/fix-battle-stat-names.ts               # dry-run, all rows
 *   bun run scripts/fix-battle-stat-names.ts --season s11- # dry-run, S11 only
 *   bun run scripts/fix-battle-stat-names.ts --apply       # write, all rows
 *   bun run scripts/fix-battle-stat-names.ts --season s11- --apply
 */
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { tx } from '../src/lib/tx';
import { getBaseFormName, resolveRosterPokemonName } from '../src/lib/pokedex';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const seasonIdx = argv.indexOf('--season');
const seasonPrefix = seasonIdx >= 0 ? argv[seasonIdx + 1] : null;
if (seasonIdx >= 0 && !seasonPrefix) {
  console.error('--season requires a prefix argument, e.g. --season s11-');
  process.exit(1);
}

console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
console.log(`Scope: ${seasonPrefix ? `matchId prefix "${seasonPrefix}"` : 'all seasons'}\n`);

// Per-Pokemon rows, optionally scoped to a season by matchId prefix. All rows of
// a given match share its matchId, so a prefix filter never splits a match — the
// collision index below is therefore complete within the scanned set.
const allRows = db.select().from(schema.matchPokemon).all();
const rows = seasonPrefix ? allRows.filter(r => r.matchId.startsWith(seasonPrefix)) : allRows;
console.log(`Scanning ${rows.length} match_pokemon rows…\n`);

// Per-team roster name cache (rosters don't change during the run).
const rosterCache = new Map<string, string[]>();
const rosterNamesFor = (teamId: string): string[] => {
  let names = rosterCache.get(teamId);
  if (!names) {
    names = db.select({ name: schema.rosters.pokemonName })
      .from(schema.rosters)
      .where(eq(schema.rosters.teamId, teamId))
      .all()
      .map(r => r.name);
    rosterCache.set(teamId, names);
  }
  return names;
};

// Index existing (matchId, teamId, pokemonName) tuples → row ids, for collision
// detection. A rewrite must never produce a tuple another row already occupies.
const tupleKey = (matchId: string, teamId: string, name: string) =>
  `${matchId}|${teamId}|${name}`;
const existingByTuple = new Map<string, number[]>();
for (const r of rows) {
  const k = tupleKey(r.matchId, r.teamId, r.pokemonName);
  const arr = existingByTuple.get(k);
  if (arr) arr.push(r.id);
  else existingByTuple.set(k, [r.id]);
}

interface Change {
  id: number;
  matchId: string;
  teamId: string;
  oldName: string;
  newName: string;
  kills: number;
}
const changes: Change[] = [];
const collisions: string[] = [];
const discrepancies: string[] = [];
const acceptedTargets = new Set<string>();

for (const r of rows) {
  const rosterNames = rosterNamesFor(r.teamId);
  const resolved = resolveRosterPokemonName(rosterNames, r.pokemonName);

  const isRewrite = resolved !== r.pokemonName && rosterNames.includes(resolved);

  if (isRewrite) {
    const newKey = tupleKey(r.matchId, r.teamId, resolved);

    // Collision with a DIFFERENT existing row?
    const clashIds = (existingByTuple.get(newKey) ?? []).filter(id => id !== r.id);
    if (clashIds.length > 0) {
      collisions.push(
        `COLLISION  match=${r.matchId} team=${r.teamId}  row#${r.id} "${r.pokemonName}" -> "${resolved}"` +
        ` clashes with existing row(s) #${clashIds.join(',')} — SKIPPED`,
      );
      continue;
    }
    // Collision with another rewrite already accepted this run?
    if (acceptedTargets.has(newKey)) {
      collisions.push(
        `COLLISION  match=${r.matchId} team=${r.teamId}  row#${r.id} "${r.pokemonName}" -> "${resolved}"` +
        ` clashes with another proposed rewrite — SKIPPED`,
      );
      continue;
    }

    acceptedTargets.add(newKey);
    changes.push({
      id: r.id,
      matchId: r.matchId,
      teamId: r.teamId,
      oldName: r.pokemonName,
      newName: resolved,
      kills: r.kills,
    });
    continue;
  }

  // Not rewritten. Flag any roster slot that shares this mon's species but which
  // the representation guard declined (differing forme) — a genuine discrepancy
  // (wrong forme played/recorded), left raw for manual review rather than
  // silently "corrected". A correctly-stored exact row has y === resolved and is
  // excluded; the one-slot-per-dex rule means at most one candidate.
  const storedKey = getBaseFormName(r.pokemonName);
  for (const y of rosterNames) {
    if (y !== resolved && getBaseFormName(y) === storedKey) {
      discrepancies.push(`${r.matchId} | ${r.teamId} | stored "${r.pokemonName}" vs roster "${y}"`);
    }
  }
}

// Report
if (changes.length === 0) {
  console.log('No rewrites proposed — every row already matches its roster slot.');
} else {
  console.log(`Proposed ${changes.length} rewrite(s):\n`);
  console.log('  matchId | teamId | "oldName" -> "newName" (kills=K)');
  console.log('  ' + '-'.repeat(58));
  for (const c of changes) {
    console.log(`  ${c.matchId} | ${c.teamId} | "${c.oldName}" -> "${c.newName}" (kills=${c.kills})`);
  }
  console.log('');
}

if (collisions.length > 0) {
  console.log(`\n!! ${collisions.length} COLLISION(S) — NOT rewritten, review manually:`);
  for (const line of collisions) console.log('  ' + line);
  console.log('');
}

if (discrepancies.length > 0) {
  console.log(`\n!! ${discrepancies.length} DISCREPANCIES (same species, differing forme — NOT rewritten, review manually):`);
  for (const line of discrepancies) console.log('  ' + line);
  console.log('');
}

// Apply
if (APPLY && changes.length > 0) {
  tx(() => {
    for (const c of changes) {
      db.update(schema.matchPokemon)
        .set({ pokemonName: c.newName })
        .where(eq(schema.matchPokemon.id, c.id))
        .run();
    }
  });
  console.log(`Applied ${changes.length} rewrite(s).`);
} else {
  console.log(
    changes.length > 0
      ? 'Dry-run only — re-run with --apply to write.'
      : 'Nothing to apply.',
  );
}

console.log(
  `\nSummary [${seasonPrefix ? `scope "${seasonPrefix}"` : 'all seasons'}]: ` +
  `scanned ${rows.length}, proposed ${changes.length}, ` +
  `collisions ${collisions.length}, discrepancies ${discrepancies.length}.`,
);
