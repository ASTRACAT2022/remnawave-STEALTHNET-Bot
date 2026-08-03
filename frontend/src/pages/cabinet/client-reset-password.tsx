import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, KeyRound, Loader2, CheckCircle2, Shield } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import "../astracat-auth.css";

export function ClientResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState<"form" | "success" | "error">("form");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError(t("cabinet.login.reset_password_min"));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("cabinet.login.reset_password_mismatch"));
      return;
    }
    if (!token) {
      setError(t("cabinet.login.reset_password_invalid"));
      setStatus("error");
      return;
    }
    setBusy(true);
    try {
      await api.clientResetPassword(token, password);
      setStatus("success");
      setTimeout(() => navigate("/cabinet/login", { replace: true }), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cabinet.login.reset_password_error"));
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="astracat-auth ac-auth--login min-h-svh flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="ac-auth-orb ac-auth-orb--one absolute -top-40 -left-40 w-96 h-96 rounded-full pointer-events-none" />
      <div className="ac-auth-orb ac-auth-orb--two absolute -bottom-40 -right-40 w-96 h-96 rounded-full pointer-events-none" />
      <div className="ac-auth-shell w-full max-w-md animate-in fade-in slide-in-from-bottom-3 duration-300">
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Shield className="h-6 w-6" />
          </span>
        </div>
        <div className="ac-auth-card relative rounded-[2.5rem] border overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="ac-auth-card__body p-8 sm:p-10 relative z-10">
            <div className="ac-auth-card__intro space-y-1 text-center mb-8">
              <div className="flex justify-center mb-2">
                <div className="ac-auth-card__icon flex h-20 w-20 items-center justify-center rounded-3xl mb-2">
                  {status === "success" ? (
                    <CheckCircle2 className="h-10 w-10 text-green-500" />
                  ) : (
                    <KeyRound className="h-10 w-10 text-primary" />
                  )}
                </div>
              </div>
              <h2 className="ac-auth-title text-3xl font-extrabold tracking-tight mb-2">
                {status === "success" ? t("cabinet.login.forgot_password_title") : t("cabinet.login.reset_password_title")}
              </h2>
              {status !== "success" && (
                <p className="text-muted-foreground text-sm">{t("cabinet.login.reset_password_subtitle")}</p>
              )}
            </div>

            {status === "form" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="pw">{t("cabinet.login.reset_password_new")}</Label>
                  <div className="relative">
                    <Input
                      id="pw"
                      type={showPw ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="ac-auth-input h-12 rounded-xl transition-all pr-10"
                      autoFocus
                      autoComplete="new-password"
                      data-form-type="other"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPw ? "Hide" : "Show"}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw2">{t("cabinet.login.reset_password_confirm")}</Label>
                  <Input
                    id="pw2"
                    type={showPw ? "text" : "password"}
                    placeholder="••••••••"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className="ac-auth-input h-12 rounded-xl transition-all"
                    autoComplete="new-password"
                    data-form-type="other"
                  />
                </div>
                {error && <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">{error}</div>}
                <Button type="submit" className="ac-auth-submit w-full h-14 rounded-2xl text-base font-bold transition-all gap-2" disabled={busy || !password || !passwordConfirm}>
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("cabinet.login.reset_password_saving")}
                    </>
                  ) : (
                    t("cabinet.login.reset_password_submit")
                  )}
                </Button>
              </form>
            )}

            {status === "success" && (
              <p className="text-green-600 text-center flex items-center justify-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                {t("cabinet.login.reset_password_success")}
              </p>
            )}

            {status === "error" && (
              <div className="space-y-3 text-center">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => navigate("/cabinet/login", { replace: true })}>
                  {t("cabinet.login.forgot_password_back")}
                </Button>
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground mt-6">
              <Link to="/cabinet/login" className="text-primary hover:underline">
                {t("cabinet.login.forgot_password_back")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
