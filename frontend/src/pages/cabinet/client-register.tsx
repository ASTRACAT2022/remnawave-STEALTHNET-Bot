import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, UserPlus, Users } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ClientRegisterPage() {
  const [error, setError] = useState("");
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({
    serviceName: "",
    logo: null,
  });
  const [defaults, setDefaults] = useState<{ lang: string; currency: string }>({ lang: "ru", currency: "usd" });
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [supportLink, setSupportLink] = useState<string | null>(null);
  const telegramWidgetRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref")?.trim() || undefined;
  const { state, registerByTelegram } = useClientAuth();
  const navigate = useNavigate();
  const isMiniapp = typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData);

  useEffect(() => {
    api
      .getPublicConfig()
      .then((c) => {
        setBrand({ serviceName: c.serviceName ?? "", logo: c.logo ?? null });
        setDefaults({
          lang: c.defaultLanguage || "ru",
          currency: (c.defaultCurrency || "usd").toLowerCase(),
        });
        setTelegramBotUsername(c.telegramBotUsername ?? null);
        setSupportLink(c.supportLink?.trim() || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!telegramBotUsername || !telegramWidgetRef.current) return;
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", telegramBotUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "onTelegramRegisterAuth(user)");
    script.async = true;
    (window as unknown as { onTelegramRegisterAuth: (user: { id: number; username?: string }) => void }).onTelegramRegisterAuth = (user) => {
      setError("");
      registerByTelegram({
        telegramId: String(user.id),
        telegramUsername: user.username ?? undefined,
        preferredLang: defaults.lang,
        preferredCurrency: defaults.currency,
        referralCode: refCode,
      }).then(() => navigate("/cabinet/dashboard", { replace: true })).catch((err) => {
        setError(err instanceof Error ? err.message : "Ошибка регистрации через Telegram");
      });
    };
    telegramWidgetRef.current.innerHTML = "";
    telegramWidgetRef.current.appendChild(script);
  }, [telegramBotUsername, registerByTelegram, navigate, defaults.lang, defaults.currency, refCode]);

  if (state.blocked) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
        <Card className="w-full max-w-md border shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Аккаунт заблокирован</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">{state.blocked.message}</p>
            {state.blocked.reason ? (
              <div className="rounded-md bg-muted p-3 text-sm">Причина: {state.blocked.reason}</div>
            ) : null}
            {supportLink ? (
              <Button asChild className="w-full">
                <a href={supportLink} target="_blank" rel="noreferrer">Написать в поддержку</a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-center gap-2 mb-6 min-h-[2.5rem]">
          {brand.logo ? (
            <span className="flex h-10 items-center justify-center rounded-xl bg-card px-2">
              <img src={brand.logo} alt="" className="h-9 w-auto object-contain" />
            </span>
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shrink-0">
              <Shield className="h-6 w-6" />
            </span>
          )}
          {brand.serviceName ? <span className="font-semibold text-xl">{brand.serviceName}</span> : null}
        </div>
        <Card className="border shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-2">
              <div className="rounded-lg bg-primary/10 p-3">
                <UserPlus className="h-10 w-10 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">Регистрация через Telegram</CardTitle>
            <p className="text-muted-foreground text-sm">Клиентская регистрация и вход работают только через Telegram.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {(error || state.miniappAuthError) && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                {error || state.miniappAuthError}
              </div>
            )}
            {refCode && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Users className="h-4 w-4" />
                  Реферальная регистрация
                </div>
                <p className="mt-2 text-muted-foreground">После входа через Telegram вы зарегистрируетесь по реферальному коду: <strong>{refCode}</strong>.</p>
              </div>
            )}
            {telegramBotUsername && !isMiniapp ? (
              <div className="space-y-3">
                <div ref={telegramWidgetRef} className="flex justify-center min-h-[44px]" />
                <p className="text-center text-sm text-muted-foreground">
                  Если аккаунт уже существует, Telegram просто выполнит вход без создания дубля.
                </p>
              </div>
            ) : isMiniapp ? (
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                Внутри Mini App регистрация должна пройти автоматически после открытия. Если этого не произошло, проверьте `BOT_TOKEN` в `api` и `bot` и перезапустите контейнеры.
              </div>
            ) : (
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                Telegram-вход пока не настроен. Укажите username бота в настройках.
              </div>
            )}
            <p className="text-center text-sm text-muted-foreground">
              Уже есть аккаунт?{" "}
              <Link to="/cabinet/login" className="text-primary hover:underline">
                Войти через Telegram
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
