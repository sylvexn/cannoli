import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { User } from './types';
import { isStaff } from './permissions';
import { api } from './api';
import { getErrorMessage } from '@/lib/errors';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  /**
   * The user's explicit IANA timezone preference, or null if they haven't
   * set one (consumers should fall back to the browser zone). Updated when
   * the user saves their preferences elsewhere — call `refreshTimezone()`.
   */
  userTimezone: string | null;
  /**
   * Whether the user opted into the deuteranopia-safe palette. When true the
   * AuthProvider stamps <html data-colorblind="true"> so CSS overrides retarget
   * red/green tokens to orange/blue.
   */
  colorblindMode: boolean;
  /**
   * Whether the user opted into spoiler-free mode. Defaults ON: when true,
   * consumers (the standings and replays pages) render match results behind a
   * click-to-reveal <Spoiler> veil. Logic is React-side — no <html> stamp.
   */
  spoilerFreeMode: boolean;
  /**
   * Per-league spoiler reveal high-water marks: { [leagueId]: highestRevealedWeek }.
   * A result for week W is revealed once W <= spoilerRevealedThrough[leagueId]
   * (revealing week N reveals weeks 1..N — the catch-up model).
   */
  spoilerRevealedThrough: Record<string, number>;
  /** Reveal a league's results through `week` (and all earlier weeks). Persists
   *  server-side and updates local state optimistically. */
  revealWeek: (leagueId: string, week: number) => void;
  refreshTimezone: () => Promise<void>;
  /** Re-fetch preferences after a settings save. Updates timezone + colorblind + spoiler. */
  refreshPreferences: () => Promise<void>;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  changePassword: (current: string, next: string) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userTimezone, setUserTimezone] = useState<string | null>(null);
  const [colorblindMode, setColorblindMode] = useState(false);
  // Spoiler-free defaults ON — start veiled during the auth/prefs load so we
  // never flash results before we know the viewer's preference.
  const [spoilerFreeMode, setSpoilerFreeMode] = useState(true);
  const [spoilerRevealedThrough, setSpoilerRevealedThrough] = useState<Record<string, number>>({});

  const loadPreferences = useCallback(async () => {
    try {
      const prefs = await api.getMyPreferences();
      setUserTimezone(prefs.timezone ?? null);
      setColorblindMode(!!prefs.colorblindMode);
      setSpoilerFreeMode(!!prefs.spoilerFreeMode);
      setSpoilerRevealedThrough(prefs.spoilerRevealedThrough ?? {});
    } catch {
      setUserTimezone(null);
      setColorblindMode(false);
      setSpoilerFreeMode(true);
      setSpoilerRevealedThrough({});
    }
  }, []);

  // Reveal a league's results through `week` (catch-up: also reveals earlier
  // weeks). Optimistic local bump, then persist; the server clamps to
  // max(existing, week) so out-of-order calls are safe.
  const revealWeek = useCallback((leagueId: string, week: number) => {
    setSpoilerRevealedThrough(m =>
      (m[leagueId] ?? 0) >= week ? m : { ...m, [leagueId]: week });
    api.revealSpoilerWeek(leagueId, week).catch(() => {});
  }, []);

  // Apply <html data-colorblind="true"> so the CSS override block in index.css
  // can retarget red/green tokens (--color-win, --color-loss, MATCHUP_*) to
  // deuteranopia-safe orange/blue equivalents.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (colorblindMode) {
      document.documentElement.setAttribute('data-colorblind', 'true');
    } else {
      document.documentElement.removeAttribute('data-colorblind');
    }
  }, [colorblindMode]);

  // Restore session on mount; load timezone in parallel once we know we're
  // logged in so timestamp formatting doesn't flicker through the browser
  // default during the first render pass.
  useEffect(() => {
    api.me()
      .then(async ({ user: u }) => {
        setUser(u as User | null);
        if (u) await loadPreferences();
      })
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, [loadPreferences]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const { user: u } = await api.login(username, password);
      setUser(u as User);
      await loadPreferences();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err, 'Login failed') };
    }
  }, [loadPreferences]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setUserTimezone(null);
    setColorblindMode(false);
    // Logged-out (public) browsing has no per-user veil state to honor.
    setSpoilerFreeMode(false);
    setSpoilerRevealedThrough({});
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    try {
      await api.changePassword(current, next);
      setUser(prev => prev ? { ...prev, mustChangePassword: false } : null);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err, 'Password change failed') };
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const { user: u } = await api.me().catch(() => ({ user: null }));
    setUser(u as User | null);
    if (u) await loadPreferences();
  }, [loadPreferences]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    isAuthenticated: !!user,
    // `isAdmin` here is the legacy alias for "is staff" — both `admin` and
    // `dev` roles. New code should prefer `isStaff` / `canManageTeam` from
    // lib/permissions; this stays for backwards compat with existing callers.
    isAdmin: isStaff(user),
    userTimezone,
    colorblindMode,
    spoilerFreeMode,
    spoilerRevealedThrough,
    revealWeek,
    refreshTimezone: loadPreferences,
    refreshPreferences: loadPreferences,
    login,
    logout,
    changePassword,
    refreshUser,
  }), [user, isLoading, userTimezone, colorblindMode, spoilerFreeMode, spoilerRevealedThrough, revealWeek, loadPreferences, login, logout, changePassword, refreshUser]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
