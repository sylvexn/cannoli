import { createContext, useContext, useState, useCallback } from 'react';
import type { User } from './types';
import { mockUsers, mockPasswords } from '@/mocks/auth';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  changePassword: (current: string, next: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading] = useState(false);

  const login = useCallback(async (username: string, password: string) => {
    // Mock: validate against mock data
    const found = mockUsers.find(u => u.username === username && u.active);
    if (!found || mockPasswords[username] !== password) {
      return { success: false, error: 'Invalid username or password' };
    }
    setUser(found);
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!user) return { success: false, error: 'Not authenticated' };
    if (mockPasswords[user.username] !== current) {
      return { success: false, error: 'Current password is incorrect' };
    }
    // Mock: update password and clear mustChangePassword
    mockPasswords[user.username] = next;
    setUser(prev => prev ? { ...prev, mustChangePassword: false } : null);
    return { success: true };
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'admin',
      login,
      logout,
      changePassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
