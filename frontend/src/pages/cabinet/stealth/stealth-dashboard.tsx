/**
 * Stealth Dashboard — главная страница нового дизайна.
 *
 * Структура (вдохновлено Hundler VPN home screen):
 *   1. Hero/визуал — мягкое свечение + большое лого/иконка над контентом
 *   2. Карточка «Подписка»:
 *      - Заголовок «Подписка» + бейджи «ДО {date}» и «Осталось N дн.»
 *      - Pill «📱 Устройства {n}/{max}»
 *      - Кнопки: «Продлить» (ghost) → highlight «Установить и настроить VPN»
 *        → grid 2x1 «Промокоды | Мои устройства» → ghost «Реферальная система»
 *   3. Если нет подписки — другой блок: hero + большая красная Buy CTA
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Settings2, Smartphone, Gift, Users, ChevronRight, Shield, Calendar, Clock, Check, Loader2, X } from "lucide-react";
import { StealthPromocodeModal } from "@/components/stealth/stealth-promocode-modal";
import { StealthDevicesModal } from "@/components/stealth/stealth-devices-modal";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { StadiumButton } from "@/components/stealth/stadium-button";

interface SubInfo {
  id: string | null;
  displayName: string | null;
  description: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
  hasActive: boolean;
  devicesUsed: number;
  devicesTotal: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return "—"; }
}

/**
 * Развернуть Remnawave-обёртку: ответ может приходить как
 * { response: {...} }, { data: { response: {...} } }, либо плоский объект.
 * Идентичная логика используется в classic-dashboard parseSubscription.
 */
function unwrapRemnaSub(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object") {
    const d = raw.data as Record<string, unknown>;
    if (d.response && typeof d.response === "object") return d.response as Record<string, unknown>;
  }
  return raw;
}

export function StealthDashboard() {
  const { state } = useClientAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<SubInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0); // bump чтобы перезагрузить инфо после модалок
  const [showPromo, setShowPromo] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [descriptionValue, setDescriptionValue] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSaved, setMetaSaved] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.token) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api.clientSubscription(state.token).catch(() => null),
      api.getClientDevices(state.token).catch(() => ({ total: 0 })),
    ]).then(([sub, devices]) => {
      if (!alive) return;
      // Remnawave-ответ может быть обёрнут в .response или .data.response —
      // unwrap'аем (логика та же что в classic-dashboard parseSubscription).
      const s = unwrapRemnaSub(sub?.subscription);
      const expireAt = typeof s?.expireAt === "string" ? s.expireAt : null;
      const expDate = expireAt ? new Date(expireAt) : null;
      const validDate = expDate && !Number.isNaN(expDate.getTime()) ? expDate : null;
      const hasActive = !!validDate && validDate.getTime() > Date.now();
      const daysLeft = hasActive
        ? Math.max(0, Math.ceil((validDate!.getTime() - Date.now()) / 86_400_000))
        : null;
      const limit = typeof s?.hwidDeviceLimit === "number" ? s.hwidDeviceLimit
        : s?.hwidDeviceLimit != null ? Number(s.hwidDeviceLimit) : 0;
      const displayName = sub?.displayName ?? null;
      const description = sub?.description ?? null;
      setNameValue(displayName ?? "");
      setDescriptionValue(description ?? "");
      setInfo({
        id: sub?.subscriptionId ?? null,
        displayName,
        description,
        expiresAt: expireAt,
        daysLeft,
        hasActive,
        devicesUsed: devices?.total ?? 0,
        devicesTotal: Number.isFinite(limit) && limit > 0 ? limit : 0,
      });
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [state.token, reloadKey]);

  async function saveMeta() {
    if (!state.token || !info?.id) return;
    setSavingMeta(true);
    setMetaSaved(false);
    setMetaError(null);
    try {
      const result = await api.clientUpdateSubscriptionMetadata(state.token, info.id, {
        displayName: nameValue.trim() || null,
        description: descriptionValue.trim() || null,
      });
      setInfo((prev) => prev ? { ...prev, displayName: result.displayName, description: result.description } : prev);
      setNameValue(result.displayName ?? "");
      setDescriptionValue(result.description ?? "");
      setMetaSaved(true);
      setTimeout(() => setMetaSaved(false), 1800);
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSavingMeta(false);
    }
  }

  const metaChanged = !!info && (nameValue.trim() !== (info.displayName ?? "").trim() || descriptionValue.trim() !== (info.description ?? "").trim());

  return (
    <div className="px-4 pt-2 space-y-5">
      {/* Hero — большой светящийся шар-логотип (placeholder под favicon бренда) */}
      <div className="relative h-44 md:h-56 flex items-center justify-center">
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(closest-side, rgba(255,35,87,0.18), transparent 65%)",
            filter: "blur(12px)",
          }}
        />
        <div className="relative h-32 w-32 md:h-40 md:w-40 rounded-full bg-gradient-to-br from-zinc-900 to-black border border-rose-500/20 flex items-center justify-center shadow-[0_0_60px_-10px_rgba(255,35,87,0.5),inset_0_0_30px_rgba(255,35,87,0.1)]">
          <Shield className="h-14 w-14 md:h-16 md:w-16 text-rose-500" strokeWidth={1.5} />
        </div>
      </div>

      {/* Subscription card */}
      <div className="rounded-3xl bg-zinc-900/70 border border-white/[0.06] p-5 backdrop-blur-md space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{info?.displayName?.trim() || "Подписка"}</h2>
            {info?.description?.trim() && <p className="mt-1 text-xs text-zinc-400 whitespace-pre-line">{info.description.trim()}</p>}
          </div>
          {info?.hasActive ? (
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-[9px] font-bold tracking-[0.18em] uppercase text-zinc-500">ДО</span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-xs font-medium tabular-nums">
                <Calendar className="h-3 w-3 text-rose-400" strokeWidth={2.2} />
                {formatDate(info.expiresAt)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-xs">
                <Clock className="h-3 w-3 text-zinc-400" strokeWidth={2.2} />
                Осталось {info.daysLeft} дн.
              </span>
            </div>
          ) : !loading ? (
            <span className="rounded-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Нет подписки
            </span>
          ) : null}
        </div>

        {/* Devices pill */}
        {info && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] px-3 py-1.5 text-xs">
            <Smartphone className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-zinc-200">
              Устройства{" "}
              <span className="tabular-nums">
                {info.devicesUsed}{info.devicesTotal > 0 ? `/${info.devicesTotal}` : ""}
              </span>
            </span>
          </div>
        )}

        {info?.id && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Имя и описание</p>
              {metaSaved && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                  <Check className="h-3 w-3" />
                  Сохранено
                </span>
              )}
            </div>
            <input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value.slice(0, 120))}
              placeholder="Например: iPhone, Дом, Ноутбук"
              maxLength={120}
              className="w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-rose-500/40"
            />
            <textarea
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value.slice(0, 1000))}
              placeholder="Описание или заметка по подписке"
              maxLength={1000}
              className="min-h-[74px] w-full resize-none rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-rose-500/40"
            />
            {metaError && <p className="text-xs font-medium text-rose-300">{metaError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!metaChanged || savingMeta}
                onClick={saveMeta}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-rose-500 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Сохранить
              </button>
              <button
                type="button"
                disabled={savingMeta || (!nameValue && !descriptionValue)}
                onClick={() => {
                  setNameValue("");
                  setDescriptionValue("");
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-sm font-semibold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                Очистить
              </button>
            </div>
          </div>
        )}

        {/* Action stack */}
        <div className="space-y-2.5 pt-1">
          <StadiumButton
            variant="ghost"
            size="md"
            iconLeft={<Zap className="h-4 w-4 text-rose-400" />}
            onClick={() => navigate("/cabinet/tariffs")}
          >
            {info?.hasActive ? "Продлить" : "Оформить подписку"}
          </StadiumButton>

          <StadiumButton
            variant="highlight"
            size="md"
            iconLeft={
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/15 border border-rose-500/30">
                <Settings2 className="h-3.5 w-3.5 text-rose-400" />
              </span>
            }
            iconRight={<ChevronRight className="h-4 w-4 text-zinc-500" />}
            onClick={() => navigate("/cabinet/subscribe")}
          >
            <span className="flex-1 text-left">Установить и настроить VPN</span>
          </StadiumButton>

          <div className="grid grid-cols-2 gap-2.5">
            <StadiumButton
              variant="ghost" size="md"
              iconLeft={<Gift className="h-4 w-4 text-zinc-400" />}
              onClick={() => setShowPromo(true)}
              className="!text-xs whitespace-nowrap !px-3"
            >
              Промокоды
            </StadiumButton>
            <StadiumButton
              variant="ghost" size="md"
              iconLeft={<Smartphone className="h-4 w-4 text-zinc-400" />}
              onClick={() => setShowDevices(true)}
              className="!text-xs whitespace-nowrap !px-3"
            >
              Мои устройства
            </StadiumButton>
          </div>

          <StadiumButton
            variant="ghost"
            size="md"
            iconLeft={<Users className="h-4 w-4 text-zinc-400" />}
            onClick={() => navigate("/cabinet/referral")}
          >
            Реферальная система
          </StadiumButton>
        </div>
      </div>

      {/* Если подписки нет — большая Buy CTA */}
      {!loading && info && !info.hasActive && (
        <div className="px-1">
          <StadiumButton
            variant="primary" size="lg"
            onClick={() => navigate("/cabinet/tariffs")}
          >
            Начать бесплатно
          </StadiumButton>
        </div>
      )}

      {/* Модалки */}
      <StealthPromocodeModal
        open={showPromo}
        onClose={() => setShowPromo(false)}
        onActivated={() => setReloadKey((k) => k + 1)}
      />
      <StealthDevicesModal
        open={showDevices}
        onClose={() => setShowDevices(false)}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}
