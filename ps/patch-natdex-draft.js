#!/usr/bin/env node
/**
 * Patch upstream Pokemon Showdown's `config/formats.ts` to add the Cannoli
 * league banlist to the `[Gen 9] NatDex Draft` format. The upstream entry
 * ships without a banlist; the league rules (`plan/rules`) require a fixed
 * set of ability/item/move bans plus per-Pokemon clauses.
 *
 * Invoked at provisioning time by both:
 *   - `scripts/setup-showdown.sh` (local dev clone)
 *   - `showdown/Dockerfile.server` (Coolify build)
 *
 * Idempotent: running twice is a no-op (detects the marker comment).
 *
 * Usage: node ps/patch-natdex-draft.js <path-to-formats.ts>
 */

const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) {
	console.error('Usage: node patch-natdex-draft.js <path-to-formats.ts>');
	process.exit(1);
}

const absTarget = path.resolve(target);
if (!fs.existsSync(absTarget)) {
	console.error(`File not found: ${absTarget}`);
	process.exit(1);
}

const MARKER = '/* cannoli-natdex-draft-patch */';

let src = fs.readFileSync(absTarget, 'utf8');

if (src.includes(MARKER)) {
	console.log(`[patch] formats.ts already patched — skipping`);
	process.exit(0);
}

// The banlist follows plan/rules: clauses-of-record + per-Pokemon move bans.
// Standard Draft already includes Species/OHKO/Endless Battle/Sleep clauses;
// we add the rest as explicit bans so the format ships ban-complete.
const banlist = [
	// Abilities
	'Shadow Tag', 'Arena Trap', 'Moody',
	// Items
	'Bright Powder', 'Lax Incense', "King's Rock", 'Razor Fang',
	// Moves
	'Acupressure', 'Baton Pass', 'Flatter', 'Frustration', 'Hidden Power',
	'Last Respects', 'Pursuit', 'Return', 'Revival Blessing', 'Shed Tail',
	'Swagger',
	// Per-Pokemon clauses
	'Alakazam-Mega + Nasty Plot',
	'Palafin + Jet Punch',
];

const banlistLine = `\t\tbanlist: ${JSON.stringify(banlist)}, ${MARKER}`;

// Match the exact NatDex Draft block and inject banlist before the closing brace.
const re = /(\{\s*\n\s*name:\s*"\[Gen 9\] NatDex Draft",[\s\S]*?ruleset:\s*\[[^\]]+\],\s*\n)(\s*\},)/m;

if (!re.test(src)) {
	console.error(`[patch] could not locate "[Gen 9] NatDex Draft" block — formats.ts layout may have changed`);
	process.exit(2);
}

src = src.replace(re, `$1${banlistLine}\n$2`);

fs.writeFileSync(absTarget, src);
console.log(`[patch] formats.ts: added banlist to [Gen 9] NatDex Draft`);
