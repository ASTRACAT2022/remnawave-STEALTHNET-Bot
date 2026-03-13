import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogIn, MessageCircle, Shield } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ClientLoginPage() {
  const [error, setError] = useState("");
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({
    serviceName: "",
    logo: null,
  });
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [supportLink, setSupportLink] = useState<string | null>(null);
  const telegramWidgetRef = useRef<HTMLDivElement>(null);
  const { state, registerByTelegram } = useClientAuth();
  const navigate = useNavigate();
  const isMiniapp = typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData);

  useEffect(() => {
    api
      .getPublicConfig()
      .then((c) => {
        setBrand({ serviceName: c.serviceName ?? "", logo: c.logo ?? null });
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
    script.setAttribute("data-onauth", "onTelegramLoginAuth(user)");
    script.async = true;
    (window as unknown as { onTelegramLoginAuth: (user: { id: number; username?: string }) => void }).onTelegramLoginAuth = (user) => {
      setError("");
      registerByTelegram({
        telegramId: String(user.id),
        telegramUsername: user.username,
      }).then(() => navigate("/cabinet/dashboard", { replace: true })).catch((err) => {
        setError(err instanceof Error ? err.message : "Ошибка входа через Telegram");
      });
    };
    telegramWidgetRef.current.innerHTML = "";
    telegramWidgetRef.current.appendChild(script);
  }, [telegramBotUsername, registerByTelegram, navigate]);

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
                <LogIn className="h-10 w-10 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">Вход через Telegram</CardTitle>
            <p className="text-muted-foreground text-sm">Email и пароль для клиентов отключены. Вход и регистрация работают только через Telegram.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {(error || state.miniappAuthError) && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                {error || state.miniappAuthError}
              </div>
            )}
            {telegramBotUsername && !isMiniapp ? (
              <div className="space-y-3">
                <div ref={telegramWidgetRef} className="flex justify-center min-h-[44px]" />
                <p className="text-center text-sm text-muted-foreground">
                  Если вы входите впервые, аккаунт создастся автоматически после входа через Telegram.
                </p>
              </div>
            ) : isMiniapp ? (
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                Mini App должен авторизовать пользователя автоматически. Если вход не прошёл, проверьте `BOT_TOKEN` в `api` и `bot` и перезапустите контейнеры.
              </div>
            ) : (
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                Telegram-вход пока не настроен. Укажите username бота в настройках.
              </div>
            )}
            <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <MessageCircle className="h-4 w-4" />
                Нужна регистрация по реферальной ссылке?
              </div>
              <p className="mt-2">
                Откройте страницу{" "}
                <Link to="/cabinet/register" className="text-primary hover:underline">
                  регистрации
                </Link>{" "}
                и войдите там через Telegram.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
