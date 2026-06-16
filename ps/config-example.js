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

// Disable the debug REPL. Upstream config-example.js defaults `repl = true`,
// and PS's config loader merges those defaults under our config, so it'd be on
// unless we explicitly turn it off here. The REPL opens a Unix socket at
// logs/repl/app (logs/ is a persistent volume, so the socket survives restarts);
// when a client connects and then drops, PS writes the REPL prompt to the dead
// socket and the synchronous `write EPIPE` crashes the whole process. We never
// use the REPL in production — turn it off.
exports.repl = false;

// ─── Cannoli league rooms (startup hook) ────────────────────────────────────
//
// On boot, fetch active leagues from the Cannoli backend and ensure a chat
// room exists for each one. The backend returns slug/name/displayName/phase/
// currentWeek; we materialise rooms named after the slug so the
// `cannoli-roles` plugin can autojoin coaches by slug. Idempotent — existing
// rooms have their title + intro updated in place rather than recreated.
//
// Required env (set in Coolify on the cannoli-ps-server app):
//   CANNOLI_BACKEND_URL  - e.g. http://cannoli-backend-mock:3001 (internal alias)
//                          or http://host.docker.internal:3001 in dev compose
//   PS_INTERNAL_SECRET   - shared with the Cannoli backend; gates /api/internal/ps/*
//
// If either is missing OR the backend is unreachable, log loudly and continue
// booting — PS still works, the league rooms just won't materialise until a
// later restart catches them. We never crash on startup.
exports.startuphook = function () {
	const backendUrl = process.env.CANNOLI_BACKEND_URL;
	const secret = process.env.PS_INTERNAL_SECRET;
	if (!backendUrl || !secret) {
		console.warn('[cannoli] CANNOLI_BACKEND_URL or PS_INTERNAL_SECRET unset — skipping league room materialisation');
		return;
	}

	const url = backendUrl.replace(/\/+$/, '') + '/api/internal/ps/leagues';
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10000);

	fetch(url, { headers: { 'X-PS-Secret': secret }, signal: controller.signal })
		.then(res => {
			clearTimeout(timer);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		})
		.then(data => {
			const leagues = (data && data.leagues) || [];
			let created = 0, updated = 0;
			for (const l of leagues) {
				if (!l || !l.slug) continue;
				const roomid = l.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
				if (!roomid) continue;
				const title = l.displayName || l.name || l.slug;
				const intro = `<div class="infobox"><b>${title}</b><br />` +
					`Phase: <b>${l.phase || 'unknown'}</b>` +
					(l.currentWeek ? ` &middot; Week <b>${l.currentWeek}</b>` : '') +
					`<br />Coach chat for the ${title} league. Coaches are auto-joined here on login.</div>`;

				const existing = Rooms.get(roomid);
				if (existing) {
					existing.settings.title = title;
					existing.title = title;
					existing.settings.introMessage = intro;
					existing.introMessage = intro;
					if (existing.persist) existing.saveSettings();
					updated++;
					continue;
				}

				// Create the room with id == slug (so /join sapphire works) and
				// register it in the global room list so chatrooms.json is
				// written + the room survives restarts. addChatRoom() would
				// re-derive id from title (e.g. 'sapphires10') — bypass it.
				const reserved = ['battles', 'rooms', 'ladder', 'teambuilder', 'home', 'all', 'public'];
				if (reserved.includes(roomid)) {
					console.warn(`[cannoli] league slug "${roomid}" is a reserved PS room id — skipping`);
					continue;
				}
				const settings = {
					title,
					auth: {},
					creationTime: Date.now(),
					introMessage: intro,
					section: 'official',
				};
				const room = Rooms.createChatRoom(roomid, title, settings);
				Rooms.global.settingsList.push(settings);
				Rooms.global.chatRooms.push(room);
				Rooms.global.writeChatRoomData();
				created++;
			}
			console.log(`[cannoli] league rooms: ${created} created, ${updated} updated (${leagues.length} total)`);
		})
		.catch(err => {
			clearTimeout(timer);
			console.error(`[cannoli] startup hook failed (${err && err.message ? err.message : err}) — continuing without league rooms`);
		});
};
