import { useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type AdminBroadcastResult } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Megaphone, Send, Users, AlertTriangle } from "lucide-react";

const MESSAGE_MAX_LEN = 3500;

export function BroadcastPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [text, setText] = useState("");
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<AdminBroadcastResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!token) return null;
  const authToken: string = token;

  const trimmedText = text.trim();

  async function handlePreview() {
    if (!trimmedText) {
      setError("Введите текст рассылки");
      return;
    }
    setError(null);
    setResult(null);
    setPreviewing(true);
    try {
      const res = await api.previewAdminBroadcast(authToken, trimmedText);
      setPreviewTotal(res.totalRecipients ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка проверки аудитории");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSend() {
    if (!trimmedText) {
      setError("Введите текст рассылки");
      return;
    }
    setError(null);
    setResult(null);
    setSending(true);
    try {
      let recipients = previewTotal;
      if (recipients == null) {
        const dry = await api.previewAdminBroadcast(authToken, trimmedText);
        recipients = dry.totalRecipients ?? 0;
        setPreviewTotal(recipients);
      }
      if ((recipients ?? 0) <= 0) {
        setError("Нет получателей для рассылки");
        return;
      }
      const ok = window.confirm(`Отправить сообщение ${recipients} пользователям?`);
      if (!ok) return;

      const res = await api.sendAdminBroadcast(authToken, trimmedText);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка отправки рассылки");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Массовая рассылка</h1>
        <p className="text-muted-foreground mt-1">
          Отправка сообщения всем клиентам с Telegram ID.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Текст рассылки
          </CardTitle>
          <CardDescription>
            Сообщение уйдёт всем незаблокированным клиентам, у которых есть Telegram ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="broadcast-text">Сообщение</Label>
            <textarea
              id="broadcast-text"
              className="w-full min-h-[180px] rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              maxLength={MESSAGE_MAX_LEN}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPreviewTotal(null);
                setResult(null);
              }}
              placeholder="Введите текст для массовой рассылки..."
            />
            <div className="text-xs text-muted-foreground text-right">
              {text.length}/{MESSAGE_MAX_LEN}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handlePreview} disabled={previewing || sending}>
              {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
              Проверить аудиторию
            </Button>
            <Button onClick={handleSend} disabled={previewing || sending || !trimmedText}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Отправить рассылку
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Результат</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>Получатели (dry-run): {previewTotal ?? "—"}</div>
          <div>Отправлено: {result?.sent ?? "—"}</div>
          <div>Ошибок: {result?.failed ?? "—"}</div>
          {result?.errorSamples && result.errorSamples.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium">Примеры ошибок:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                {result.errorSamples.slice(0, 15).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
