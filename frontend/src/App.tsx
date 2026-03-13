import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

const routerFutureFlags = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
import { AuthProvider, useAuth } from "@/contexts/auth";
import { ClientAuthProvider, useClientAuth } from "@/contexts/client-auth";
import { ThemeProvider } from "@/contexts/theme";
import type { ThemeAccent } from "@/contexts/theme";
import { AnimatedBackground } from "@/components/animated-background";
import { api } from "@/lib/api";
import { LoginPage } from "@/pages/login";
import { ChangePasswordPage } from "@/pages/change-password";
import { DashboardPage } from "@/pages/dashboard";
import { ClientsPage } from "@/pages/clients";
import { TariffsPage } from "@/pages/tariffs";
import { SettingsPage } from "@/pages/settings";
import { PromoPage } from "@/pages/promo";
import { PromoCodesPage } from "@/pages/promo-codes";
import { BroadcastPage } from "@/pages/broadcast";
import { NalogoReceiptsPage } from "@/pages/nalogo-receipts";
import { AnalyticsPage } from "@/pages/analytics";
import { SalesReportPage } from "@/pages/sales-report";
import { BackupPage } from "@/pages/backup";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { CabinetLayout } from "@/pages/cabinet/cabinet-layout";
import { ClientLoginPage } from "@/pages/cabinet/client-login";
import { ClientRegisterPage } from "@/pages/cabinet/client-register";
import { ClientVerifyEmailPage } from "@/pages/cabinet/client-verify-email";
import { ClientDashboardPage } from "@/pages/cabinet/client-dashboard";
import { ClientTariffsPage } from "@/pages/cabinet/client-tariffs";
import { ClientProfilePage } from "@/pages/cabinet/client-profile";
import { ClientReferralPage } from "@/pages/cabinet/client-referral";
import { ClientSubscribePage } from "@/pages/cabinet/client-subscribe";
import { ClientYooMoneyPayPage } from "@/pages/cabinet/client-yoomoney-pay";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const hasToken = Boolean(state.accessToken);

  if (!hasToken) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

function ForceChangePassword({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.admin?.mustChangePassword) {
    return <Navigate to="/admin/change-password" replace />;
  }
  return <>{children}</>;
}

function RequireClientAuth({ children }: { children: React.ReactNode }) {
  const { state } = useClientAuth();
  const inTelegram = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  const showMiniappLoading = state.miniappAuthLoading || (inTelegram && !state.token && !state.miniappAuthAttempted);
  if (state.blocked) {
    return <BlockedClientScreen message={state.blocked.message} reason={state.blocked.reason} />;
  }
  if (showMiniappLoading) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Загрузка кабинета…</p>
      </div>
    );
  }
  if (!state.token) {
    return <Navigate to="/cabinet/login" replace />;
  }
  return <>{children}</>;
}

function CabinetIndexRedirect() {
  const { state } = useClientAuth();
  const inTelegram = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  const showMiniappLoading = state.miniappAuthLoading || (inTelegram && !state.token && !state.miniappAuthAttempted);
  if (state.blocked) {
    return <BlockedClientScreen message={state.blocked.message} reason={state.blocked.reason} />;
  }
  if (showMiniappLoading) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Загрузка кабинета…</p>
      </div>
    );
  }
  return <Navigate to={state.token ? "/cabinet/dashboard" : "/cabinet/login"} replace />;
}

function BlockedClientScreen({ message, reason }: { message: string; reason: string | null }) {
  const [supportLink, setSupportLink] = useState<string | null>(null);

  useEffect(() => {
    api.getPublicConfig().then((cfg) => setSupportLink(cfg.supportLink?.trim() || null)).catch(() => setSupportLink(null));
  }, []);

  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20 px-4 text-center">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg">
        <h1 className="text-2xl font-semibold">Аккаунт заблокирован</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {reason ? <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">Причина: {reason}</p> : null}
        <p className="mt-3 text-sm text-muted-foreground">Доступ к кабинету отключён.</p>
        {supportLink ? (
          <Button asChild className="mt-5 w-full">
            <a href={supportLink} target="_blank" rel="noreferrer">Написать в поддержку</a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AppRoutes() {
  const { state, refreshAccess } = useAuth();

  useEffect(() => {
    if (!state.accessToken && state.refreshToken) {
      refreshAccess();
    }
  }, []);

  return (
    <Routes>
      {/* Открытие домена → кабинет клиента */}
      <Route path="/" element={<Navigate to="/cabinet" replace />} />

      {/* Админка */}
      <Route path="/admin/login" element={state.accessToken ? <Navigate to="/admin" replace /> : <LoginPage />} />
      <Route
        path="/admin/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <ForceChangePassword>
              <DashboardPage />
            </ForceChangePassword>
          }
        />
        <Route path="clients" element={<ForceChangePassword><ClientsPage /></ForceChangePassword>} />
        <Route path="tariffs" element={<ForceChangePassword><TariffsPage /></ForceChangePassword>} />
        <Route path="settings" element={<ForceChangePassword><SettingsPage /></ForceChangePassword>} />
        <Route path="promo" element={<ForceChangePassword><PromoPage /></ForceChangePassword>} />
        <Route path="promo-codes" element={<ForceChangePassword><PromoCodesPage /></ForceChangePassword>} />
        <Route path="broadcast" element={<ForceChangePassword><BroadcastPage /></ForceChangePassword>} />
        <Route path="nalogo-receipts" element={<ForceChangePassword><NalogoReceiptsPage /></ForceChangePassword>} />
        <Route path="analytics" element={<ForceChangePassword><AnalyticsPage /></ForceChangePassword>} />
        <Route path="sales-report" element={<ForceChangePassword><SalesReportPage /></ForceChangePassword>} />
        <Route path="backup" element={<ForceChangePassword><BackupPage /></ForceChangePassword>} />
      </Route>
      <Route
        path="/cabinet"
        element={
          <ClientAuthProvider>
            <CabinetLayout />
          </ClientAuthProvider>
        }
      >
        <Route index element={<CabinetIndexRedirect />} />
        <Route path="login" element={<ClientLoginPage />} />
        <Route path="register" element={<ClientRegisterPage />} />
        <Route path="verify-email" element={<ClientVerifyEmailPage />} />
        <Route
          path="dashboard"
          element={
            <RequireClientAuth>
              <ClientDashboardPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="tariffs"
          element={
            <RequireClientAuth>
              <ClientTariffsPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireClientAuth>
              <ClientProfilePage />
            </RequireClientAuth>
          }
        />
        <Route
          path="referral"
          element={
            <RequireClientAuth>
              <ClientReferralPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="subscribe"
          element={
            <RequireClientAuth>
              <ClientSubscribePage />
            </RequireClientAuth>
          }
        />
        <Route
          path="yoomoney-pay"
          element={
            <RequireClientAuth>
              <ClientYooMoneyPayPage />
            </RequireClientAuth>
          }
        />
      </Route>
      {/* Всё неизвестное тоже ведём в кабинет */}
      <Route path="*" element={<Navigate to="/cabinet" replace />} />
    </Routes>
  );
}

function CabinetBackgroundLayer() {
  const location = useLocation();
  const isCabinetRoute = location.pathname.startsWith("/cabinet");

  useEffect(() => {
    document.body.classList.toggle("cabinet-bg-active", isCabinetRoute);
    return () => {
      document.body.classList.remove("cabinet-bg-active");
    };
  }, [isCabinetRoute]);

  if (!isCabinetRoute) return null;
  return <AnimatedBackground />;
}

function TitleAndThemeSync({ onAccent }: { onAccent: (a: ThemeAccent | null) => void }) {
  const location = useLocation();
  const [config, setConfig] = useState<{ serviceName: string; favicon: string | null } | null>(null);

  // Подтягиваем конфиг при смене маршрута (в т.ч. после сохранения настроек), чтобы favicon обновился
  useEffect(() => {
    api
      .getPublicConfig()
      .then((cfg) => {
        setConfig({
          serviceName: cfg.serviceName ?? "",
          favicon: (cfg as { favicon?: string | null }).favicon ?? null,
        });
        // Глобальная тема из настроек
        const accent = (cfg as { themeAccent?: string }).themeAccent;
        onAccent(accent ? (accent as ThemeAccent) : null);
      })
      .catch(() => {
        setConfig({ serviceName: "", favicon: null });
      });
  }, [location.pathname]);

  // Title и favicon
  useEffect(() => {
    const base = config?.serviceName ?? "";
    let suffix = "";
    if (location.pathname.startsWith("/admin")) suffix = " — Admin";
    else if (location.pathname.startsWith("/cabinet")) suffix = " — Кабинет";
    document.title = (base + suffix).trim() || suffix.replace(/^ — /, "").trim();

    const favicon = config?.favicon ?? null;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) {
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = favicon;
      if (favicon.startsWith("data:image/")) {
        const m = favicon.match(/data:image\/(\w+)/);
        link.type = m ? `image/${m[1]}` : "image/png";
      } else {
        link.type = "image/png";
      }
    }
  }, [location.pathname, config]);

  return null;
}

export default function App() {
  const [globalAccent, setGlobalAccent] = useState<ThemeAccent | null>(null);

  return (
    <ThemeProvider forcedAccent={globalAccent}>
      <AuthProvider>
        <BrowserRouter future={routerFutureFlags}>
          <CabinetBackgroundLayer />
          <TitleAndThemeSync onAccent={setGlobalAccent} />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
