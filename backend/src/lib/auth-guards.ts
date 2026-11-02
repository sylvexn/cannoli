/**
 * Structural auth guards for route groups.
 *
 * Previously every admin handler hand-copied `if (!isStaff(user)) { 403 }`.
 * One omitted line silently exposed an unauthenticated mutation endpoint with
 * no safety net. `requireStaff` lets a whole Elysia sub-router enforce the
 * staff check once via `.guard({ beforeHandle: requireStaff })`, so the
 * authorization is part of the route-group structure rather than per-handler
 * discipline.
 *
 * Distinguishes 401 (no session) from 403 (authenticated but not staff) so
 * clients can tell "log in" from "you can't do this".
 */
import { isStaff, isDev } from './auth';

/**
 * beforeHandle guard: reject non-staff. The `user` is injected on context by
 * the root app's `.derive`. Returning a body short-circuits the handler.
 */
export function requireStaff({ user, set }: { user: { role: string } | null | undefined; set: { status?: number | string } }) {
  if (!user) {
    set.status = 401;
    return { error: 'Not authenticated' };
  }
  if (!isStaff(user)) {
    set.status = 403;
    return { error: 'Forbidden' };
  }
}

/**
 * beforeHandle guard: reject anyone who isn't the `dev` role — stricter than
 * requireStaff. Used for dev-only tooling that admins shouldn't reach (raw API
 * logs, feedback triage). Applied per-route via the route's hook config.
 */
export function requireDev({ user, set }: { user: { role: string } | null | undefined; set: { status?: number | string } }) {
  if (!user) {
    set.status = 401;
    return { error: 'Not authenticated' };
  }
  if (!isDev(user)) {
    set.status = 403;
    return { error: 'Forbidden' };
  }
}

const ROLE_RANK: Record<string, number> = { user: 0, admin: 1, bot: 2, dev: 3 };

/** Dev may act on anyone; everyone else only on strictly lower-ranked roles. */
export function canActOnRole(caller: { role: string }, targetRole: string): boolean {
  if (caller.role === 'dev') return true;
  return (ROLE_RANK[caller.role] ?? 0) > (ROLE_RANK[targetRole] ?? 0);
}
