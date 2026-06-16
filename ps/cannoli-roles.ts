/**
 * Cannoli role + autojoin plugin.
 *
 * Drop into server/chat-plugins/. Pairs with the Cannoli backend's enriched
 * SSO assertion (s1 = role, s2 = comma-separated league slugs the user is
 * a coach in, s3 reserved). PS already populates user.s1/s2/s3 after a
 * successful login (see users.ts:706); this plugin reads them in the
 * Chat.loginfilter hook and:
 *
 *   1. Globally promotes admins to `~` only — coaches get no global rank (idempotent —
 *      never auto-demotes, so you can hand-promote staff above this level
 *      and keep them).
 *   2. Sets room-level `+` (voice) for coaches in their own league rooms.
 *      With each league room's `modchat: '+'`, that league's coaches can chat
 *      while everyone else reads. Voice (not driver) grants no mod powers and
 *      keeps them non-trusted so they can't /makegroupchat.
 *   3. Auto-joins each coach into their league's chat room(s) on login
 *      via |/join — PS doesn't natively gate room.autojoin per user, so
 *      we issue a per-connection join command instead. Admins are auto-joined
 *      into every league room so they can watch all channels.
 *
 * Also blocks groupchat creation below `~` (see `commands` below). Tier 4
 * commands (/roster, /matchup, etc.) land in a separate plugin later.
 */

const ROLE_ADMIN_SYMBOL: GroupSymbol = '~' as GroupSymbol;
// Coaches get room-level VOICE (not driver) in their own league room. Voice lets
// them chat under the room's `modchat: '+'` but grants no mod powers and — unlike
// driver or global voice — does NOT make them PS-"trusted", so they still can't
// /makegroupchat. Coaches intentionally get NO global rank.
const ROLE_COACH_ROOM_SYMBOL: GroupSymbol = '+' as GroupSymbol;

/**
 * Auth.atLeast(currentSymbol, minSymbol) returns true if `current` is at
 * least as high as `min` in the global hierarchy. We use it to gate the
 * promotion (never demote) — if the user is already at or above the target
 * rank, leave them alone.
 */
function shouldPromote(currentSymbol: GroupSymbol | undefined, targetSymbol: GroupSymbol): boolean {
	if (!currentSymbol) return true;
	// Auth.atLeast is a static helper; both Users.Auth and Auth (global) expose it.
	return !Users.Auth.atLeast(currentSymbol, targetSymbol);
}

function promoteGlobal(user: User, target: GroupSymbol) {
	const current = Users.globalAuth.get(user.id);
	if (!shouldPromote(current, target)) return;
	// `set` updates user.tempGroup, persists via save(), and re-broadcasts identity.
	Users.globalAuth.set(user.id, target, user.name);
}

function promoteRoom(user: User, roomid: RoomID, target: GroupSymbol) {
	const room = Rooms.get(roomid);
	if (!room) return;
	const current = room.auth.get(user.id);
	if (!shouldPromote(current, target)) return;
	room.auth.set(user.id, target);
	if (room.persist) room.saveSettings();
}

function autoJoinRoom(user: User, roomid: RoomID) {
	const room = Rooms.get(roomid);
	if (!room) return;
	// Send a /join command on each of the user's connections so the join
	// shows up in their room tabs immediately. Skip connections already in
	// the room to avoid duplicate join announcements.
	for (const connection of user.connections) {
		if (connection.inRooms.has(roomid)) continue;
		connection.send(`|/join ${roomid}`);
	}
}

/**
 * Auto-join an admin into every persistent league chat room. We don't have the
 * league slug list here (s2 only carries the user's own leagues), so derive it
 * from the live room set: official-section chat rooms that the startup hook
 * materialised, excluding the global Lobby/Staff and any battle/groupchat rooms.
 */
function autoJoinAllLeagueRooms(user: User) {
	for (const room of Rooms.rooms.values()) {
		if (room.type !== 'chat') continue;
		if (!room.persist) continue;
		if (room.roomid === 'lobby' || room.roomid === 'staff') continue;
		autoJoinRoom(user, room.roomid);
	}
}

function parseLeagueSlugs(s2: string | undefined): string[] {
	if (!s2) return [];
	return s2.split(',').map(s => s.trim()).filter(Boolean);
}

export const loginfilter: Chat.LoginFilter = user => {
	if (!user || !user.named) return;

	const role = (user.s1 || '').trim();
	const leagueSlugs = parseLeagueSlugs(user.s2);

	// 1. Global rank from role. Only admins get a global rank (`~`); coaches are
	// granted voice per-league below so they can't talk outside their own room.
	if (role === 'admin') {
		promoteGlobal(user, ROLE_ADMIN_SYMBOL);
		// Admins watch every channel: auto-join all persistent league rooms.
		autoJoinAllLeagueRooms(user);
		return;
	}

	// 2. + 3. Per-league room voice + autojoin for coaches.
	for (const slug of leagueSlugs) {
		const roomid = toID(slug) as RoomID;
		promoteRoom(user, roomid, ROLE_COACH_ROOM_SYMBOL);
		autoJoinRoom(user, roomid);
	}
};

/**
 * Block groupchat creation for everyone below `~`. Change #1 already makes
 * coaches/users non-trusted (so PS's own `/makegroupchat` trusted-gate rejects
 * them), but we override the commands explicitly so the lockdown can't silently
 * regress if the trusted definition or a coach's rank ever changes. Plugin
 * commands override core ones (Chat.loadPlugin Object.assigns them after the
 * base set). Admins (`~`, who hold `makeroom`) keep the real behaviour, so we
 * delegate to the original handler for them rather than re-implementing it.
 */
const blockRoomCreation: Chat.ChatHandler = function (target, room, user, connection, cmd, message) {
	if (!user.can('makeroom')) {
		throw new Chat.ErrorMessage('Room creation is disabled on this server. Ask an admin to set up a channel.');
	}
	const base = Chat.baseCommands['makegroupchat'];
	if (typeof base !== 'function') {
		throw new Chat.ErrorMessage('Room creation handler is unavailable.');
	}
	return base.call(this, target, room, user, connection, cmd, message);
};

export const commands: Chat.ChatCommands = {
	makegroupchat: blockRoomCreation,
	subroomgroupchat: blockRoomCreation,
	srgc: blockRoomCreation,
	mgc: blockRoomCreation,
};
