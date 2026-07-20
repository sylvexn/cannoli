/**
 * Cannoli chat plugin for Pokemon Showdown.
 *
 * Drop this file into server/chat-plugins/ on the PS game server.
 * It adds the /cannoli-battle and /cannoli-cancel commands used by CannoliBot
 * to set up matches programmatically when both players ready up in the Arena.
 *
 * Only the CannoliBot account (configurable) can use these commands.
 *
 * HOW /cannoli-battle WORKS (native invite flow):
 *   When both players ready up in the Arena, the bot sends /cannoli-battle.
 *   We create an EMPTY 2-slot battle room with `delayedStart` (so it does NOT
 *   auto-start with random teams) and then INVITE each player into their slot
 *   using Showdown's native BattleInvite mechanism — the exact same path used
 *   by /addplayer + /acceptbattle. Each invited player receives a native
 *   challenge popup that includes a team-builder dropdown; they pick a saved
 *   team and accept (/acceptbattle), at which point PS's prepBattle validates
 *   the chosen team before joinGame. The battle starts only once BOTH players
 *   have joined with a validated team. This replaces the old, broken behaviour
 *   that force-started using user.battleSettings.team (only ever populated by
 *   the client's own search/challenge UI, which Arena players never touch — so
 *   it was empty/stale and the sim treated it as "random team").
 */

const BOT_USERID = toID('cannolibot');

/**
 * Cannoli stores Megas/Primals with a "Mega <species>"/"Primal <species>"
 * PREFIX (see backend/src/lib/pokedex.ts `toCannoliSpeciesName`), but
 * Showdown's own Dex keys them with a "<species>-Mega[-X|Y]"/"<species>-Primal"
 * SUFFIX, and only has hand-curated prefix aliases for a handful of popular
 * megas (data/aliases.ts) — most (e.g. "Mega Altaria") won't resolve as typed.
 * Reorder to Showdown's native suffix form before handing off to
 * Dex.species.get so every Mega/Primal, not just the aliased ones, resolves
 * to the right icon. No-op for every other name (regionals, cosmetics, etc.
 * already match between the two conventions).
 */
function toPsSpeciesQuery(name: string): string {
	const xy = /^Mega\s+(.+)\s+([XY])$/i.exec(name);
	if (xy) return `${xy[1]}-Mega-${xy[2].toUpperCase()}`;
	const mega = /^Mega\s+(.+)$/i.exec(name);
	if (mega) return `${mega[1]}-Mega`;
	const primal = /^Primal\s+(.+)$/i.exec(name);
	if (primal) return `${primal[1]}-Primal`;
	return name;
}

/**
 * Send a synthetic PM line directly to the bot's connection.
 * Format: |pm|SENDER|RECEIVER|MESSAGE — what the bot would normally see when
 * a real user PM'd it. We use this as an in-band signal channel so the bot
 * deterministically learns about new battles without polling.
 */
function pmBot(message: string) {
	const bot = Users.get(BOT_USERID);
	if (!bot || !bot.connected) return false;
	// `~Cannoli` is a system identity (group=`~` admin, name=`Cannoli`) so the
	// bot can recognise the source as authoritative and not a spoofed user.
	bot.send(`|pm|~Cannoli|${bot.getIdentity()}|${message}`);
	return true;
}

export const commands: Chat.ChatCommands = {
	/**
	 * /cannoli-battle player1, player2[, format[, matchId]]
	 *
	 * Creates an empty (delayed-start) battle room and INVITES both players into
	 * it via the native BattleInvite flow. Each player gets a challenge popup
	 * with a team picker, chooses a saved team, and accepts — PS validates the
	 * team before they join. The battle starts once both have joined.
	 * Used by CannoliBot when both players ready up in the Arena lobby.
	 *
	 * On success, sends a PM back to the bot with the new battle's room id so
	 * the bot can join and observe the battle for result recording.
	 *
	 * PM format (5-field, old, backward-compatible):
	 *   cannoli-battle-created|<roomid>|<p1userid>|<p2userid>|<format>
	 * PM format (6-field, new, with matchId for deterministic linking):
	 *   cannoli-battle-created|<roomid>|<p1userid>|<p2userid>|<format>|<matchId>
	 *
	 * On failure, sends:
	 *   cannoli-battle-failed|<reason>
	 */
	'cannoli-battle'(target, room, user) {
		if (user.id !== BOT_USERID) {
			return this.errorReply('Access denied. Only CannoliBot can use this command.');
		}

		const parts = target.split(',').map(s => s.trim());
		if (parts.length < 2) {
			return this.errorReply('Usage: /cannoli-battle player1, player2[, format[, matchId]]');
		}

		const [p1Name, p2Name, formatId, matchId] = parts;
		const format = formatId || 'gen9natdexdraft';

		const user1 = Users.get(p1Name);
		const user2 = Users.get(p2Name);

		if (!user1) {
			pmBot(`cannoli-battle-failed|Player not found or offline: ${p1Name}|${toID(p1Name)}|${toID(p2Name)}`);
			return this.errorReply(`Player not found or offline: ${p1Name}`);
		}
		if (!user2) {
			pmBot(`cannoli-battle-failed|Player not found or offline: ${p2Name}|${toID(p1Name)}|${toID(p2Name)}`);
			return this.errorReply(`Player not found or offline: ${p2Name}`);
		}
		if (!user1.named) {
			pmBot(`cannoli-battle-failed|${p1Name} is not logged in|${toID(p1Name)}|${toID(p2Name)}`);
			return this.errorReply(`${p1Name} is not logged in.`);
		}
		if (!user2.named) {
			pmBot(`cannoli-battle-failed|${p2Name} is not logged in|${toID(p1Name)}|${toID(p2Name)}`);
			return this.errorReply(`${p2Name} is not logged in.`);
		}

		// Validate format exists
		const validFormat = Dex.formats.get(format);
		if (!validFormat || !validFormat.exists) {
			return this.errorReply(`Unknown format: ${format}`);
		}

		// Slot order is load-bearing: p1 = player1, p2 = player2 — preserved so it
		// matches the PM order the backend relies on.
		const invitees: [User, 'p1' | 'p2'][] = [[user1, 'p1'], [user2, 'p2']];

		let battleRoom: Room | null = null;
		try {
			// Create an EMPTY 2-slot battle that does NOT auto-start. With
			// `players: []` the RoomBattle constructor fills both slots via
			// addPlayer(null, null), and `delayedStart` makes start() skip
			// onCreateBattleRoom — so no random-team battle kicks off. The battle
			// will start later, inside joinGame, once both invited slots are filled.
			battleRoom = Rooms.createBattle({
				format,
				players: [],
				rated: 0,
				delayedStart: true,
			});

			if (!battleRoom || !battleRoom.battle) {
				throw new Error('Failed to create battle (server may be in lockdown).');
			}
			const battle = battleRoom.battle;

			for (const [targetUser, slot] of invitees) {
				const player = battle.players.find(p => p.slot === slot);
				if (!player) {
					throw new Error(`Battle has no slot ${slot}.`);
				}
				if (player.id || player.invite) {
					throw new Error(`Slot ${slot} is already taken.`);
				}

				// Clear any pre-existing challenge between the bot and this player,
				// otherwise challenges.add() throws "There is already a challenge".
				const existing = Ladders.challenges.search(targetUser.id, BOT_USERID);
				if (existing) Ladders.challenges.remove(existing);

				// Native invite: mark the slot as invited and register a BattleInvite.
				// Passing a real BattleReady (not a plain format string) means the
				// challenge's getUpdate() emits a non-empty teambuilderFormat, which
				// is what makes the client render the team-picker dropdown.
				player.invite = targetUser.id;
				Ladders.challenges.add(
					new Ladders.BattleInvite(
						BOT_USERID,
						targetUser.id,
						new Ladders.BattleReady(targetUser.id, battle.format, targetUser.battleSettings),
						{
							acceptCommand: `/acceptbattle ${BOT_USERID}`,
							message: 'Your Cannoli match is ready — pick your team to start!',
							roomid: battleRoom.roomid,
							acceptButton: 'Pick team & battle',
							rejectButton: 'Decline',
						}
					)
				);
			}

			// Keep the room's invite UI consistent, exactly as native /addplayer does.
			battle.sendInviteForm(true);
		} catch (err) {
			// Roll back any partial room so we don't leak an empty battle.
			if (battleRoom) {
				try {
					battleRoom.destroy();
				} catch {}
			}
			const reason = err instanceof Error ? err.message : String(err);
			pmBot(`cannoli-battle-failed|${reason}|${toID(p1Name)}|${toID(p2Name)}`);
			return this.errorReply(`Failed to create battle: ${reason}`);
		}

		// PM the bot the new room id so it can join and observe.
		// 5-field (old, backward-compatible): cannoli-battle-created|<roomid>|<p1userid>|<p2userid>|<format>
		// 6-field (new, with matchId):        cannoli-battle-created|<roomid>|<p1userid>|<p2userid>|<format>|<matchId>
		// roomid already includes the `battle-` prefix.
		const matchSuffix = (matchId && matchId.trim()) ? `|${matchId.trim()}` : '';
		pmBot(`cannoli-battle-created|${battleRoom.roomid}|${user1.id}|${user2.id}|${format}${matchSuffix}`);

		this.sendReply(`Battle created: ${user1.name} vs ${user2.name} [${format}] (${battleRoom.roomid})`);
	},

	/**
	 * /cannoli-cancel roomId
	 *
	 * Aborts a PENDING invite battle that never started — used by the backend
	 * when ready-up times out or a player un-readies before both have joined.
	 * Uninvites both players (mirroring native /uninvitebattle) and expires the
	 * battle room, but only if the battle has NOT started yet. If the battle is
	 * already underway, this is a no-op (we don't kill a live game).
	 *
	 * Optionally PMs the bot: cannoli-battle-cancelled|<roomId>
	 */
	'cannoli-cancel'(target, room, user) {
		if (user.id !== BOT_USERID) {
			return this.errorReply('Access denied. Only CannoliBot can use this command.');
		}

		const roomId = target.trim();
		if (!roomId) {
			return this.errorReply('Usage: /cannoli-cancel roomId');
		}

		const battleRoom = Rooms.get(roomId);
		// Be defensive: room may already be gone.
		if (!battleRoom || !battleRoom.battle) {
			pmBot(`cannoli-battle-cancelled|${roomId}`);
			return this.sendReply(`No pending battle ${roomId} (already gone).`);
		}

		const battle = battleRoom.battle;

		// If the battle already started, leave it alone.
		if (battle.started) {
			return this.sendReply(`Battle ${roomId} already started; not cancelling.`);
		}

		// Uninvite every still-pending invitee for this room. Mirrors native
		// /uninvitebattle: remove the BattleInvite challenges whose roomid matches;
		// BattleInvite.destroy() clears player.invite for the slot.
		for (const player of battle.players) {
			const inviteeId = player.invite;
			if (!inviteeId) continue;
			const challList = Ladders.challenges.get(inviteeId);
			if (!challList) continue;
			// Copy first — remove() mutates the underlying array.
			for (const challenge of [...challList]) {
				if (challenge.to === inviteeId && challenge.roomid === battleRoom.roomid) {
					Ladders.challenges.remove(challenge);
				}
			}
		}

		// Tear down the empty/pending room.
		battleRoom.expire();

		pmBot(`cannoli-battle-cancelled|${roomId}`);
		this.sendReply(`Cancelled pending battle ${roomId}.`);
	},

	/**
	 * /cannoli-status
	 *
	 * Returns bot connection status. Used for health checking.
	 */
	'cannoli-status'(target, room, user) {
		if (user.id !== BOT_USERID) {
			return this.errorReply('Access denied.');
		}
		this.sendReply('CannoliBot is connected and operational.');
	},

	/**
	 * (room) /cannoli-tera-preview p1CaptainsJson|p2CaptainsJson
	 *
	 * Posts a Cannoli-authored "X's Tera Captains:" preview line into a battle
	 * room, sourced from the league's roster tera-captain assignments
	 * (rosters.teraType1/2/3) instead of the players' own Showdown team.
	 *
	 * WHY: Cannoli battles are created via the native invite flow — each
	 * player brings their OWN saved Showdown team, which essentially never has
	 * a `teraType` set on any set. Showdown's built-in "Tera Type Preview" rule
	 * (data/rulesets.ts) reads `pokemon.teraType` straight off that team, so it
	 * renders as empty separators: "caleb's Tera Types: /////" (feedback #49).
	 * We can't fix that at the source — Cannoli never sees/controls the team a
	 * player picks — so instead we post our OWN corrected line using data we
	 * actually own. Sent by CannoliBot (which has direct DB access to
	 * `rosters`) once both players have joined the battle.
	 *
	 * Must be sent WITH a room prefix (`roomid|/cannoli-tera-preview ...`) —
	 * the bot joins the room right after the battle is created, well before
	 * either player finishes picking a team, so it's always present by the
	 * time this fires.
	 *
	 * Payload: two JSON arrays of `{ pokemon: string; types: string[] }`
	 * (p1's tera captains, then p2's), pipe-separated. `types` is up to 3
	 * entries — a league Tera Captain has that many ALLOWED types, freely
	 * switchable, so every allowed type is shown as its own icon (there's no
	 * single "the" tera type the way a vanilla Showdown team has one). A side
	 * with zero tera captains (or none with any type set) is skipped — no
	 * blank line, mirroring the guard already applied to the unrelated
	 * upstream "Draft Factory" format's own Tera Captains line.
	 *
	 * Silently no-ops (not an errorReply) on a bad/incomplete payload — this
	 * is a purely cosmetic supplement to the battle, not something that should
	 * ever be able to disrupt it.
	 */
	'cannoli-tera-preview'(target, room, user) {
		if (user.id !== BOT_USERID) {
			return this.errorReply('Access denied. Only CannoliBot can use this command.');
		}
		if (!room || !room.battle) return; // must be sent room-scoped to a battle

		const pipeIdx = target.indexOf('|');
		if (pipeIdx < 0) return;
		const p1Raw = target.slice(0, pipeIdx).trim();
		const p2Raw = target.slice(pipeIdx + 1).trim();

		type CaptainPayload = { pokemon: string; types: string[] };
		function parseCaptains(raw: string): CaptainPayload[] {
			if (!raw) return [];
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return [];
			}
			if (!Array.isArray(parsed)) return [];
			return parsed.filter((c): c is CaptainPayload =>
				!!c && typeof c === 'object' && typeof c.pokemon === 'string' && Array.isArray(c.types));
		}

		const p1Captains = parseCaptains(p1Raw);
		const p2Captains = parseCaptains(p2Raw);
		if (!p1Captains.length && !p2Captains.length) return;

		const battle = room.battle;
		const sides: [string, CaptainPayload[]][] = [
			[battle.p1?.name || 'Player 1', p1Captains],
			[battle.p2?.name || 'Player 2', p2Captains],
		];

		for (const [sideName, captains] of sides) {
			let buf = '';
			for (const captain of captains) {
				const species = Dex.species.get(toPsSpeciesQuery(captain.pokemon));
				if (!species.exists) continue;
				const typeIcons = captain.types
					.map(t => Dex.types.get(t))
					.filter(t => t.exists)
					.map(t => `<psicon type="${t.name}" />`)
					.join('');
				if (!typeIcons) continue;
				buf += buf ? ' / ' : `raw|${sideName}'s Tera Captains:<br />`;
				buf += `<psicon pokemon="${species.id}" />${typeIcons}`;
			}
			if (buf) room.add(`|${buf}`).update();
		}
	},
};
