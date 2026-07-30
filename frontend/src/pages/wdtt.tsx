import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type WdttNodeListItem, type CreateWdttNodeResponse, type WdttSlotAdminItem, type WdttCategoryItem, type WdttTariffItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Plus, Loader2, Server, Pencil, Trash2, Layers, Ban, KeyRound, Link, Wifi, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function formatBytes(s: string | null): string {
  if (!s) return "—";
  const n = Number(s);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    });
  } catch {
    return iso;
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ONLINE: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
    OFFLINE: "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-white/10",
    DISABLED: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20",
  };
  const dotColor: Record<string, string> = {
    ONLINE: "bg-emerald-400 shadow-[0_0_4px_#10b981]",
    OFFLINE: "bg-muted-foreground/40",
    DISABLED: "bg-amber-400 shadow-[0_0_4px_#fbbf24]",
  };
  const label = status === "ONLINE" ? "Онлайн" : status === "DISABLED" ? "Отключена" : "Офлайн";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md", map[status] ?? map.OFFLINE)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[status] ?? dotColor.OFFLINE)} />
      {label}
    </span>
  );
}

function slotStatusBadge(status: string) {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
    EXPIRED: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20",
    REVOKED: "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20",
  };
  const label = status === "ACTIVE" ? "Активен" : status === "EXPIRED" ? "Истёк" : "Отозван";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", map[status] ?? map.EXPIRED)}>
      {label}
    </span>
  );
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function WdttPage() {
  const { state } = useAuth();
  const token = state.accessToken!;
  const [tab, setTab] = useState("nodes");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OlcRTC</h1>
          <p className="text-sm text-muted-foreground mt-1">Управление нодами OlcRTC, тарифами и подписками</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="nodes"><Server className="h-4 w-4 mr-2" />Ноды</TabsTrigger>
          <TabsTrigger value="categories"><Layers className="h-4 w-4 mr-2" />Категории / Тарифы</TabsTrigger>
          <TabsTrigger value="slots"><KeyRound className="h-4 w-4 mr-2" />Подписки</TabsTrigger>
        </TabsList>

        <TabsContent value="nodes">
          <NodesTab token={token} />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab token={token} />
        </TabsContent>
        <TabsContent value="slots">
          <SlotsTab token={token} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ——— Nodes Tab ———
function NodesTab({ token }: { token: string }) {
  const [nodes, setNodes] = useState<WdttNodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<WdttNodeListItem | null>(null);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<{ id: string; name: string; status: string; slots: Array<{ id: string; password: string; vkHash: string; wdttLink: string; expiresAt: string; status: string; client: { id: string; email: string | null; telegramUsername: string | null } }> } | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const fetchNodes = () => {
    setLoading(true);
    api.getWdttNodes(token).then((r) => setNodes(r.items)).finally(() => setLoading(false));
  };
  useEffect(() => { fetchNodes(); }, [token]);

  const fetchDetail = async (id: string) => {
    setShowDetail(id);
    try {
      const d = await api.getWdttNode(token, id);
      setDetailData(d);
    } catch {
      setDetailData(null);
    }
  };

  const testNode = async (id: string) => {
    setTestResult("testing...");
    try {
      const r = await api.testWdttNode(token, id);
      setTestResult(r.success ? `✅ Нода онлайн (ответ: ${JSON.stringify(r.data)})` : `❌ Ошибка: ${r.error}`);
    } catch (e) {
      setTestResult(`❌ ${e instanceof Error ? e.message : "Unknown"}`);
    }
    setTimeout(() => setTestResult(null), 4000);
  };

  const deleteNode = async (id: string, name: string) => {
    if (!confirm(`Удалить ноду «${name}»? Это действие необратимо.`)) return;
    try {
      await api.deleteWdttNode(token, id);
      fetchNodes();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} size="sm"><Plus className="h-4 w-4 mr-2" />Добавить ноду</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : nodes.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Нет OlcRTC-нод. Добавьте первую ноду.</Card>
      ) : (
        <div className="grid gap-4">
          {nodes.map((n) => (
            <Card key={n.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Server className="h-8 w-8 text-muted-foreground/50" />
                  <div>
                    <div className="font-medium">{n.name || "Без имени"}</div>
                    <div className="text-xs text-muted-foreground">
                      {n.provisionMode === "PER_CLIENT"
                        ? `Персональные контейнеры · ${n.provisionerUrl || "provisioner не задан"}`
                        : `${n.provider} · ${n.transport} · ${n.roomId}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {statusBadge(n.status)}
                  <span className="text-xs text-muted-foreground">{n.currentSlots}/{n.capacity ?? "∞"} слотов</span>
                  <Button variant="ghost" size="sm" onClick={() => fetchDetail(n.id)}><Server className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => testNode(n.id)} title="Тест"><Wifi className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowEdit(n)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteNode(n.id, n.name)} title="Удалить" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {testResult && (
        <Card className="p-3 text-sm">{testResult}</Card>
      )}

      {/* Create Node Dialog */}
      <CreateNodeDialog token={token} open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchNodes(); }} />
      {/* Edit Node Dialog */}
      <EditNodeDialog token={token} node={showEdit} onClose={() => setShowEdit(null)} onSaved={() => { setShowEdit(null); fetchNodes(); }} />
      {/* Node Detail Dialog */}
      <Dialog open={showDetail != null} onOpenChange={() => { setShowDetail(null); setDetailData(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Детали ноды</DialogTitle></DialogHeader>
          {detailData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><Label>Название</Label><div className="font-medium">{detailData.name}</div></div>
                <div><Label>Статус</Label><div>{statusBadge(detailData.status)}</div></div>
              </div>
              <div className="text-sm font-medium">Слоты ({detailData.slots.length})</div>
              <div className="space-y-2">
                {detailData.slots.map((s) => (
                  <Card key={s.id} className="p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="font-mono">{s.password}</span>
                      {slotStatusBadge(s.status)}
                    </div>
                    <div className="text-muted-foreground truncate">{s.wdttLink}</div>
                    <div className="text-muted-foreground">Истекает: {formatDate(s.expiresAt)}</div>
                    <div className="text-muted-foreground">Клиент: {s.client.email || s.client.telegramUsername || s.client.id}</div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateNodeDialog({ token, open, onClose, onCreated }: { token: string; open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"jitsi" | "telemost" | "wbstream">("jitsi");
  const [transport, setTransport] = useState<"datachannel" | "vp8channel" | "seichannel" | "videochannel">("datachannel");
  const [roomId, setRoomId] = useState("");
  const [encryptionKey, setEncryptionKey] = useState("");
  const [payload, setPayload] = useState("");
  const [provisionMode, setProvisionMode] = useState<"STATIC" | "PER_CLIENT">("PER_CLIENT");
  const [provisionerUrl, setProvisionerUrl] = useState("");
  const [provisionerToken, setProvisionerToken] = useState("");
  const [capacity, setCapacity] = useState("");
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreateWdttNodeResponse | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const r = await api.createWdttNode(token, {
        name,
        provider,
        transport,
        roomId,
        encryptionKey,
        payload: payload || null,
        provisionMode,
        provisionerUrl: provisionerUrl || null,
        provisionerToken: provisionerToken || null,
        capacity: capacity ? parseInt(capacity) : null,
      });
      setResult(r);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    }
    setCreating(false);
  };

  if (result) {
    return (
      <Dialog open={open} onOpenChange={() => { onClose(); setResult(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Нода добавлена</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div><Label>Название</Label><div className="font-medium">{result.node.name}</div></div>
            <div><Label>Режим</Label><div className="font-mono text-xs">{result.node.provisionMode === "PER_CLIENT" ? "Персональные контейнеры" : `${result.node.provider} · ${result.node.transport} · ${result.node.roomId}`}</div></div>
            <p className="text-muted-foreground">{result.instructions}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => { onCreated(); setResult(null); }}>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Добавить OlcRTC-ноду</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Название</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Моя нода" /></div>
          <div><Label>Режим выдачи</Label><select value={provisionMode} onChange={(e) => setProvisionMode(e.target.value as typeof provisionMode)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="PER_CLIENT">Персональный сервер для каждой подписки</option><option value="STATIC">Общая статическая ссылка</option></select></div>
          {provisionMode === "PER_CLIENT" ? (
            <>
              <div><Label>URL provisioner</Label><Input value={provisionerUrl} onChange={(e) => setProvisionerUrl(e.target.value)} placeholder="http://10.0.0.10:9500" /></div>
              <div><Label>Токен provisioner</Label><Input type="password" value={provisionerToken} onChange={(e) => setProvisionerToken(e.target.value)} placeholder="OLCRTC_PROVISIONER_TOKEN" /></div>
              <p className="text-xs text-muted-foreground">После оплаты клиент выбирает Telemost/WBStream и вставляет свою ссылку комнаты. Для него создаётся отдельный контейнер, который будет удалён после окончания тарифа.</p>
            </>
          ) : (
            <>
          <div className="grid grid-cols-2 gap-3"><div><Label>Провайдер</Label><select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="jitsi">Jitsi</option><option value="telemost">Telemost</option><option value="wbstream">WBStream</option></select></div><div><Label>Транспорт</Label><select value={transport} onChange={(e) => setTransport(e.target.value as typeof transport)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="datachannel">datachannel</option><option value="vp8channel">vp8channel</option><option value="seichannel">seichannel</option><option value="videochannel">videochannel</option></select></div></div>
          <div><Label>Room ID</Label><Input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="https://meet.example.org/room" /></div>
          <div><Label>Ключ шифрования</Label><Input value={encryptionKey} onChange={(e) => setEncryptionKey(e.target.value)} placeholder="64 символа hex" /></div>
          <div><Label>Параметры транспорта (необязательно)</Label><Input value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="vp8-fps=60&vp8-batch=64" /></div>
          <p className="text-xs text-muted-foreground">После оплаты BillingStyle создаёт и выдаёт ссылку <code>olcrtc://…</code> с этими параметрами.</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">Одинаковые Room ID и ключ получает каждый покупатель этой ноды. Отзыв подписки в BillingStyle не отключает уже импортированную ссылку на сервере.</p>
            </>
          )}
          <div><Label>Вместимость (пусто = без лимита)</Label><Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="100" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleCreate} disabled={creating || !name || (provisionMode === "PER_CLIENT" ? (!provisionerUrl || provisionerToken.length < 32) : (!roomId || !/^[a-f0-9]{64}$/i.test(encryptionKey)))}>
            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditNodeDialog({ token, node, onClose, onSaved }: { token: string; node: WdttNodeListItem | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("ONLINE");
  const [provider, setProvider] = useState<"jitsi" | "telemost" | "wbstream">("jitsi");
  const [transport, setTransport] = useState<"datachannel" | "vp8channel" | "seichannel" | "videochannel">("datachannel");
  const [roomId, setRoomId] = useState("");
  const [encryptionKey, setEncryptionKey] = useState("");
  const [payload, setPayload] = useState("");
  const [provisionMode, setProvisionMode] = useState<"STATIC" | "PER_CLIENT">("STATIC");
  const [provisionerUrl, setProvisionerUrl] = useState("");
  const [provisionerToken, setProvisionerToken] = useState("");
  const [capacity, setCapacity] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (node) {
      setName(node.name);
      setStatus(node.status);
      setProvider(node.provider);
      setTransport(node.transport);
      setRoomId(node.roomId);
      setEncryptionKey(node.encryptionKey);
      setPayload(node.payload ?? "");
      setProvisionMode(node.provisionMode);
      setProvisionerUrl(node.provisionerUrl ?? "");
      setProvisionerToken(node.provisionerToken ?? "");
      setCapacity(node.capacity != null ? String(node.capacity) : "");
    }
  }, [node]);

  const handleSave = async () => {
    if (!node) return;
    setSaving(true);
    try {
      await api.updateWdttNode(token, node.id, {
        name,
        status,
        provider,
        transport,
        roomId,
        encryptionKey,
        payload: payload.trim() || null,
        provisionMode,
        provisionerUrl: provisionMode === "PER_CLIENT" ? provisionerUrl || null : null,
        provisionerToken: provisionMode === "PER_CLIENT" ? provisionerToken || null : null,
        capacity: capacity ? parseInt(capacity) : null,
      });
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    }
    setSaving(false);
  };

  return (
    <Dialog open={node != null} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Редактировать ноду</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Название</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Режим выдачи</Label><select value={provisionMode} onChange={(e) => setProvisionMode(e.target.value as typeof provisionMode)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="PER_CLIENT">Персональный сервер для каждой подписки</option><option value="STATIC">Общая статическая ссылка</option></select></div>
          {provisionMode === "PER_CLIENT" ? (
            <>
              <div><Label>URL provisioner</Label><Input value={provisionerUrl} onChange={(e) => setProvisionerUrl(e.target.value)} /></div>
              <div><Label>Токен provisioner</Label><Input type="password" value={provisionerToken} onChange={(e) => setProvisionerToken(e.target.value)} placeholder="Заполните для нового токена" /></div>
              <p className="text-xs text-muted-foreground">После сохранения нажмите «Тест», затем переведите ноду в ONLINE.</p>
            </>
          ) : (
            <>
          <div className="grid grid-cols-2 gap-3"><div><Label>Провайдер</Label><select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="jitsi">Jitsi</option><option value="telemost">Telemost</option><option value="wbstream">WBStream</option></select></div><div><Label>Транспорт</Label><select value={transport} onChange={(e) => setTransport(e.target.value as typeof transport)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="datachannel">datachannel</option><option value="vp8channel">vp8channel</option><option value="seichannel">seichannel</option><option value="videochannel">videochannel</option></select></div></div>
          <div><Label>Room ID</Label><Input value={roomId} onChange={(e) => setRoomId(e.target.value)} /></div>
          <div><Label>Ключ шифрования</Label><Input value={encryptionKey} onChange={(e) => setEncryptionKey(e.target.value)} /></div>
          <div><Label>Параметры транспорта</Label><Input value={payload} onChange={(e) => setPayload(e.target.value)} /></div>
            </>
          )}
          <div><Label>Статус</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm">
              <option value="ONLINE">ONLINE</option>
              <option value="OFFLINE">OFFLINE</option>
              <option value="DISABLED">DISABLED</option>
            </select>
          </div>
          <div><Label>Вместимость</Label><Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ——— Categories & Tariffs Tab ———
function CategoriesTab({ token }: { token: string }) {
  const [categories, setCategories] = useState<WdttCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showCreateTariff, setShowCreateTariff] = useState(false);
  const [editingTariff, setEditingTariff] = useState<WdttTariffItem | null>(null);

  const fetchCategories = () => {
    setLoading(true);
    api.getWdttCategories(token).then((r) => setCategories(r.items)).finally(() => setLoading(false));
  };
  useEffect(() => { fetchCategories(); }, [token]);

  const deleteCategory = async (id: string) => {
    if (!confirm("Удалить категорию?")) return;
    await api.deleteWdttCategory(token, id);
    fetchCategories();
  };

  const deleteTariff = async (id: string) => {
    if (!confirm("Удалить тариф?")) return;
    await api.deleteWdttTariff(token, id);
    fetchCategories();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <Button onClick={() => setShowCreateCategory(true)} size="sm" variant="outline"><Plus className="h-4 w-4 mr-2" />Категорию</Button>
        <Button onClick={() => setShowCreateTariff(true)} size="sm"><Plus className="h-4 w-4 mr-2" />Тариф</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : categories.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Нет категорий. Создайте первую категорию.</Card>
      ) : (
        categories.map((cat) => (
          <Card key={cat.id} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-muted-foreground/50" />
                <span className="font-medium">{cat.name}</span>
                <span className="text-xs text-muted-foreground">(сортировка: {cat.sortOrder})</span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => deleteCategory(cat.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>

            {cat.tariffs.length === 0 ? (
              <p className="text-xs text-muted-foreground pl-7">Нет тарифов в этой категории</p>
            ) : (
              <div className="space-y-2 pl-7">
                {cat.tariffs.map((t) => (
                  <Card key={t.id} className="p-3 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {t.name}
                        {!t.enabled && <span className="text-xs text-muted-foreground">(отключён)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.proxyCount} ключ(а) · {t.durationDays} дн · {formatPrice(t.price, t.currency)}
                        {t.trafficLimitBytes ? ` · ${formatBytes(t.trafficLimitBytes)}` : " · безлимит"}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditingTariff(t)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteTariff(t.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Card>
        ))
      )}

      <CreateCategoryDialog token={token} open={showCreateCategory} onClose={() => setShowCreateCategory(false)} onCreated={() => { setShowCreateCategory(false); fetchCategories(); }} />
      <CreateTariffDialog token={token} categories={categories} open={showCreateTariff} onClose={() => setShowCreateTariff(false)} onCreated={() => { setShowCreateTariff(false); fetchCategories(); }} />
      {editingTariff && (
        <EditTariffDialog token={token} tariff={editingTariff} open={true} onClose={() => setEditingTariff(null)} onSaved={() => { setEditingTariff(null); fetchCategories(); }} />
      )}
    </div>
  );
}

function CreateCategoryDialog({ token, open, onClose, onCreated }: { token: string; open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const handleCreate = async () => {
    await api.createWdttCategory(token, { name, sortOrder });
    onCreated();
  };
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Создать категорию</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Название</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Сортировка</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleCreate} disabled={!name}>Создать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateTariffDialog({ token, categories, open, onClose, onCreated }: { token: string; categories: WdttCategoryItem[]; open: boolean; onClose: () => void; onCreated: () => void }) {
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [proxyCount, setProxyCount] = useState(1);
  const [durationDays, setDurationDays] = useState(30);
  const [trafficGb, setTrafficGb] = useState("");
  const [price, setPrice] = useState(0);
  const [currency, setCurrency] = useState("USD");
  const [sortOrder, setSortOrder] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open && categories.length > 0 && !categoryId) {
      setCategoryId(categories[0]?.id || "");
    }
  }, [open, categories]);

  const handleCreate = async () => {
    if (!name || !categoryId) return;
    setCreating(true);
    try {
      const trafficLimitBytes = trafficGb ? BigInt(Math.round(parseFloat(trafficGb) * 1024 ** 3)).toString() : null;
      await api.createWdttTariff(token, {
        categoryId,
        name,
        proxyCount,
        durationDays,
        trafficLimitBytes,
        price,
        currency,
        sortOrder,
        enabled,
      });
      onCreated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка создания тарифа");
    }
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Создать тариф OlcRTC</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Категория</Label>
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">Сначала создайте категорию</p>
            ) : (
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm">
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div><Label>Название</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="OlcRTC 30 дней" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Ссылок</Label><Input type="number" min={1} value={proxyCount} onChange={(e) => setProxyCount(parseInt(e.target.value) || 1)} /></div>
            <div><Label>Дней</Label><Input type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(parseInt(e.target.value) || 30)} /></div>
          </div>
          <div><Label>Трафик (GB, пусто = безлимит)</Label><Input type="number" value={trafficGb} onChange={(e) => setTrafficGb(e.target.value)} placeholder="100" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Цена</Label><Input type="number" step={0.01} value={price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} /></div>
            <div><Label>Валюта</Label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm">
                <option value="USD">USD</option>
                <option value="RUB">RUB</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Сортировка</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)} /></div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
                <span className="text-sm">Включён</span>
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleCreate} disabled={creating || !name || !categoryId}>
            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTariffDialog({ token, tariff, open, onClose, onSaved }: { token: string; tariff: WdttTariffItem; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tariff.name);
  const [proxyCount, setProxyCount] = useState(tariff.proxyCount);
  const [durationDays, setDurationDays] = useState(tariff.durationDays);
  const [trafficGb, setTrafficGb] = useState(tariff.trafficLimitBytes ? (Number(tariff.trafficLimitBytes) / 1024 ** 3).toString() : "");
  const [price, setPrice] = useState(tariff.price);
  const [currency, setCurrency] = useState(tariff.currency);
  const [sortOrder, setSortOrder] = useState(tariff.sortOrder);
  const [enabled, setEnabled] = useState(tariff.enabled);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const trafficLimitBytes = trafficGb ? BigInt(Math.round(parseFloat(trafficGb) * 1024 ** 3)).toString() : null;
    await api.updateWdttTariff(token, tariff.id, {
      name,
      proxyCount,
      durationDays,
      trafficLimitBytes,
      price,
      currency,
      sortOrder,
      enabled,
    });
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Редактировать тариф</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Название</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Ссылок</Label><Input type="number" min={1} value={proxyCount} onChange={(e) => setProxyCount(parseInt(e.target.value) || 1)} /></div>
            <div><Label>Дней</Label><Input type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(parseInt(e.target.value) || 30)} /></div>
          </div>
          <div><Label>Трафик (GB, пусто = безлимит)</Label><Input type="number" value={trafficGb} onChange={(e) => setTrafficGb(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Цена</Label><Input type="number" step={0.01} value={price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} /></div>
            <div><Label>Валюта</Label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="flex h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm">
                <option value="USD">USD</option>
                <option value="RUB">RUB</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Сортировка</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)} /></div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
                <span className="text-sm">Включён</span>
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ——— Slots Tab ———
function SlotsTab({ token }: { token: string }) {
  const [slots, setSlots] = useState<WdttSlotAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");

  const fetchSlots = () => {
    setLoading(true);
    api.getWdttSlotsAdmin(token).then((r) => setSlots(r.items)).finally(() => setLoading(false));
  };
  useEffect(() => { fetchSlots(); }, [token]);

  const revokeSlot = async (id: string) => {
    if (!confirm("Отозвать доступ?")) return;
    await api.revokeWdttSlotAdmin(token, id);
    fetchSlots();
  };

  const filtered = slots.filter((s) => {
    if (filterStatus !== "ALL" && s.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.password.toLowerCase().includes(q) && !s.clientEmail?.toLowerCase().includes(q) && !s.clientTelegram?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по паролю, email, telegram..." className="max-w-sm" />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="flex h-10 rounded-xl border bg-background px-3 py-2 text-sm">
          <option value="ALL">Все статусы</option>
          <option value="ACTIVE">Активные</option>
          <option value="EXPIRED">Истёкшие</option>
          <option value="REVOKED">Отозванные</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Нет подписок</Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <Card key={s.id} className="p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 text-sm min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{s.password}</span>
                    {slotStatusBadge(s.status)}
                    <span className="text-xs text-muted-foreground">на {s.nodeName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    <Link className="h-3 w-3 inline mr-1" />
                    {s.wdttLink}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Клиент: {s.clientEmail || s.clientTelegram || s.clientTelegramId || s.clientId}
                    {s.trafficLimitBytes ? ` · Трафик: ${formatBytes(s.trafficUsedBytes)} / ${formatBytes(s.trafficLimitBytes)}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Истекает: {formatDate(s.expiresAt)}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(s.wdttLink); }} title="Копировать ссылку">
                    <Copy className="h-3 w-3" />
                  </Button>
                  {s.status === "ACTIVE" && (
                    <Button variant="destructive" size="sm" onClick={() => revokeSlot(s.id)}>
                      <Ban className="h-3 w-3 mr-1" />Отозвать
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
