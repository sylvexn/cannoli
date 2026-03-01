/**
 * Cannoli chat plugin for Pokemon Showdown.
 *
 * Drop this file into server/chat-plugins/ on the PS game server.
 * It adds the /cannoli-battle command used by CannoliBot to create
 * matches programmatically when both players ready up in the Arena.
 *
 * Only the CannoliBot account (configurable) can use this command.
 */

const BOT_USERID = 'cannolibot';

export const commands: Chat.Commands = {
	/**
	 * /cannoli-battle player1, player2, format
	 *
	 * Creates a battle room and places both players in it.
	 * Used by CannoliBot when both players ready up in the Arena lobby.
	 * Players must have a team saved for the format in their teambuilder.
	 */
	'cannoli-battle'(target, room, user) {
		if (user.id !== BOT_USERID) {
			return this.errorReply('Access denied. Only CannoliBot can use this command.');
		}

		const parts = target.split(',').map(s => s.trim());
		if (parts.length < 2) {
			return this.errorReply('Usage: /cannoli-battle player1, player2[, format]');
		}

		const [p1Name, p2Name, formatId] = parts;
		const format = formatId || 'gen9natdexdraft';

		const user1 = Users.get(p1Name);
		const user2 = Users.get(p2Name);

		if (!user1) {
			return this.errorReply(`Player not found or offline: ${p1Name}`);
		}
		if (!user2) {
			return this.errorReply(`Player not found or offline: ${p2Name}`);
		}
		if (!user1.named) {
			return this.errorReply(`${p1Name} is not logged in.`);
		}
		if (!user2.named) {
			return this.errorReply(`${p2Name} is not logged in.`);
		}

		// Validate format exists
		const validFormat = Dex.formats.get(format);
		if (!validFormat || !validFormat.exists) {
			return this.errorReply(`Unknown format: ${format}`);
		}

		// Create the battle — both players are placed in it automatically.
		// They must have a team saved for this format in their teambuilder.
		// If they don't, PS will show them the team selection screen.
		Rooms.createBattle({
			format,
			p1: {
				user: user1,
				team: user1.battleSettings.team || '',
				hidden: false,
				inviteOnly: false,
			},
			p2: {
				user: user2,
				team: user2.battleSettings.team || '',
				hidden: false,
				inviteOnly: false,
			},
			rated: 0,
		});

		this.sendReply(`Battle created: ${user1.name} vs ${user2.name} [${format}]`);
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
