import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { User } from './types';
import { api } from './api';

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
  refreshTimezone: () => Promise<void>;
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

  const loadTimezone = useCallback(async () => {
    try {
      const prefs = await api.getMyPreferences();
      setUserTimezone(prefs.timezone ?? null);
    } catch {
      setUserTimezone(null);
    }
  }, []);

  // Restore session on mount; load timezone in parallel once we know we're
  // logged in so timestamp formatting doesn't flicker through the browser
  // default during the first render pass.
  useEffect(() => {
    api.me()
      .then(async ({ user: u }) => {
        setUser(u as User | null);
        if (u) await loadTimezone();
      })
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, [loadTimezone]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const { user: u } = await api.login(username, password);
      setUser(u as User);
      await loadTimezone();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Login failed' };
    }
  }, [loadTimezone]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setUserTimezone(null);
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    try {
      await api.changePassword(current, next);
      setUser(prev => prev ? { ...prev, mustChangePassword: false } : null);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Password change failed' };
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const { user: u } = await api.me().catch(() => ({ user: null }));
    setUser(u as User | null);
    if (u) await loadTimezone();
  }, [loadTimezone]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin' || user?.role === 'dev',
    userTimezone,
    refreshTimezone: loadTimezone,
    login,
    logout,
    changePassword,
    refreshUser,
  }), [user, isLoading, userTimezone, loadTimezone, login, logout, changePassword, refreshUser]);

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
