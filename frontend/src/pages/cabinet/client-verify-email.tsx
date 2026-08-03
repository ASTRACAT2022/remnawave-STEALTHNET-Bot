import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, Mail, Shield, Loader2, CheckCircle2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ClientVerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "set-password" | "done" | "error">("loading");
  const [message, setMessage] = useState("");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState("");
  const [busy, setBusy] = useState(false);
  const { verifyEmail } = useClientAuth();
  const navigate = useNavigate();
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (!token || verifiedRef.current) return;
    verifiedRef.current = true;
    verifyEmail(token)
      .then((result) => {
        // verifyEmail возвращает auth token — по нему задаём пароль
        const tok = result && "token" in result && typeof result.token === "string" ? result.token : null;
        setAuthToken(tok);
        setStatus("set-password");
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Ссылка недействительна или истекла");
      });
  }, [token, verifyEmail]);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");
    if (password.length < 6) { setPwError("Минимум 6 символов"); return; }
    if (password !== passwordConfirm) { setPwError("Пароли не совпадают"); return; }
    setBusy(true);
    try {
      if (authToken) {
        await api.clientSetPassword(authToken, { newPassword: password });
      }
      setStatus("done");
      setTimeout(() => navigate("/cabinet/dashboard", { replace: true }), 1800);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Не удалось установить пароль");
    } finally {
      setBusy(false);
    }
  };

  const skipPassword = () => {
    setStatus("done");
    setTimeout(() => navigate("/cabinet/dashboard", { replace: true }), 1200);
  };

  return (
    <div className="min-h-svh flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-3 duration-300">
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Shield className="h-6 w-6" />
          </span>
        </div>
        <Card className="border shadow-lg">
          <CardHeader>
            <div className="flex justify-center mb-2">
              <div className="rounded-lg bg-primary/10 p-3">
                {status === "set-password" ? (
                  <KeyRound className="h-10 w-10 text-primary" />
                ) : status === "done" ? (
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                ) : (
                  <Mail className="h-10 w-10 text-primary" />
                )}
              </div>
            </div>
            <CardTitle className="text-center">
              {status === "loading" && "Подтверждение email"}
              {status === "set-password" && "Придумайте пароль"}
              {status === "done" && "Всё готово!"}
              {status === "error" && "Ошибка подтверждения"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status === "loading" && (
              <p className="flex items-center justify-center gap-2 text-muted-foreground text-center">
                <Loader2 className="h-5 w-5 animate-spin" />
                Проверка ссылки…
              </p>
            )}

            {status === "set-password" && (
              <form onSubmit={handleSetPassword} className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Email подтверждён! Установите пароль для входа в аккаунт.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="pw">Пароль</Label>
                  <div className="relative">
                    <Input
                      id="pw"
                      type={showPw ? "text" : "password"}
                      placeholder="Минимум 6 символов"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw2">Повторите пароль</Label>
                  <Input
                    id="pw2"
                    type={showPw ? "text" : "password"}
                    placeholder="Повторите пароль"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                  />
                </div>
                {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                <Button type="submit" className="w-full" disabled={busy || !password}>
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Сохраняем…</> : "Установить пароль и войти"}
                </Button>
                <Button type="button" variant="ghost" className="w-full text-xs text-muted-foreground" onClick={skipPassword}>
                  Пропустить, войти без пароля
                </Button>
              </form>
            )}

            {status === "done" && (
              <p className="text-green-600 text-center flex items-center justify-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                Регистрация завершена. Перенаправление в кабинет…
              </p>
            )}

            {status === "error" && (
              <div className="space-y-3 text-center">
                <p className="text-destructive">{message}</p>
                <Button variant="outline" size="sm" onClick={() => navigate("/cabinet/register")}>
                  Вернуться к регистрации
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
