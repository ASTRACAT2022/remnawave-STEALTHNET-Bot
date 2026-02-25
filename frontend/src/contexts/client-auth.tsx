import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ClientProfile, ClientAuthResponse } from "@/lib/api";
import { api } from "@/lib/api";

const STORAGE_TOKEN = "stealthnet_client_token";
const STORAGE_CLIENT = "stealthnet_client_profile";

type ClientAuthState = {
  token: string | null;
  client: ClientProfile | null;
  /** Идёт авторизация по Telegram Mini App (initData) */
  miniappAuthLoading: boolean;
  /** Попытка входа по initData уже была (успех или ошибка) */
  miniappAuthAttempted: boolean;
};

type ClientAuthValue = {
  state: ClientAuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string }) => Promise<{ requiresVerification: true } | void>;
  registerByTelegram: (data: { telegramId: string; telegramUsername?: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string }) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
};

const ClientAuthContext = createContext<ClientAuthValue | null>(null);

function loadState(): Pick<ClientAuthState, "token" | "client"> {
  const token = localStorage.getItem(STORAGE_TOKEN);
  const raw = localStorage.getItem(STORAGE_CLIENT);
  const client = raw ? (JSON.parse(raw) as ClientProfile) : null;
  return { token, client };
}

function saveState(token: string | null, client: ClientProfile | null) {
  if (token) localStorage.setItem(STORAGE_TOKEN, token);
  else localStorage.removeItem(STORAGE_TOKEN);
  if (client) localStorage.setItem(STORAGE_CLIENT, JSON.stringify(client));
  else localStorage.removeItem(STORAGE_CLIENT);
}

export function ClientAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ClientAuthState>(() => ({ ...loadState(), miniappAuthLoading: false, miniappAuthAttempted: false }));
  const miniappAttemptedRef = useRef(false);

  // Сразу раскрываем Mini App на весь экран (до авторизации)
  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready?.();
      window.Telegram.WebApp.expand?.();
    }
  }, []);

  useEffect(() => {
    if (state.token || miniappAttemptedRef.current || typeof window === "undefined") return;
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData?.trim()) return;
    miniappAttemptedRef.current = true;
    setState((prev) => (prev.miniappAuthLoading ? prev : { ...prev, miniappAuthLoading: true, miniappAuthAttempted: true }));
    api
      .clientAuthByTelegramMiniapp(initData)
      .then((res) => {
        setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true });
        saveState(res.token, res.client);
      })
      .catch(() => {
        setState((prev) => ({ ...prev, miniappAuthLoading: false, miniappAuthAttempted: true }));
      });
  }, [state.token]);

  const refreshProfile = useCallback(async () => {
    if (!state.token) return;
    try {
      const client = await api.clientMe(state.token);
      setState((prev) => {
        const next = { ...prev, client };
        saveState(prev.token, client);
        return next;
      });
    } catch {
      setState({ token: null, client: null, miniappAuthLoading: false, miniappAuthAttempted: false });
      saveState(null, null);
    }
  }, [state.token]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.clientLogin(email, password);
    setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true });
    saveState(res.token, res.client);
  }, []);

  const register = useCallback(
    async (data: { email: string; password: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string }) => {
      const res = await api.clientRegister({
        email: data.email,
        password: data.password,
        preferredLang: data.preferredLang ?? "ru",
        preferredCurrency: data.preferredCurrency ?? "usd",
        referralCode: data.referralCode,
      });
      if ("requiresVerification" in res && res.requiresVerification) {
        return { requiresVerification: true as const };
      }
      const authRes = res as ClientAuthResponse;
      setState({ token: authRes.token, client: authRes.client, miniappAuthLoading: false, miniappAuthAttempted: true });
      saveState(authRes.token, authRes.client);
    },
    []
  );

  const registerByTelegram = useCallback(
    async (data: { telegramId: string; telegramUsername?: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string }) => {
      const res = await api.clientRegister({
        telegramId: data.telegramId,
        telegramUsername: data.telegramUsername,
        preferredLang: data.preferredLang ?? "ru",
        preferredCurrency: data.preferredCurrency ?? "usd",
        referralCode: data.referralCode,
      });
      if ("token" in res && res.token) {
        setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true });
        saveState(res.token, res.client);
      }
    },
    []
  );

  const verifyEmail = useCallback(async (token: string) => {
    const res = await api.clientVerifyEmail(token);
    setState({ token: res.token, client: res.client, miniappAuthLoading: false, miniappAuthAttempted: true });
    saveState(res.token, res.client);
  }, []);

  const logout = useCallback(() => {
    setState({ token: null, client: null, miniappAuthLoading: false, miniappAuthAttempted: false });
    saveState(null, null);
  }, []);

  const value: ClientAuthValue = {
    state,
    login,
    register,
    registerByTelegram,
    verifyEmail,
    logout,
    refreshProfile,
  };

  return <ClientAuthContext.Provider value={value}>{children}</ClientAuthContext.Provider>;
}

export function useClientAuth() {
  const ctx = useContext(ClientAuthContext);
  if (!ctx) throw new Error("useClientAuth must be used within ClientAuthProvider");
  return ctx;
}
