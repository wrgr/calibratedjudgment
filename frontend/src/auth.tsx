import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from './api/client';

export interface User {
  username: string;
  role: 'admin' | 'instructor' | 'student';
  displayName: string;
  theme: string;
  preferredProvider: string;
  preferredModel: string;
  gradingStyle: string;
  styleIntensity: 'subtle' | 'moderate' | 'strong';
}

interface AuthState {
  user: User | null;
  loading: boolean;
  // `role` is only honoured by the static (backend-free) build, where auth is
  // bypassed to a username + role and the password is ignored (OAuth is future
  // work). The real backend authenticates username+password and ignores role.
  login: (username: string, password: string, role?: User['role']) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.get<User>('/api/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else throw e;
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (username: string, password: string, role?: User['role']) => {
    setUser(await api.post<User>('/api/auth/login', { username, password, role }));
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export const isStaff = (u: User | null) => u?.role === 'admin' || u?.role === 'instructor';
