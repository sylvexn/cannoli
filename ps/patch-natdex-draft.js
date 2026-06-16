#!/usr/bin/env node
/**
 * Patch upstream Pokemon Showdown's `config/formats.ts` for Cannoli. Two
 * independent, idempotent patches:
 *   1. Add the Cannoli league banlist to the `[Gen 9] NatDex Draft` format.
 *      The upstream entry ships without a banlist; the league rules
 *      (`plan/rules`) require a fixed set of ability/item/move bans plus
 *      per-Pokemon clauses.
 *   2. Guard the Tera Captains team-preview line so a side with no Tera
 *      Captains doesn't emit a blank `this.add('')` (which renders as a stray
 *      empty line in the battle/replay chat).
 *
 * Invoked at provisioning time by both:
 *   - `scripts/setup-showdown.sh` (local dev clone)
 *   - `showdown/Dockerfile.server` (Coolify build)
 *
 * Idempotent: each patch detects its own marker and skips if already applied,
 * so running twice — or with only one of the two already present — is safe.
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
let changed = false;

// ── Patch 1: NatDex Draft banlist ───────────────────────────────────────────
if (src.includes(MARKER)) {
	console.log(`[patch] banlist already applied — skipping`);
} else {
	src = applyBanlist(src);
	changed = true;
}

// ── Patch 2: guard the empty Tera Captains team-preview line ─────────────────
// onTeamPreview() builds `buf` only for sides that have Tera Captains, then
// unconditionally `this.add(`${buf}`)`. A side with none adds an empty line.
const TERA_BUGGY = 'this.add(`${buf}`);';
const TERA_FIXED = 'if (buf) this.add(`${buf}`);';
if (src.includes(TERA_FIXED)) {
	console.log(`[patch] tera-captains preview guard already applied — skipping`);
} else if (src.includes(TERA_BUGGY)) {
	src = src.replace(TERA_BUGGY, TERA_FIXED);
	changed = true;
	console.log(`[patch] formats.ts: guarded empty Tera Captains team-preview line`);
} else {
	console.warn(`[patch] tera-captains preview line not found — upstream may have changed (skipping)`);
}

if (changed) fs.writeFileSync(absTarget, src);
process.exit(0);

function applyBanlist(src) {
// The banlist follows plan/rules: clauses-of-record + per-Pokemon move bans.
// Standard Draft already includes Species/OHKO/Endless Battle/Sleep + the
// full Evasion Clause (which already bans Bright Powder + Lax Incense via
// Evasion Items Clause, and Acupressure/Minimize/Double Team via Evasion
// Moves Clause). Re-listing those triggers a hard crash on every socket
// connect — `Rule "-item:brightpowder" already exists in "Evasion Items
// Clause"` thrown out of getRuleTable, which kills the format-list build
// that runs on each handleConnect, so the client never gets |challstr|
// and /trn auto-login never fires.
const banlist = [
	// Abilities
	'Shadow Tag', 'Arena Trap', 'Moody',
	// Items (Bright Powder + Lax Incense already in Evasion Items Clause)
	"King's Rock", 'Razor Fang',
	// Moves (Acupressure already in Evasion Moves Clause)
	'Baton Pass', 'Flatter', 'Frustration', 'Hidden Power',
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

console.log(`[patch] formats.ts: added banlist to [Gen 9] NatDex Draft`);
return src;
}
