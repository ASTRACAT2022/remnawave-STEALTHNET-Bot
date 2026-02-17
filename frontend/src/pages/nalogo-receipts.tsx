import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type NalogoReceiptItem, type NalogoReceiptStatus } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, RefreshCcw, Search } from "lucide-react";

const PAGE_LIMIT = 50;

const STATUS_LABELS: Record<NalogoReceiptStatus, string> = {
  sent: "Отправлен",
  in_progress: "В обработке",
  retry_wait: "Ожидает повтора",
  failed: "Ошибка",
  pending: "Не отправлен",
};

function statusClass(status: NalogoReceiptStatus): string {
  if (status === "sent") return "bg-green-500/15 text-green-600";
  if (status === "in_progress") return "bg-blue-500/15 text-blue-600";
  if (status === "retry_wait") return "bg-amber-500/15 text-amber-700";
  if (status === "failed") return "bg-red-500/15 text-red-600";
  return "bg-muted text-muted-foreground";
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("ru-RU");
}

function fmtMoney(amount: number, currency: string): string {
  return `${amount} ${currency.toUpperCase()}`;
}

function clientLabel(item: NalogoReceiptItem): string {
  if (item.clientTelegramUsername) return `@${item.clientTelegramUsername}`;
  if (item.clientTelegramId) return `TG:${item.clientTelegramId}`;
  if (item.clientEmail) return item.clientEmail;
  return "—";
}

export function NalogoReceiptsPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [items, setItems] = useState<NalogoReceiptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getNalogoReceipts(token, { page, limit: PAGE_LIMIT, search })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Ошибка загрузки чеков");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, search]);

  if (!token) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const pageStats = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc[item.status] += 1;
        return acc;
      },
      { sent: 0, in_progress: 0, retry_wait: 0, failed: 0, pending: 0 } as Record<NalogoReceiptStatus, number>,
    );
  }, [items]);

  async function retryReceipt(paymentId: string) {
    const authToken = token;
    if (!authToken) return;
    setRetryingId(paymentId);
    setError(null);
    setMessage(null);
    try {
      const res = await api.retryNalogoReceipt(authToken, paymentId);
      if (res.status === "created" || res.status === "already_created") {
        setMessage("Чек успешно отправлен в Налоговую.");
      } else if (res.status === "not_configured") {
        setError("NaloGO не настроен в разделе Настройки.");
      } else {
        setMessage(`Состояние после повтора: ${res.status}`);
      }
      const refreshed = await api.getNalogoReceipts(authToken, { page, limit: PAGE_LIMIT, search });
      setItems(refreshed.items);
      setTotal(refreshed.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка повторной отправки");
    } finally {
      setRetryingId(null);
    }
  }

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Чеки в Налоговую</h1>
        <p className="text-muted-foreground mt-1">Статусы отправки чеков NaloGO по платежам YooKassa.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          {message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Фильтр</CardTitle>
          <CardDescription>Поиск по заказу, внешнему ID, email, telegram id или username</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSearchSubmit} className="flex gap-2">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Поиск..."
            />
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4 mr-2" />
              Найти
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(["sent", "in_progress", "retry_wait", "failed", "pending"] as NalogoReceiptStatus[]).map((status) => (
          <Card key={status}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{STATUS_LABELS[status]}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pageStats[status]}</div>
              <div className="text-xs text-muted-foreground">на текущей странице</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Список чеков</CardTitle>
          <CardDescription>
            Всего платежей: {total}. Страница {page} из {totalPages}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Загрузка...
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-sm text-muted-foreground">Платежи не найдены.</div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-3 text-left font-medium">Заказ</th>
                    <th className="h-10 px-3 text-left font-medium">Клиент</th>
                    <th className="h-10 px-3 text-left font-medium">Сумма</th>
                    <th className="h-10 px-3 text-left font-medium">Статус</th>
                    <th className="h-10 px-3 text-left font-medium">UUID чека</th>
                    <th className="h-10 px-3 text-left font-medium">Попытки</th>
                    <th className="h-10 px-3 text-left font-medium">Последняя попытка</th>
                    <th className="h-10 px-3 text-left font-medium">След. повтор</th>
                    <th className="h-10 px-3 text-left font-medium">Ошибка</th>
                    <th className="h-10 px-3 text-right font-medium">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.paymentId} className="border-b last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{item.orderId}</div>
                        <div className="text-xs text-muted-foreground">{fmtDate(item.paidAt ?? item.createdAt)}</div>
                      </td>
                      <td className="px-3 py-2">{clientLabel(item)}</td>
                      <td className="px-3 py-2">{fmtMoney(item.amount, item.currency)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(item.status)}`}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 break-all">{item.receiptUuid ?? "—"}</td>
                      <td className="px-3 py-2">{item.attempts}</td>
                      <td className="px-3 py-2">{fmtDate(item.lastAttemptAt)}</td>
                      <td className="px-3 py-2">{fmtDate(item.nextRetryAt)}</td>
                      <td className="px-3 py-2 text-xs max-w-[280px] whitespace-pre-wrap break-words">{item.lastError ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {item.status !== "sent" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={retryingId === item.paymentId}
                            onClick={() => retryReceipt(item.paymentId)}
                          >
                            {retryingId === item.paymentId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCcw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              Назад
            </Button>
            <Button variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Вперёд
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
