import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type {
  PromoCodeRecord,
  PromoCodeDetail,
  CreatePromoCodePayload,
  UpdatePromoCodePayload,
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
  Eye,
  ChevronLeft,
  ToggleLeft,
  ToggleRight,
  Tag,
  Gift,
  Percent,
} from "lucide-react";

interface Squad {
  uuid: string;
  name?: string;
}

function formatTraffic(bytes: string | number | null): string {
  if (!bytes) return "Без лимита";
  const b = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (!b || b <= 0) return "Без лимита";
  const gb = b / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb % 1 === 0 ? 0 : 1)} ГБ`;
  const mb = b / (1024 * 1024);
  return `${mb.toFixed(0)} МБ`;
}

export function PromoCodesPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [codes, setCodes] = useState<PromoCodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [squads, setSquads] = useState<Squad[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreatePromoCodePayload>({
    code: "",
    name: "",
    type: "DISCOUNT",
    discountPercent: null,
    discountFixed: null,
    squadUuid: null,
    trafficLimitBytes: "0",
    deviceLimit: null,
    durationDays: null,
    maxUses: 0,
    maxUsesPerClient: 1,
    isActive: true,
    expiresAt: null,
  });

  const [detail, setDetail] = useState<PromoCodeDetail | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [codesRes, squadsRes] = await Promise.all([
        api.getPromoCodes(token),
        api.getRemnaSquadsInternal(token).catch(() => ({ response: { internalSquads: [] } })),
      ]);
      setCodes(codesRes);
      const res = squadsRes as { response?: { internalSquads?: { uuid?: string; name?: string }[] } };
      const list = res?.response?.internalSquads ?? (Array.isArray(res?.response) ? res.response : []);
      setSquads(Array.isArray(list) ? list.map((s: { uuid?: string; name?: string }) => ({ uuid: s.uuid ?? "", name: s.name })) : []);
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
      code: "",
      name: "",
      type: "DISCOUNT",
      discountPercent: null,
      discountFixed: null,
      squadUuid: squads[0]?.uuid ?? null,
      trafficLimitBytes: "0",
      deviceLimit: null,
      durationDays: 30,
      maxUses: 0,
      maxUsesPerClient: 1,
      isActive: true,
      expiresAt: null,
    });
    setShowForm(true);
  };

  const openEdit = (c: PromoCodeRecord) => {
    setEditingId(c.id);
    setForm({
      code: c.code,
      name: c.name,
      type: c.type,
      discountPercent: c.discountPercent,
      discountFixed: c.discountFixed,
      squadUuid: c.squadUuid,
      trafficLimitBytes: c.trafficLimitBytes,
      deviceLimit: c.deviceLimit,
      durationDays: c.durationDays,
      maxUses: c.maxUses,
      maxUsesPerClient: c.maxUsesPerClient,
      isActive: c.isActive,
      expiresAt: c.expiresAt,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        const { code: _code, ...rest } = form;
        await api.updatePromoCode(token, editingId, rest as UpdatePromoCodePayload);
      } else {
        await api.createPromoCode(token, form);
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
    if (!confirm("Удалить промокод? Все данные об использованиях будут удалены.")) return;
    try {
      await api.deletePromoCode(token, id);
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleToggleActive = async (c: PromoCodeRecord) => {
    try {
      await api.updatePromoCode(token, c.id, { isActive: !c.isActive });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const openDetail = async (id: string) => {
    try {
      const d = await api.getPromoCode(token, id);
      setDetail(d);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getSquadName = (uuid: string | null) => {
    if (!uuid) return "—";
    const s = squads.find((sq) => sq.uuid === uuid);
    return s?.name || uuid.slice(0, 8) + "…";
  };

  const typeLabel = (type: string) => type === "DISCOUNT" ? "Скидка" : "Бесплатные дни";
  const typeBadgeClass = (type: string) => type === "DISCOUNT" ? "bg-blue-500/15 text-blue-600" : "bg-purple-500/15 text-purple-600";

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
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeClass(detail.type)}`}>
            {typeLabel(detail.type)}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${detail.isActive ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-600"}`}>
            {detail.isActive ? "Активен" : "Неактивен"}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Код</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono font-bold">{detail.code}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyCode(detail.code)}>
                  {copiedCode === detail.code ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Использования</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {detail.usagesCount}
                {detail.maxUses > 0 && <span className="text-base text-muted-foreground font-normal"> / {detail.maxUses}</span>}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Параметры</CardTitle></CardHeader>
            <CardContent>
              {detail.type === "DISCOUNT" ? (
                <p className="text-sm">
                  {detail.discountPercent ? `${detail.discountPercent}%` : ""}
                  {detail.discountPercent && detail.discountFixed ? " + " : ""}
                  {detail.discountFixed ? `${detail.discountFixed} фикс.` : ""}
                </p>
              ) : (
                <p className="text-sm">{detail.durationDays} дн. • {formatTraffic(detail.trafficLimitBytes)} • {detail.deviceLimit ?? "∞"} устр.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Истекает</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm">{detail.expiresAt ? new Date(detail.expiresAt).toLocaleDateString("ru-RU") : "Бессрочно"}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Использования ({detail.usages.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.usages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Промокод ещё не использовался.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 px-2 font-medium">Клиент</th>
                      <th className="py-2 px-2 font-medium">Telegram</th>
                      <th className="py-2 px-2 font-medium">Remna UUID</th>
                      <th className="py-2 px-2 font-medium">Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.usages.map((u) => (
                      <tr key={u.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 px-2">{u.client.email || u.client.id.slice(0, 8)}</td>
                        <td className="py-2 px-2">{u.client.telegramUsername ? `@${u.client.telegramUsername}` : u.client.telegramId || "—"}</td>
                        <td className="py-2 px-2 font-mono text-xs">{u.client.remnawaveUuid?.slice(0, 12) || "—"}</td>
                        <td className="py-2 px-2">{new Date(u.createdAt).toLocaleString("ru-RU")}</td>
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
          <h1 className="text-2xl font-bold tracking-tight">Промокоды</h1>
          <p className="text-muted-foreground text-sm mt-1">Промокоды на скидку при оплате или бесплатные дни подписки.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Создать
        </Button>
      </div>

      {codes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Tag className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">Нет промокодов</h3>
            <p className="text-sm text-muted-foreground mt-1">Создайте первый промокод.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {codes.map((c) => (
            <Card key={c.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base">{c.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeClass(c.type)}`}>
                        {typeLabel(c.type)}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.isActive ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-600"}`}>
                        {c.isActive ? "Активен" : "Неактивен"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <code className="font-mono font-medium text-foreground">{c.code}</code>
                      <span>•</span>
                      {c.type === "DISCOUNT" ? (
                        <span>
                          {c.discountPercent ? <><Percent className="h-3 w-3 inline" /> {c.discountPercent}%</> : null}
                          {c.discountFixed ? ` ${c.discountFixed} фикс.` : ""}
                        </span>
                      ) : (
                        <span>
                          <Gift className="h-3 w-3 inline" /> {c.durationDays} дн. • {formatTraffic(c.trafficLimitBytes)} • {c.deviceLimit ?? "∞"} устр. • {getSquadName(c.squadUuid)}
                        </span>
                      )}
                      {c.expiresAt && (
                        <>
                          <span>•</span>
                          <span>до {new Date(c.expiresAt).toLocaleDateString("ru-RU")}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{c.usagesCount}</span>
                      {c.maxUses > 0 && <span className="text-muted-foreground">/ {c.maxUses}</span>}
                      <span className="text-muted-foreground">использований</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Копировать код" onClick={() => copyCode(c.code)}>
                      {copiedCode === c.code ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Подробнее" onClick={() => openDetail(c.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title={c.isActive ? "Деактивировать" : "Активировать"} onClick={() => handleToggleActive(c)}>
                      {c.isActive ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Редактировать" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Удалить" onClick={() => handleDelete(c.id)}>
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
          <Card className="w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-lg">{editingId ? "Редактировать" : "Создать"} промокод</CardTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowForm(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {!editingId && (
                <div>
                  <Label>Код промокода</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") }))}
                    placeholder="SUMMER2026"
                    className="font-mono"
                  />
                </div>
              )}
              <div>
                <Label>Название / описание</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Летняя акция -20%"
                />
              </div>
              <div>
                <Label>Тип</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "DISCOUNT" | "FREE_DAYS" }))}
                >
                  <option value="DISCOUNT">Скидка</option>
                  <option value="FREE_DAYS">Бесплатные дни</option>
                </select>
              </div>

              {form.type === "DISCOUNT" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Скидка %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={form.discountPercent ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value === "" ? null : Number(e.target.value) }))}
                      placeholder="20"
                    />
                  </div>
                  <div>
                    <Label>Фикс. скидка (валюта)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.discountFixed ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, discountFixed: e.target.value === "" ? null : Number(e.target.value) }))}
                      placeholder="100"
                    />
                  </div>
                </div>
              )}

              {form.type === "FREE_DAYS" && (
                <>
                  <div>
                    <Label>Сквад</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={form.squadUuid ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, squadUuid: e.target.value || null }))}
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
                        value={form.durationDays ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value === "" ? null : Number(e.target.value) || 1 }))}
                      />
                    </div>
                    <div>
                      <Label>Трафик (ГБ, 0 = без лимита)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={Number(form.trafficLimitBytes ?? 0) / (1024 * 1024 * 1024) || 0}
                        onChange={(e) => setForm((f) => ({ ...f, trafficLimitBytes: String(Math.round((Number(e.target.value) || 0) * 1024 * 1024 * 1024)) }))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Лимит устройств (пусто = без лимита)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.deviceLimit ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, deviceLimit: e.target.value === "" ? null : Number(e.target.value) || 0 }))}
                    />
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Макс. использований (0 = ∞)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.maxUses}
                    onChange={(e) => setForm((f) => ({ ...f, maxUses: Number(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <Label>Макс. на клиента</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.maxUsesPerClient}
                    onChange={(e) => setForm((f) => ({ ...f, maxUsesPerClient: Number(e.target.value) || 1 }))}
                  />
                </div>
              </div>

              <div>
                <Label>Истекает (пусто = бессрочно)</Label>
                <Input
                  type="date"
                  value={form.expiresAt ? form.expiresAt.split("T")[0] : ""}
                  onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isActive ?? true}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="rounded"
                  id="code-active"
                />
                <Label htmlFor="code-active">Активен</Label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowForm(false)}>Отмена</Button>
                <Button onClick={handleSave} disabled={saving || !form.name.trim() || (!editingId && !form.code.trim())}>
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
