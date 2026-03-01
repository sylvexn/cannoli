/**
 * Pokemon Showdown game server configuration for Cannoli.
 *
 * Copy this to config/config.js in the cloned PS game server repo.
 * Set env vars for RSA public key and other secrets.
 *
 * Clone: git clone https://github.com/smogon/pokemon-showdown.git
 * Install: npm install (or bun install)
 * Config: cp cannoli-config.js config/config.js
 * Plugin: cp cannoli.ts server/chat-plugins/cannoli.ts
 * Start: node pokemon-showdown start
 */

'use strict';

// ─── Server Identity ────────────────────────────────────────────────────────

exports.port = 8000;
exports.bindaddress = '0.0.0.0';

// ─── Login Server (our Elysia backend) ──────────────────────────────────────

// Point at Cannoli's PS login endpoints
exports.loginserver = process.env.PS_LOGIN_SERVER_URL || 'https://cannoli.live/api/ps/';

// RSA public key for verifying assertions (matches the private key in Elysia)
exports.loginserverpublickeyid = parseInt(process.env.PS_KEY_ID || '4', 10);
exports.loginserverpublickey = process.env.PS_RSA_PUBLIC_KEY || '';

// RSA-SHA1 is the standard PS algorithm
exports.loginserverkeyalgo = 'RSA-SHA1';

// ─── Replays ────────────────────────────────────────────────────────────────

// Auto-save all replays to disk (public)
exports.autosavereplays = true;

// ─── Routes / Domains ───────────────────────────────────────────────────────

exports.routes = {
	root: 'sim.cannoli.live',
	client: 'sim.cannoli.live',
};

// Legal hosts for assertion hostname validation
exports.legalhosts = ['cannoli.live', 'sim.cannoli.live'];

// ─── Format ─────────────────────────────────────────────────────────────────

// [Gen 9] NatDex Draft is a built-in format — no custom format needed.
// League-specific bans are applied via the chat plugin or /banlist command.

// ─── Bot / Admin ────────────────────────────────────────────────────────────

// CannoliBot gets global voice so it can join any room and use /cannoli-battle
// Add to config/usergroups.csv: cannolibot,+

// ─── Misc ───────────────────────────────────────────────────────────────────

exports.reportjoins = false;
exports.pokemonshowdowncom = false; // We're not smogon
exports.crashguard = true;
exports.watchdog = true;
