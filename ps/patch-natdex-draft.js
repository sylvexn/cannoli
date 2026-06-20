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

// ── Patch 1: NatDex Draft banlist (convergent) ──────────────────────────────
{
	const res = patchBanlist(src);
	if (res.changed) { src = res.src; changed = true; }
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

function patchBanlist(src) {
// The banlist follows plan/rules: clauses-of-record + per-Pokemon move bans.
// Standard Draft already includes Species/OHKO/Endless Battle/Sleep + the
// full Evasion Clause (which already bans Bright Powder + Lax Incense via
// Evasion Items Clause, and Acupressure/Minimize/Double Team via Evasion
// Moves Clause). Re-listing those triggers a hard crash on every socket
// connect — `Rule "-item:brightpowder" already exists in "Evasion Items
// Clause"` thrown out of getRuleTable, which kills the format-list build
// that runs on each handleConnect, so the client never gets |challstr|
// and /trn auto-login never fires.
// This banlist is applied at the PS server level for ALL Cannoli formats.
// Per-league bans (e.g. Jet Punch in Emerald but not Ruby/Sapphire) are
// intentionally NOT listed here — they are enforced in the backend
// post-match legality check (replay-parser.ts LEAGUE_BANNED_MOVES stub)
// so they don't block battles from starting on the PS server. Add only
// bans that apply universally across ALL leagues.
const banlist = [
	// Abilities
	'Shadow Tag', 'Arena Trap', 'Moody',
	// Items (Bright Powder + Lax Incense already in Evasion Items Clause)
	"King's Rock", 'Razor Fang',
	// Moves (Acupressure already in Evasion Moves Clause)
	'Baton Pass', 'Flatter', 'Frustration', 'Hidden Power',
	'Last Respects', 'Pursuit', 'Return', 'Revival Blessing', 'Shed Tail',
	'Swagger',
	// Per-Pokemon clauses (universal only — per-league combos go in LEAGUE_BANNED_MOVES)
	'Alakazam-Mega + Nasty Plot',
	// NOTE: 'Palafin + Jet Punch' was removed — Jet Punch is only banned in
	// the Emerald format, not Ruby/Sapphire. Blocking it here broke Ruby/Sapphire
	// battles. Per-league enforcement is handled in the backend warn-only check.
];

const banlistJson = JSON.stringify(banlist);

// CONVERGENT, not skip-if-touched. If a previous build already injected our
// marker'd banlist line, REPLACE it with the current banlist so edits (e.g.
// dropping a per-league ban) actually take effect on rebuild. The old logic
// skipped whenever the marker was present, which permanently stranded any
// later banlist change on a formats.ts that had been patched once before.
const markedRe = /^([ \t]*)banlist:\s*\[[^\]]*\],[ \t]*\/\* cannoli-natdex-draft-patch \*\/[ \t]*$/m;
if (markedRe.test(src)) {
	const updated = src.replace(markedRe, (_m, indent) => `${indent}banlist: ${banlistJson}, ${MARKER}`);
	if (updated === src) {
		console.log(`[patch] banlist already current — no change`);
		return { src, changed: false };
	}
	console.log(`[patch] formats.ts: refreshed NatDex Draft banlist (converged)`);
	return { src: updated, changed: true };
}

// First-time inject: add the banlist line before the format block's closing brace.
const re = /(\{\s*\n\s*name:\s*"\[Gen 9\] NatDex Draft",[\s\S]*?ruleset:\s*\[[^\]]+\],\s*\n)(\s*\},)/m;
if (!re.test(src)) {
	console.error(`[patch] could not locate "[Gen 9] NatDex Draft" block — formats.ts layout may have changed`);
	process.exit(2);
}
const banlistLine = `\t\tbanlist: ${banlistJson}, ${MARKER}`;
console.log(`[patch] formats.ts: added banlist to [Gen 9] NatDex Draft`);
return { src: src.replace(re, `$1${banlistLine}\n$2`), changed: true };
}
