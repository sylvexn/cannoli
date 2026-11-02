/** Shared login brute-force limiter, used by /api/auth/login, PS login and change-password. */
// Login rate limiter
// In-memory, per-IP. Max 5 failed attempts per 15-minute window; once
// exceeded, the IP is locked out for 15 minutes. Successful login resets
// the counter for that IP. No external deps.

const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_MAX_FAILS = 5;
const RL_LOCKOUT_MS = 15 * 60 * 1000;

interface RateLimitEntry {
  fails: number;
  firstFailAt: number;
  lockedUntil: number;
  usernames: Set<string>; // usernames attempted from this IP during the window
}

const loginAttempts = new Map<string, RateLimitEntry>();

export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
}

/** Returns seconds remaining if locked out, else 0. Side-effect: prunes expired entries. */
export function checkLockout(ip: string): number {
  const entry = loginAttempts.get(ip);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.lockedUntil > now) {
    return Math.ceil((entry.lockedUntil - now) / 1000);
  }
  // Window expired with no lockout — clear it.
  if (entry.lockedUntil <= now && now - entry.firstFailAt > RL_WINDOW_MS) {
    loginAttempts.delete(ip);
  }
  return 0;
}

export function recordFailure(ip: string, username: string) {
  const key = username.toLowerCase().trim();
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstFailAt > RL_WINDOW_MS) {
    loginAttempts.set(ip, { fails: 1, firstFailAt: now, lockedUntil: 0, usernames: new Set([key]) });
    return;
  }
  entry.fails += 1;
  entry.usernames.add(key);
  if (entry.fails >= RL_MAX_FAILS) {
    entry.lockedUntil = now + RL_LOCKOUT_MS;
  }
}

export function clearAttempts(ip: string) {
  loginAttempts.delete(ip);
}

/**
 * Clear any rate-limit lockout tied to a username. The limiter is keyed by IP,
 * so we drop every tracked IP that attempted this username during its window.
 * Called when an admin resets a user's password so a locked-out user who forgot
 * their password can log in immediately with the new temp password.
 */
export function clearRateLimitForUser(username: string) {
  const key = username.toLowerCase().trim();
  for (const [ip, entry] of loginAttempts) {
    if (entry.usernames.has(key)) loginAttempts.delete(ip);
  }
}

