import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { createApiClient } from '@nukedrive/shared';
import type { User } from '@nukedrive/shared';

// Android uygulamasında sunucu adresi girişte sorulur ve saklanır; web'de boş = aynı origin
export const IS_NATIVE: boolean = !!(window as any).Capacitor?.isNativePlatform?.();
const storedServer = () => { try { return localStorage.getItem('nd_server') || ''; } catch { return ''; } };
export const API_BASE: string = (import.meta as any).env?.VITE_API_BASE || (IS_NATIVE ? storedServer() : '');

interface Ctx {
  token: string | null;
  user: User | null;
  api: ReturnType<typeof createApiClient>;
  serverUrl: string;
  setServerUrl: (url: string) => void;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, password: string, name: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('nd_token'));
  const [user, setUser] = useState<User | null>(null);
  const [serverUrl, setServerUrlState] = useState<string>(() => API_BASE);

  const api = useMemo(() => createApiClient({
    baseUrl: serverUrl,
    getToken: () => localStorage.getItem('nd_token'),
    setToken: (t) => {
      if (t) localStorage.setItem('nd_token', t);
      else localStorage.removeItem('nd_token');
      setToken(t);
    }
  }), [serverUrl]);

  const setServerUrl = useCallback((raw: string) => {
    let s = raw.trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) {
      // Yerel IP veya localhost ise http, alan adı ise https varsay
      const isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s);
      s = (isLocal ? 'http://' : 'https://') + s;
    }
    api.baseUrl = s;
    try {
      if (s) localStorage.setItem('nd_server', s);
      else localStorage.removeItem('nd_server');
    } catch {}
    setServerUrlState(s);
  }, [api]);

  const refreshUser = useCallback(async () => {
    if (!localStorage.getItem('nd_token')) {
      setUser(null);
      return;
    }
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      api.logout();
      setUser(null);
    }
  }, [api]);

  useEffect(() => {
    if (token) refreshUser();
    else setUser(null);
  }, [token, refreshUser]);

  const login = async (identifier: string, password: string) => {
    const res = await api.login(identifier, password);
    setUser(res.user);
  };
  const register = async (username: string, password: string, name: string) => {
    const res = await api.register(username, password, name);
    setUser(res.user);
  };
  const logout = () => {
    api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, api, serverUrl, setServerUrl, login, register, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
