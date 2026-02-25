import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Users, Percent, Wallet, Link2, Copy, Check, Loader2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import type { ClientReferralStats } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function formatMoney(amount: number, currency: string = "usd") {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "UAH",
  }).format(amount);
}

export function ClientReferralPage() {
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const client = state.client;
  const currency = (client?.preferredCurrency ?? "usd").toLowerCase();

  const [stats, setStats] = useState<ClientReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState<"site" | "bot" | null>(null);

  const siteOrigin = config?.publicAppUrl?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const referralLinkSite =
    stats?.referralCode && siteOrigin
      ? `${siteOrigin}/cabinet/register?ref=${encodeURIComponent(stats.referralCode)}`
      : null;
  const referralLinkBot =
    stats?.referralCode && config?.telegramBotUsername
      ? `https://t.me/${config.telegramBotUsername.replace(/^@/, "")}?start=ref_${stats.referralCode}`
      : null;
  const hasReferralLinks = Boolean(referralLinkSite || referralLinkBot);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    api
      .getClientReferralStats(token)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [token]);

  const copyLink = (which: "site" | "bot") => {
    const url = which === "site" ? referralLinkSite : referralLinkBot;
    if (url) {
      navigator.clipboard.writeText(url);
      setCopiedRef(which);
      setTimeout(() => setCopiedRef(null), 2000);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/15 border border-destructive/30 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="space-y-5 w-full min-w-0 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Рефералы</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Приглашайте друзей — получайте процент от их пополнений.
        </p>
      </motion.div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <Card className="overflow-hidden">
            <CardContent className="pt-4 pb-3 px-3 sm:px-6 sm:pt-6 sm:pb-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <Percent className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[11px] sm:text-sm font-medium truncate">Процент</span>
              </div>
              <p className="text-lg sm:text-2xl font-bold">{s.referralPercent}%</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">от пополнений (1 ур.)</p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="overflow-hidden">
            <CardContent className="pt-4 pb-3 px-3 sm:px-6 sm:pt-6 sm:pb-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[11px] sm:text-sm font-medium truncate">Приглашено</span>
              </div>
              <p className="text-lg sm:text-2xl font-bold">{s.referralCount}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">рефералов</p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <Card className="overflow-hidden">
            <CardContent className="pt-4 pb-3 px-3 sm:px-6 sm:pt-6 sm:pb-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <Wallet className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[11px] sm:text-sm font-medium truncate">Заработок</span>
              </div>
              <p className="text-lg sm:text-2xl font-bold truncate">{formatMoney(s.totalEarnings, currency)}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">на баланс</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {hasReferralLinks ? (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="rounded-xl border bg-card p-3 sm:p-4 space-y-3"
        >
          <h2 className="flex items-center gap-2 text-xs sm:text-sm font-medium uppercase tracking-wider text-muted-foreground">
            <Link2 className="h-4 w-4 shrink-0" />
            Реферальные ссылки
          </h2>
          {referralLinkSite && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Сайт</p>
              <div className="flex gap-2 min-w-0">
                <code className="flex-1 min-w-0 truncate rounded-lg bg-muted px-2.5 py-2 text-xs sm:text-sm font-mono" title={referralLinkSite}>
                  {referralLinkSite}
                </code>
                <Button variant="outline" size="icon" onClick={() => copyLink("site")} className="shrink-0 h-9 w-9" title="Копировать">
                  {copiedRef === "site" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
          {referralLinkBot && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Бот Telegram</p>
              <div className="flex gap-2 min-w-0">
                <code className="flex-1 min-w-0 truncate rounded-lg bg-muted px-2.5 py-2 text-xs sm:text-sm font-mono" title={referralLinkBot}>
                  {referralLinkBot}
                </code>
                <Button variant="outline" size="icon" onClick={() => copyLink("bot")} className="shrink-0 h-9 w-9" title="Копировать">
                  {copiedRef === "bot" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </motion.section>
      ) : (
        <p className="text-sm text-muted-foreground">Реферальные ссылки недоступны.</p>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.25 }}
        className="rounded-lg bg-muted/50 border border-border p-3 sm:p-4 text-sm text-muted-foreground"
      >
        <p className="font-medium text-foreground mb-1">Как это работает</p>
        <ul className="list-disc list-inside space-y-0.5 text-xs sm:text-sm">
          <li>1 уровень — <strong>{s.referralPercent}%</strong> от пополнений тех, кто перешёл по вашей ссылке.</li>
          <li>2 уровень — <strong>{s.referralPercentLevel2 ?? 0}%</strong> от пополнений рефералов ваших рефералов.</li>
          <li>3 уровень — <strong>{s.referralPercentLevel3 ?? 0}%</strong> от пополнений рефералов второго уровня.</li>
          <li>Начисления зачисляются на ваш баланс для оплаты тарифов.</li>
        </ul>
      </motion.div>
    </div>
  );
}
