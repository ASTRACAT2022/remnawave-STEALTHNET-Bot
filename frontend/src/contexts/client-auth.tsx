import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ClientProfile } from "@/lib/api";
import { ApiRequestError, api } from "@/lib/api";

const STORAGE_TOKEN = "stealthnet_client_token";
const STORAGE_CLIENT = "stealthnet_client_profile";

type ClientAuthState = {
  token: string | null;
  client: ClientProfile | null;
  blocked: { message: string; reason: string | null } | null;
  /** Идёт авторизация по Telegram Mini App (initData) */
  miniappAuthLoading: boolean;
  /** Попытка входа по initData уже была (успех или ошибка) */
  miniappAuthAttempted: boolean;
  miniappAuthError: string | null;
};

type ClientAuthValue = {
  state: ClientAuthState;
  registerByTelegram: (data: { telegramId: string; telegramUsername?: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string }) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
};

const ClientAuthContext = createContext<ClientAuthValue | null>(null);

function toBlockedState(error: unknown): { message: string; reason: string | null } | null {
  if (!(error instanceof ApiRequestError) || error.status !== 403) return null;
  const data = error.data && typeof error.data === "object" ? (error.data as Record<string, unknown>) : null;
  const isBlocked = data?.isBlocked === true || /blocked/i.test(error.message);
  if (!isBlocked) return null;
  return {
    message: "Ваш аккаунт заблокирован. Доступ к кабинету закрыт.",
    reason: typeof data?.blockReason === "string" && data.blockReason.trim() ? data.blockReason.trim() : null,
  };
}

function loadState(): Pick<ClientAuthState, "token" | "client" | "blocked"> {
  const token = localStorage.getItem(STORAGE_TOKEN);
  const raw = localStorage.getItem(STORAGE_CLIENT);
  const client = raw ? (JSON.parse(raw) as ClientProfile) : null;
  const blocked = client?.isBlocked
    ? {
        message: "Ваш аккаунт заблокирован. Доступ к кабинету закрыт.",
        reason: client.blockReason?.trim() || null,
      }
    : null;
  return { token, client, blocked };
}

function saveState(token: string | null, client: ClientProfile | null) {
  if (token) localStorage.setItem(STORAGE_TOKEN, token);
  else localStorage.removeItem(STORAGE_TOKEN);
  if (client) localStorage.setItem(STORAGE_CLIENT, JSON.stringify(client));
  else localStorage.removeItem(STORAGE_CLIENT);
}

function getMiniappFallbackUser(): { telegramId: string; telegramUsername?: string } | null {
  if (typeof window === "undefined") return null;
  const rawUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!rawUser || rawUser.id == null) return null;
  const telegramId = String(rawUser.id).trim();
  if (!telegramId) return null;
  const telegramUsername = typeof rawUser.username === "string" && rawUser.username.trim()
    ? rawUser.username.trim()
    : undefined;
  return { telegramId, telegramUsername };
}

export function ClientAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ClientAuthState>(() => ({ ...loadState(), miniappAuthLoading: false, miniappAuthAttempted: false, miniappAuthError: null }));
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
    setState((prev) => (prev.miniappAuthLoading ? prev : { ...prev, miniappAuthLoading: true, miniappAuthAttempted: true, miniappAuthError: null }));
    api
      .clientAuthByTelegramMiniapp(initData)
      .then((res) => {
        setState({ token: res.token, client: res.client, blocked: null, miniappAuthLoading: false, miniappAuthAttempted: true, miniappAuthError: null });
        saveState(res.token, res.client);
      })
      .catch(async (error: unknown) => {
        const blocked = toBlockedState(error);
        if (blocked) {
          setState({ token: null, client: null, blocked, miniappAuthLoading: false, miniappAuthAttempted: true, miniappAuthError: null });
          saveState(null, null);
          return;
        }
        const fallbackUser = getMiniappFallbackUser();
        if (fallbackUser) {
          try {
            const res = await api.clientRegister({
              telegramId: fallbackUser.telegramId,
              telegramUsername: fallbackUser.telegramUsername,
            });
            setState({ token: res.token, client: res.client, blocked: null, miniappAuthLoading: false, miniappAuthAttempted: true, miniappAuthError: null });
            saveState(res.token, res.client);
            return;
          } catch (fallbackError: unknown) {
            const fallbackBlocked = toBlockedState(fallbackError);
            if (fallbackBlocked) {
              setState({ token: null, client: null, blocked: fallbackBlocked, miniappAuthLoading: false, miniappAuthAttempted: true, miniappAuthError: null });
              saveState(null, null);
              return;
            }
            setState((prev) => ({
              ...prev,
              miniappAuthLoading: false,
              miniappAuthAttempted: true,
              miniappAuthError: fallbackError instanceof Error ? fallbackError.message : "Ошибка авторизации Mini App",
            }));
            return;
          }
        }
        setState((prev) => ({
          ...prev,
          miniappAuthLoading: false,
          miniappAuthAttempted: true,
          miniappAuthError: error instanceof Error ? error.message : "Ошибка авторизации Mini App",
        }));
      });
  }, [state.token]);

  const refreshProfile = useCallback(async () => {
    if (!state.token) return;
    try {
      const client = await api.clientMe(state.token);
      setState((prev) => {
        const next = { ...prev, client, blocked: client.isBlocked ? { message: "Ваш аккаунт заблокирован. Доступ к кабинету закрыт.", reason: client.blockReason?.trim() || null } : null };
        saveState(prev.token, client);
        return next;
      });
    } catch (error: unknown) {
      const blocked = toBlockedState(error);
      if (blocked) {
        setState({ token: null, client: null, blocked, miniappAuthLoading: false, miniappAuthAttempted: true, miniappAuthError: null });
        saveState(null, null);
        return;
      }
      setState({ token: null, client: null, blocked: null, miniappAuthLoading: false, miniappAuthAttempted: false, miniappAuthError: null });
      saveState(null, null);
    }
  }, [state.token]);

  const registerByTelegram = useCallback(
    async (data: { telegramId: string; telegramUsername?: string; preferredLang?: string; preferredCurrency?: string; referralCode?: string }) => {
      try {
        const res = await api.clientRegister({
          telegramId: data.telegramId,
          telegramUsername: data.telegramUsername,
          preferredLang: data.preferredLang ?? "ru",
          preferredCurrency: data.preferredCurrency ?? "usd",
          referralCode: data.referralCode,
        });
        if ("token" in res && res.token) {
          setState({ token: res.token, client: res.client, blocked: null, miniappAuthLoading: false, miniappAuthAttempted: true, miniappAuthError: null });
          saveState(res.token, res.client);
        }
      } catch (error: unknown) {
        const blocked = toBlockedState(error);
        if (blocked) {
          setState({ token: null, client: null, blocked, miniappAuthLoading: false, miniappAuthAttempted: true, miniappAuthError: null });
          saveState(null, null);
        }
        throw error;
      }
    },
    []
  );

  const logout = useCallback(() => {
    setState({ token: null, client: null, blocked: null, miniappAuthLoading: false, miniappAuthAttempted: false, miniappAuthError: null });
    saveState(null, null);
  }, []);

  const value: ClientAuthValue = {
    state,
    registerByTelegram,
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
