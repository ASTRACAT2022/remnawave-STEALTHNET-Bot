import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type AutoRenewNotificationRecord, type AutoRenewStats, type AutoRenewTriggerType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

const TRIGGER_LABELS: Record<AutoRenewTriggerType, string> = {
  UPCOMING: "До списания",
  SUCCESS: "Успешно",
  FAILED: "Ошибка",
  RETRY: "Повтор",
  EXPIRED: "Отключено",
};

type Draft = {
  name: string;
  triggerType: AutoRenewTriggerType;
  offsetMinutes: number;
  messageText: string;
  enabled: boolean;
  sortOrder: number;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  triggerType: "UPCOMING",
  offsetMinutes: 1440,
  messageText: "Скоро автопродление тарифа {tariffName}. Сумма: {amount} {currency}.",
  enabled: true,
  sortOrder: 0,
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

export function AutoRenewPage() {
  const token = useAuth().state.accessToken;
  const [stats, setStats] = useState<AutoRenewStats | null>(null);
  const [items, setItems] = useState<AutoRenewNotificationRecord[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const editingItem = useMemo(() => items.find((item) => item.id === editingId) ?? null, [editingId, items]);

  async function load() {
    if (!token) return;
    setLoading(true);
    setMessage(null);
    try {
      const [nextStats, templates] = await Promise.all([
        api.getAutoRenewStats(token),
        api.getAutoRenewNotifications(token),
      ]);
      setStats(nextStats);
      setItems(templates.items);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Не удалось загрузить автосписание");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  function edit(item: AutoRenewNotificationRecord) {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      triggerType: item.triggerType,
      offsetMinutes: item.offsetMinutes,
      messageText: item.messageText,
      enabled: item.enabled,
      sortOrder: item.sortOrder,
    });
  }

  function resetForm() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function save() {
    if (!token || !draft.name.trim() || !draft.messageText.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      if (editingId) {
        await api.updateAutoRenewNotification(token, editingId, draft);
      } else {
        await api.createAutoRenewNotification(token, draft);
      }
      resetForm();
      await load();
      setMessage("Шаблон сохранён");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Не удалось сохранить шаблон");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!token || !confirm("Удалить шаблон уведомления?")) return;
    setMessage(null);
    try {
      await api.deleteAutoRenewNotification(token, id);
      if (editingId === id) resetForm();
      await load();
      setMessage("Шаблон удалён");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Не удалось удалить шаблон");
    }
  }

  const statCards = [
    ["Включено", stats?.enabled ?? 0],
    ["Выключено", stats?.disabled ?? 0],
    ["Повторы", stats?.retriesInProgress ?? 0],
    ["За 7 дней", stats?.renewalsLast7Days ?? 0],
    ["За 30 дней", stats?.renewalsLast30Days ?? 0],
    ["Сумма за 30 дней", `${formatMoney(stats?.amountLast30Days ?? 0)}`],
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-normal">Автосписание</h1>
          <p className="mt-1 text-sm text-muted-foreground">Статистика продлений и шаблоны Telegram-уведомлений.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Обновить
        </Button>
      </div>

      {message && (
        <div className="rounded-md border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          {message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {statCards.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bell className="h-5 w-5" />
              Шаблоны уведомлений
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex min-h-[180px] items-center justify-center text-sm text-muted-foreground">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Загрузка
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Шаблонов пока нет.
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-md border bg-background/60 p-4 lg:flex-row lg:items-start lg:justify-between">
                  <button className="min-w-0 text-left" onClick={() => edit(item)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{item.name}</span>
                      <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{TRIGGER_LABELS[item.triggerType]}</span>
                      {!item.enabled && <span className="rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-500">выкл</span>}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.messageText}</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => edit(item)}>
                      <Save />
                      Изменить
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(item.id)} aria-label="Удалить шаблон">
                      <Trash2 className="text-red-500" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {editingItem ? <Save className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              {editingItem ? "Редактирование" : "Новый шаблон"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Название" />
            <div className="grid grid-cols-2 gap-3">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={draft.triggerType}
                onChange={(e) => setDraft((d) => ({ ...d, triggerType: e.target.value as AutoRenewTriggerType }))}
              >
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <Input
                type="number"
                min={0}
                value={draft.offsetMinutes}
                onChange={(e) => setDraft((d) => ({ ...d, offsetMinutes: Number(e.target.value) || 0 }))}
                placeholder="Минут до события"
              />
            </div>
            <Textarea
              className="min-h-[150px]"
              value={draft.messageText}
              onChange={(e) => setDraft((d) => ({ ...d, messageText: e.target.value }))}
              placeholder="Текст уведомления"
            />
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                Активен
                <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft((d) => ({ ...d, enabled }))} />
              </label>
              <Input
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft((d) => ({ ...d, sortOrder: Number(e.target.value) || 0 }))}
                placeholder="Порядок"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={save} disabled={saving || !draft.name.trim() || !draft.messageText.trim()}>
                {saving ? <RefreshCw className="animate-spin" /> : <Check />}
                Сохранить
              </Button>
              {editingId && (
                <Button variant="outline" onClick={resetForm}>
                  Отмена
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
