import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type {
  PromoGroup,
  PromoGroupDetail,
  CreatePromoGroupPayload,
  UpdatePromoGroupPayload,
  AdminSettings,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  Copy,
  Check,
  Users,
  Link2,
  Eye,
  ChevronLeft,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface Squad {
  uuid: string;
  name?: string;
}

function formatTraffic(bytes: string | number): string {
  const b = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (!b || b <= 0) return "Без лимита";
  const gb = b / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb % 1 === 0 ? 0 : 1)} ГБ`;
  const mb = b / (1024 * 1024);
  return `${mb.toFixed(0)} МБ`;
}

export function PromoPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [groups, setGroups] = useState<PromoGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Squads
  const [squads, setSquads] = useState<Squad[]>([]);

  // Create/Edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreatePromoGroupPayload>({
    name: "",
    squadUuid: "",
    trafficLimitBytes: "0",
    deviceLimit: null,
    durationDays: 30,
    maxActivations: 0,
    isActive: true,
  });

  // Detail view
  const [detail, setDetail] = useState<PromoGroupDetail | null>(null);
  const [, setDetailLoading] = useState(false);

  // Bot username for link
  const [botUsername, setBotUsername] = useState<string>("");

  // Copied state
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupsRes, squadsRes, settings] = await Promise.all([
        api.getPromoGroups(token),
        api.getRemnaSquadsInternal(token).catch(() => ({ response: { internalSquads: [] } })),
        api.getSettings(token).catch(() => null),
      ]);
      setGroups(groupsRes);
      const res = squadsRes as { response?: { internalSquads?: { uuid?: string; name?: string }[] } };
      const list = res?.response?.internalSquads ?? (Array.isArray(res?.response) ? res.response : []);
      setSquads(Array.isArray(list) ? list.map((s: { uuid?: string; name?: string }) => ({ uuid: s.uuid ?? "", name: s.name })) : []);
      setBotUsername((settings as AdminSettings)?.telegramBotUsername?.replace(/^@/, "") ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      name: "",
      squadUuid: squads[0]?.uuid ?? "",
      trafficLimitBytes: "0",
      deviceLimit: null,
      durationDays: 30,
      maxActivations: 0,
      isActive: true,
    });
    setShowForm(true);
  };

  const openEdit = (g: PromoGroup) => {
    setEditingId(g.id);
    setForm({
      name: g.name,
      squadUuid: g.squadUuid,
      trafficLimitBytes: g.trafficLimitBytes,
      deviceLimit: g.deviceLimit,
      durationDays: g.durationDays,
      maxActivations: g.maxActivations,
      isActive: g.isActive,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await api.updatePromoGroup(token, editingId, form as UpdatePromoGroupPayload);
      } else {
        await api.createPromoGroup(token, form);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить промо-группу? Все активации будут удалены.")) return;
    try {
      await api.deletePromoGroup(token, id);
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleToggleActive = async (g: PromoGroup) => {
    try {
      await api.updatePromoGroup(token, g.id, { isActive: !g.isActive });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await api.getPromoGroup(token, id);
      setDetail(d);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setDetailLoading(false);
    }
  };

  const getPromoLink = (code: string) => {
    if (!botUsername) return `t.me/YOUR_BOT?start=promo_${code}`;
    return `https://t.me/${botUsername}?start=promo_${code}`;
  };

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(getPromoLink(code));
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getSquadName = (uuid: string) => {
    const s = squads.find((sq) => sq.uuid === uuid);
    return s?.name || uuid.slice(0, 8) + "…";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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

  // Detail view
  if (detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Назад
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{detail.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${detail.isActive ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-600"}`}>
            {detail.isActive ? "Активна" : "Неактивна"}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Код</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono font-bold">{detail.code}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyLink(detail.code)}>
                  {copiedCode === detail.code ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Активации</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {detail.activationsCount}
                {detail.maxActivations > 0 && <span className="text-base text-muted-foreground font-normal"> / {detail.maxActivations}</span>}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Подписка</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm">{detail.durationDays} дн. • {formatTraffic(detail.trafficLimitBytes)} • {detail.deviceLimit ?? "∞"} устр.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Сквад</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm font-medium">{getSquadName(detail.squadUuid)}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Ссылка для бота
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="text-sm bg-muted px-3 py-1.5 rounded-md flex-1 select-all break-all">{getPromoLink(detail.code)}</code>
              <Button variant="outline" size="sm" onClick={() => copyLink(detail.code)}>
                {copiedCode === detail.code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Активации ({detail.activations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.activations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ещё никто не активировал этот промокод.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 px-2 font-medium">Клиент</th>
                      <th className="py-2 px-2 font-medium">Telegram</th>
                      <th className="py-2 px-2 font-medium">Remna UUID</th>
                      <th className="py-2 px-2 font-medium">Дата активации</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.activations.map((a) => (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 px-2">{a.client.email || a.client.id.slice(0, 8)}</td>
                        <td className="py-2 px-2">{a.client.telegramUsername ? `@${a.client.telegramUsername}` : a.client.telegramId || "—"}</td>
                        <td className="py-2 px-2 font-mono text-xs">{a.client.remnawaveUuid?.slice(0, 12) || "—"}</td>
                        <td className="py-2 px-2">{new Date(a.createdAt).toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Промо-ссылки</h1>
          <p className="text-muted-foreground text-sm mt-1">Создавайте промо-ссылки для раздачи бесплатных подписок через бота.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Создать
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Link2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">Нет промо-групп</h3>
            <p className="text-sm text-muted-foreground mt-1">Создайте первую промо-ссылку для раздачи подписок.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => (
            <Card key={g.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base">{g.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${g.isActive ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-600"}`}>
                        {g.isActive ? "Активна" : "Неактивна"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <span className="font-mono">{g.code}</span>
                      <span>•</span>
                      <span>{g.durationDays} дн.</span>
                      <span>•</span>
                      <span>{formatTraffic(g.trafficLimitBytes)}</span>
                      <span>•</span>
                      <span>{g.deviceLimit ?? "∞"} устр.</span>
                      <span>•</span>
                      <span>{getSquadName(g.squadUuid)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{g.activationsCount}</span>
                      {g.maxActivations > 0 && <span className="text-muted-foreground">/ {g.maxActivations}</span>}
                      <span className="text-muted-foreground">активаций</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Копировать ссылку" onClick={() => copyLink(g.code)}>
                      {copiedCode === g.code ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Подробнее" onClick={() => openDetail(g.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title={g.isActive ? "Деактивировать" : "Активировать"} onClick={() => handleToggleActive(g)}>
                      {g.isActive ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Редактировать" onClick={() => openEdit(g)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Удалить" onClick={() => handleDelete(g.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-lg mx-4 shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-lg">{editingId ? "Редактировать" : "Создать"} промо-группу</CardTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowForm(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Название</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Промо для блогера X"
                />
              </div>
              <div>
                <Label>Сквад</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={form.squadUuid}
                  onChange={(e) => setForm((f) => ({ ...f, squadUuid: e.target.value }))}
                >
                  <option value="">Выберите сквад</option>
                  {squads.map((s) => (
                    <option key={s.uuid} value={s.uuid}>{s.name || s.uuid}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Дней подписки</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.durationDays}
                    onChange={(e) => setForm((f) => ({ ...f, durationDays: Number(e.target.value) || 1 }))}
                  />
                </div>
                <div>
                  <Label>Макс. активаций (0 = ∞)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.maxActivations}
                    onChange={(e) => setForm((f) => ({ ...f, maxActivations: Number(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Трафик (ГБ, 0 = без лимита)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={Number(form.trafficLimitBytes) / (1024 * 1024 * 1024) || 0}
                    onChange={(e) => setForm((f) => ({ ...f, trafficLimitBytes: String(Math.round((Number(e.target.value) || 0) * 1024 * 1024 * 1024)) }))}
                  />
                </div>
                <div>
                  <Label>Лимит устройств (пусто = ∞)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.deviceLimit ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, deviceLimit: e.target.value === "" ? null : Number(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isActive ?? true}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="rounded"
                  id="promo-active"
                />
                <Label htmlFor="promo-active">Активна</Label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowForm(false)}>Отмена</Button>
                <Button onClick={handleSave} disabled={saving || !form.name.trim() || !form.squadUuid}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {editingId ? "Сохранить" : "Создать"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
