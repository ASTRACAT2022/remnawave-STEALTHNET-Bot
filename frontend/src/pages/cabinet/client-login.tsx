import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogIn, Shield } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ClientLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({
    serviceName: "",
    logo: null,
  });
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const telegramWidgetRef = useRef<HTMLDivElement>(null);
  const { login, registerByTelegram } = useClientAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .getPublicConfig()
      .then((c) => {
        setBrand({ serviceName: c.serviceName ?? "", logo: c.logo ?? null });
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
    script.setAttribute("data-onauth", "onTelegramLoginAuth(user)");
    script.async = true;
    (window as unknown as { onTelegramLoginAuth: (user: { id: number; username?: string }) => void }).onTelegramLoginAuth = (user) => {
      registerByTelegram({
        telegramId: String(user.id),
        telegramUsername: user.username,
      }).then(() => navigate("/cabinet/dashboard", { replace: true }));
    };
    telegramWidgetRef.current.innerHTML = "";
    telegramWidgetRef.current.appendChild(script);
  }, [telegramBotUsername, registerByTelegram, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/cabinet/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
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
                <LogIn className="h-10 w-10 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">Вход</CardTitle>
            <p className="text-muted-foreground text-sm">Вход в личный кабинет</p>
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
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Вход…" : "Войти"}
              </Button>
              {telegramBotUsername && (
                <div className="space-y-2">
                  <p className="text-center text-sm text-muted-foreground">или войти через Telegram</p>
                  <div ref={telegramWidgetRef} className="flex justify-center min-h-[44px]" />
                </div>
              )}
              <p className="text-center text-sm text-muted-foreground">
                Нет аккаунта?{" "}
                <Link to="/cabinet/register" className="text-primary hover:underline">
                  Зарегистрироваться
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
