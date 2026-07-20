#!/usr/bin/env node
/**
 * Patch upstream Pokemon Showdown's `config/formats.ts` for Cannoli. Three
 * independent, idempotent patches:
 *   1. Add the Cannoli league banlist to the `[Gen 9] NatDex Draft` format.
 *      The upstream entry ships without a banlist; the league rules
 *      (`plan/rules`) require a fixed set of ability/item/move bans plus
 *      per-Pokemon clauses.
 *   2. Guard the empty Tera Captains team-preview line in upstream's OWN
 *      "[Gen 9] Draft Factory" format (a random-teams ladder format, unrelated
 *      to Cannoli's real league play — despite the name, this is NOT the
 *      Cannoli Tera Captain feature). Historical patch, kept for hygiene.
 *   3. Strip 'Tera Type Preview' back OUT of NatDex Draft's ruleset. It was
 *      added here for feedback #44 (Ready Up battles ran with no team preview
 *      at all), but its icon line reads `pokemon.teraType` off whatever team
 *      the player happens to have saved client-side — which Cannoli doesn't
 *      control and which essentially never has a teraType set — so it always
 *      rendered as empty separators ("caleb's Tera Types: /////", feedback
 *      #49). Team Preview itself (pick order + reveal) is unaffected — it
 *      comes from 'Standard Draft' independently of this rule. CannoliBot now
 *      posts its OWN correct preview (sourced from rosters.teraType1/2/3) via
 *      the `/cannoli-tera-preview` plugin command once both players join (see
 *      ps/cannoli.ts + backend/src/lib/ps-bot.ts sendTeraPreview) — this patch
 *      just gets the broken vanilla line out of the way so it isn't shown
 *      twice.
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

// ── Patch 3: strip 'Tera Type Preview' back out of NatDex Draft ────────────
// See module doc above — the vanilla rule can't show correct data for
// bot-created battles (the player's own team never has teraType set), so
// Cannoli replaces it with its own roster-sourced preview instead. This is
// CONVERGENT (actively removes the entry if present), not skip-if-touched, so
// a formats.ts left over from a build before this patch changed still ends up
// correct on the next provision.
{
	const res = stripTeraPreview(src);
	if (res.changed) { src = res.src; changed = true; }
}

// ── Patch 2: guard the empty Tera Captains line in upstream's Draft Factory ──
// onTeamPreview() builds `buf` only for sides that have Tera Captains, then
// unconditionally `this.add(`${buf}`)`. A side with none adds an empty line.
// NOTE: this is the "[Gen 9] Draft Factory" format's OWN onTeamPreview (a
// random-teams ladder format upstream ships with a same-named "Tera Captains"
// mechanic) — not Cannoli's NatDex Draft. See module doc above.
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

function stripTeraPreview(src) {
	// Match the NatDex Draft block's own ruleset array (non-greedy from its name
	// to the first ruleset: after it).
	const re = /(name:\s*"\[Gen 9\] NatDex Draft",[\s\S]*?ruleset:\s*\[)([^\]]*)(\])/m;
	const m = re.exec(src);
	if (!m) {
		console.warn(`[patch] NatDex Draft ruleset not found for Tera Preview — skipping`);
		return { src, changed: false };
	}
	if (!/['"]Tera Type Preview['"]/.test(m[2])) {
		console.log(`[patch] Tera Type Preview not in ruleset — nothing to strip`);
		return { src, changed: false };
	}
	// Remove the entry along with a leading ", " (or trailing ", " if it's first).
	let newInner = m[2]
		.replace(/,\s*['"]Tera Type Preview['"]/, '')
		.replace(/['"]Tera Type Preview['"],\s*/, '');
	const updated = src.slice(0, m.index) + m[1] + newInner + m[3] + src.slice(m.index + m[0].length);
	console.log(`[patch] formats.ts: stripped Tera Type Preview from NatDex Draft ruleset`);
	return { src: updated, changed: true };
}

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
