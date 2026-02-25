import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Admin, AuthState } from "@/lib/api";
import { api, setTokenRefreshFn } from "@/lib/api";

const STORAGE_KEYS = {
  access: "stealthnet_access_token",
  refresh: "stealthnet_refresh_token",
  admin: "stealthnet_admin",
};

function loadState(): AuthState {
  const access = localStorage.getItem(STORAGE_KEYS.access);
  const refresh = localStorage.getItem(STORAGE_KEYS.refresh);
  const adminRaw = localStorage.getItem(STORAGE_KEYS.admin);
  const admin = adminRaw ? (JSON.parse(adminRaw) as Admin) : null;
  return { accessToken: access, refreshToken: refresh, admin };
}

function saveState(state: AuthState) {
  if (state.accessToken) localStorage.setItem(STORAGE_KEYS.access, state.accessToken);
  else localStorage.removeItem(STORAGE_KEYS.access);
  if (state.refreshToken) localStorage.setItem(STORAGE_KEYS.refresh, state.refreshToken);
  else localStorage.removeItem(STORAGE_KEYS.refresh);
  if (state.admin) localStorage.setItem(STORAGE_KEYS.admin, JSON.stringify(state.admin));
  else localStorage.removeItem(STORAGE_KEYS.admin);
}

function clearState() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (access: string, refresh: string, admin: Admin) => void;
  updateAdmin: (admin: Admin) => void;
  /** Возвращает новый access token при успехе, null при ошибке. */
  refreshAccess: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(loadState);

  const setTokens = useCallback((access: string, refresh: string, admin: Admin) => {
    const next = { accessToken: access, refreshToken: refresh, admin };
    setState(next);
    saveState(next);
  }, []);

  const updateAdmin = useCallback((admin: Admin) => {
    setState((prev) => {
      if (!prev.admin) return prev;
      const next = { ...prev, admin };
      saveState(next);
      return next;
    });
  }, []);

  const refreshAccess = useCallback(async (): Promise<string | null> => {
    const refresh = state.refreshToken;
    if (!refresh) return null;
    try {
      const res = await api.refresh(refresh);
      setTokens(res.accessToken, refresh, res.admin);
      return res.accessToken;
    } catch {
      clearState();
      setState({ accessToken: null, refreshToken: null, admin: null });
      return null;
    }
  }, [state.refreshToken, setTokens]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      setTokens(res.accessToken, res.refreshToken, res.admin);
    },
    [setTokens]
  );

  const logout = useCallback(async () => {
    await api.logout(state.refreshToken);
    clearState();
    setState({ accessToken: null, refreshToken: null, admin: null });
  }, [state.refreshToken]);

  useEffect(() => {
    setTokenRefreshFn(() => refreshAccess());
    return () => setTokenRefreshFn(null);
  }, [refreshAccess]);

  useEffect(() => {
    if (!state.accessToken && state.refreshToken) {
      refreshAccess();
    }
  }, []);

  const value: AuthContextValue = {
    state,
    login,
    logout,
    setTokens,
    updateAdmin,
    refreshAccess,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
