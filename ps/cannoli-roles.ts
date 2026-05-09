/**
 * Cannoli role + autojoin plugin.
 *
 * Drop into server/chat-plugins/. Pairs with the Cannoli backend's enriched
 * SSO assertion (s1 = role, s2 = comma-separated league slugs the user is
 * a coach in, s3 reserved). PS already populates user.s1/s2/s3 after a
 * successful login (see users.ts:706); this plugin reads them in the
 * Chat.loginfilter hook and:
 *
 *   1. Globally promotes admins to `~` and coaches to `+` (idempotent —
 *      never auto-demotes, so you can hand-promote staff above this level
 *      and keep them).
 *   2. Sets room-level `%` (driver) for coaches in their own league rooms,
 *      so league chat moderation belongs to the team owners by default.
 *   3. Auto-joins each coach into their league's chat room(s) on login
 *      via |/join — PS doesn't natively gate room.autojoin per user, so
 *      we issue a per-connection join command instead.
 *
 * No new chat commands here — Tier 4 commands (/roster, /matchup, etc.)
 * land in a separate plugin later.
 */

const ROLE_ADMIN_SYMBOL: GroupSymbol = '~' as GroupSymbol;
const ROLE_COACH_GLOBAL_SYMBOL: GroupSymbol = '+' as GroupSymbol;
const ROLE_COACH_ROOM_SYMBOL: GroupSymbol = '%' as GroupSymbol;

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

function parseLeagueSlugs(s2: string | undefined): string[] {
	if (!s2) return [];
	return s2.split(',').map(s => s.trim()).filter(Boolean);
}

export const loginfilter: Chat.LoginFilter = user => {
	if (!user || !user.named) return;

	const role = (user.s1 || '').trim();
	const leagueSlugs = parseLeagueSlugs(user.s2);

	// 1. Global rank from role.
	if (role === 'admin') {
		promoteGlobal(user, ROLE_ADMIN_SYMBOL);
	} else if (role === 'coach' || leagueSlugs.length > 0) {
		// Treat any user with a coach membership as a coach even if s1
		// happened to come back as 'user' (admin always wins above).
		promoteGlobal(user, ROLE_COACH_GLOBAL_SYMBOL);
	}

	// 2. + 3. Per-league room auth + autojoin.
	for (const slug of leagueSlugs) {
		const roomid = toID(slug) as RoomID;
		promoteRoom(user, roomid, ROLE_COACH_ROOM_SYMBOL);
		autoJoinRoom(user, roomid);
	}
};
