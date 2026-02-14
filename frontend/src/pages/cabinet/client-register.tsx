import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { UserPlus, Shield, Mail } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

declare global {
  interface Window {
    TelegramLoginWidget?: {
      dataOnauth: (user: { id: number; first_name?: string; username?: string }) => void;
    };
  }
}

export function ClientRegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({
    serviceName: "",
    logo: null,
  });
  const [defaults, setDefaults] = useState<{ lang: string; currency: string }>({ lang: "ru", currency: "usd" });
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const telegramWidgetRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref")?.trim() || undefined;
  const { register, registerByTelegram } = useClientAuth();
  const navigate = useNavigate();

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
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.async = true;
    (window as unknown as { onTelegramAuth: (user: { id: number; first_name?: string; username?: string }) => void }).onTelegramAuth = (user) => {
      registerByTelegram({
        telegramId: String(user.id),
        telegramUsername: user.username ?? undefined,
        preferredLang: defaults.lang,
        preferredCurrency: defaults.currency,
        referralCode: refCode,
      }).then(() => navigate("/cabinet/dashboard", { replace: true }));
    };
    telegramWidgetRef.current.innerHTML = "";
    telegramWidgetRef.current.appendChild(script);
  }, [telegramBotUsername, registerByTelegram, navigate, defaults.lang, defaults.currency, refCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setEmailSent(false);
    setLoading(true);
    try {
      const result = await register({
        email: email.trim().toLowerCase(),
        password,
        preferredLang: defaults.lang,
        preferredCurrency: defaults.currency,
        referralCode: refCode,
      });
      if (result?.requiresVerification) {
        setEmailSent(true);
      } else {
        navigate("/cabinet/dashboard", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка регистрации");
    } finally {
      setLoading(false);
    }
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
            <CardTitle className="text-2xl">Регистрация</CardTitle>
            <p className="text-muted-foreground text-sm">Создайте аккаунт в кабинете</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {emailSent && (
                <div className="rounded-md bg-green-500/10 text-green-700 dark:text-green-400 text-sm p-3 flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0" />
                  На вашу почту отправлена ссылка для подтверждения. Перейдите по ней, чтобы завершить регистрацию.
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Регистрация…" : "Зарегистрироваться"}
              </Button>
              {telegramBotUsername && (
                <div className="space-y-2">
                  <p className="text-center text-sm text-muted-foreground">или</p>
                  <div ref={telegramWidgetRef} className="flex justify-center min-h-[44px]" />
                </div>
              )}
              <p className="text-center text-sm text-muted-foreground">
                Уже есть аккаунт?{" "}
                <Link to="/cabinet/login" className="text-primary hover:underline">
                  Войти
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
