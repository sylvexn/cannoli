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
};
