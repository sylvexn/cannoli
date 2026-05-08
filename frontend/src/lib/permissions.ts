/**
 * Frontend permission helpers — mirror the backend's role/ownership model.
 *
 * Source of truth: `backend/src/lib/auth.ts` (`isStaff`, `isStaffOrTeamOwner`).
 * Staff (`role === 'dev' || 'admin'`) bypass team-ownership gates everywhere
 * — they're global managers in every league, every team. UI surfaces should
 * reflect that so staff don't see actions hidden as "not yours" when the API
 * would gladly accept the call.
 *
 * These helpers are pure and synchronous; pass them the user from
 * `useAuth()` and the team-shape with a `userId` (number or null).
 *
 *   const { user } = useAuth();
 *   if (canManageTeam(user, player)) { ... show edit button ... }
 *
 * Ownership comparison normalizes both sides to strings to dodge the
 * historical user.id-as-string vs team.userId-as-number mismatch.
 */
import type { User } from './types';

/** Anything with a role is enough — accepts the auth User shape, narrowed. */
type RoledUser = Pick<User, 'role'> | { role: string };

/** Anything with a userId is enough — Player, Team, Coach tenure rows… */
type OwnedTeam = { userId?: number | string | null };

/** True for users with the dev or admin role (staff override). */
export function isStaff(user: RoledUser | null | undefined): boolean {
  return !!user && (user.role === 'dev' || user.role === 'admin');
}

/**
 * True if the user owns this team (manager-of-record). Pass through
 * `canManageTeam` instead unless you specifically need to distinguish
 * an owner from staff (e.g. UI text like "you own this team").
 */
export function isTeamOwner(
  user: { id: string } | null | undefined,
  team: OwnedTeam | null | undefined,
): boolean {
  if (!user || !team) return false;
  if (team.userId == null) return false;
  return String(team.userId) === user.id;
}

/**
 * True if the user can take manager-level actions on this team:
 * editing the roster, listing on the trade block, accepting/withdrawing
 * trades, picking up free agents, editing availability, setting tera
 * captains, etc. Owner OR staff.
 */
export function canManageTeam(
  user: (RoledUser & { id: string }) | null | undefined,
  team: OwnedTeam | null | undefined,
): boolean {
  if (!user) return false;
  if (isStaff(user)) return true;
  return isTeamOwner(user, team);
}

/**
 * True if the user can take league-level admin actions (advance phase,
 * approve trades, edit settings…). Currently equivalent to `isStaff` —
 * there is no distinct "league commissioner" role on the frontend yet.
 * Kept as its own helper so future per-league authority can land in one
 * place without touching every call site.
 */
export function canManageLeague(
  user: RoledUser | null | undefined,
): boolean {
  return isStaff(user);
}
