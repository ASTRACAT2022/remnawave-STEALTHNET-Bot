/**
 * Сборщик технических метрик Remnawave → Prometheus.
 *
 * Запускается из index.ts раз в COLLECT_INTERVAL_MS.
 * Если Remnawave не настроена (нет URL/токена) — пропускается, метрики
 * остаются нулями (это нормально — endpoint /metrics продолжает работать).
 *
 * Не выбрасывает исключения наружу: любые сбои Remnawave попадают в
 * remna_api_up=0 + console.error, но никогда не роняют процесс.
 */

import {
  remnaGetNodes,
  remnaGetSystemStats,
  remnaGetNodesMetrics,
  remnaGetNodesRealtimeUsage,
  isRemnaConfigured,
  remnaFetch,
} from "../modules/remna/remna.client.js";
import {
  remnaNodesTotal,
  remnaNodeUsersOnline,
  remnaNodeBandwidthBytes,
  remnaNodeBandwidthBps,
  remnaApiUp,
  remnaApiRequestDuration,
  remnaUsersTotal,
  remnaSubscriptionsTotal,
  remnaSystemStats,
  prismaConnectionUp,
} from "./metrics.js";
import { prisma } from "../db.js";

const COLLECT_INTERVAL_MS = 30_000; // 30 секунд — баланс между свежестью и нагрузкой на Remna API

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

type RemnaNodeShape = {
  uuid?: string;
  name?: string;
  address?: string;
  isConnected?: boolean;
  isDisabled?: boolean;
  isConnecting?: boolean;
  isConnectingOnline?: boolean;
  isNodeOnline?: boolean;
  xrayRunning?: boolean;
};

type RemnaNodesResponse = {
  response?: RemnaNodeShape[];
} | RemnaNodeShape[];

function asArray<T>(d: T[] | { response?: T[] } | undefined | null): T[] {
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.response)) return d.response;
  return [];
}

/**
 * Снять снапшот всех метрик Remnawave. Безопасен к ошибкам — все try/catch
 * внутри, на выходе просто обновлённые gauges.
 */
export async function collectRemnaMetrics(): Promise<void> {
  if (!isRemnaConfigured()) {
    remnaApiUp.set(0);
    return;
  }

  // 1) Список нод — самый дешёвый запрос, даёт нам connected/disabled/connecting
  const nodesStart = Date.now();
  try {
    const result = await remnaGetNodes();
    remnaApiRequestDuration.observe(
      { endpoint: "/api/nodes", status: String(result.status) },
      (Date.now() - nodesStart) / 1000,
    );
    if (result.error || !result.data) {
      remnaApiUp.set(0);
      console.warn("[metrics] Remna /api/nodes failed:", result.error);
      return;
    }
    remnaApiUp.set(1);

    const nodes = asArray<RemnaNodeShape>(result.data as RemnaNodesResponse);
    // Reset старые breakdown-метрики (set-ы с labels не «забывают» старые values
    // автоматически — если нода ушла, её счётчики зависнут).
    remnaNodesTotal.reset();
    let connected = 0, disconnected = 0, disabled = 0, connecting = 0, unknown = 0;
    for (const n of nodes) {
      if (n.isDisabled) {
        disabled++;
        continue;
      }
      if (n.isConnecting) {
        connecting++;
        continue;
      }
      // isConnected — основной индикатор (Remnawave API)
      if (n.isConnected === true) {
        connected++;
      } else if (n.isConnected === false) {
        disconnected++;
      } else {
        unknown++;
      }
    }
    remnaNodesTotal.set({ status: "connected" }, connected);
    remnaNodesTotal.set({ status: "disconnected" }, disconnected);
    remnaNodesTotal.set({ status: "disabled" }, disabled);
    remnaNodesTotal.set({ status: "connecting" }, connecting);
    remnaNodesTotal.set({ status: "unknown" }, unknown);
  } catch (e) {
    remnaApiUp.set(0);
    console.error("[metrics] Remna /api/nodes threw:", e);
    return;
  }

  // 2) Node metrics — users online + bandwidth (если API отдаёт)
  try {
    const result = await remnaGetNodesMetrics();
    if (!result.error && result.data) {
      type MetricsResp = {
        response?: {
          nodes?: {
            nodeUuid: string;
            nodeName: string;
            countryEmoji?: string;
            usersOnline?: number;
            inboundsStats?: { tag: string; upload: string; download: string }[];
            outboundsStats?: { tag: string; upload: string; download: string }[];
          }[];
        };
      };
      const payload = result.data as MetricsResp;
      const list = payload?.response?.nodes ?? [];
      // Reset, чтобы удалённые ноды не висели
      remnaNodeUsersOnline.reset();
      remnaNodeBandwidthBytes.reset();
      for (const n of list) {
        remnaNodeUsersOnline.set(
          { node_uuid: n.nodeUuid, node_name: n.nodeName, country: n.countryEmoji ?? "" },
          Number(n.usersOnline ?? 0),
        );
        let up = 0, down = 0;
        for (const s of n.inboundsStats ?? []) {
          up += Number(s.upload) || 0;
          down += Number(s.download) || 0;
        }
        for (const s of n.outboundsStats ?? []) {
          up += Number(s.upload) || 0;
          down += Number(s.download) || 0;
        }
        remnaNodeBandwidthBytes.set(
          { node_uuid: n.nodeUuid, node_name: n.nodeName, direction: "upload" },
          up,
        );
        remnaNodeBandwidthBytes.set(
          { node_uuid: n.nodeUuid, node_name: n.nodeName, direction: "download" },
          down,
        );
      }
    }
  } catch (e) {
    // Не критично — есть ноды, но metrics endpoint может отсутствовать
    // в старых версиях Remnawave.
    console.warn("[metrics] Remna /api/system/nodes/metrics failed:", e instanceof Error ? e.message : e);
  }

  // 3) Realtime bandwidth (Bps) — если доступно. Иначе gauge остаётся пустым.
  try {
    const result = await remnaGetNodesRealtimeUsage();
    if (!result.error && result.data) {
      type RtResp = {
        response?: {
          nodeUuid: string;
          nodeName: string;
          countryCode?: string;
          downloadSpeedBps?: number;
          uploadSpeedBps?: number;
        }[];
      };
      const payload = result.data as RtResp;
      const list = payload?.response ?? [];
      remnaNodeBandwidthBps.reset();
      for (const n of list) {
        remnaNodeBandwidthBps.set(
          { node_uuid: n.nodeUuid, node_name: n.nodeName, direction: "upload" },
          Number(n.uploadSpeedBps ?? 0),
        );
        remnaNodeBandwidthBps.set(
          { node_uuid: n.nodeUuid, node_name: n.nodeName, direction: "download" },
          Number(n.downloadSpeedBps ?? 0),
        );
      }
    }
  } catch {
    // Тихо — в Remnawave >=2.7.2 этот endpoint удалён, ничего не делаем.
  }

  // 4) System stats — общие счётчики (users / online / traffic)
  try {
    const result = await remnaGetSystemStats();
    if (!result.error && result.data) {
      type StatsResp = { response?: Record<string, unknown> } | Record<string, unknown>;
      const payload = result.data as StatsResp;
      const stats = (payload && "response" in payload && payload.response) ? payload.response : payload;
      if (stats && typeof stats === "object") {
        // Снимаем «totalOnline», «totalUsers», «activeSubscriptions», «totalTrafficBytes» и т.п.
        // Конкретные ключи варьируются по версии Remna, поэтому фильтруем
        // только числовые и записываем как labels.
        for (const [key, value] of Object.entries(stats as Record<string, unknown>)) {
          if (typeof value === "number" && Number.isFinite(value)) {
            // Нормализуем имена в lowercase_snake для консистентности
            const metricName = key.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
            remnaSystemStats.set({ metric: metricName }, value);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[metrics] Remna /api/system/stats failed:", e instanceof Error ? e.message : e);
  }

  // 5) Users / subscriptions breakdown через прямые запросы
  // Делаем по-простому: грузим до 1000 users и считаем по статусам.
  // Для production-grade стоит добавить в Remnawave dedicated /api/system/stats/users,
  // но пока — best effort.
  try {
    const usersResp = await remnaFetch<unknown>("/api/users?size=1000");
    if (!usersResp.error && usersResp.data) {
      type UsersListResp = { response?: unknown[]; total?: number } | unknown[];
      const u = usersResp.data as UsersListResp;
      const list = Array.isArray(u) ? u : Array.isArray(u.response) ? u.response : [];
      remnaUsersTotal.reset();
      let active = 0, disabled = 0, expired = 0, limited = 0, other = 0;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        // Remna status: ACTIVE / DISABLED / EXPIRED / LIMITED
        const status = String(obj.status ?? "").toUpperCase();
        if (status === "ACTIVE") active++;
        else if (status === "DISABLED") disabled++;
        else if (status === "EXPIRED") expired++;
        else if (status === "LIMITED") limited++;
        else other++;
      }
      remnaUsersTotal.set({ status: "active" }, active);
      remnaUsersTotal.set({ status: "disabled" }, disabled);
      remnaUsersTotal.set({ status: "expired" }, expired);
      remnaUsersTotal.set({ status: "limited" }, limited);
      remnaUsersTotal.set({ status: "other" }, other);
    }
  } catch (e) {
    console.warn("[metrics] Remna /api/users list failed:", e instanceof Error ? e.message : e);
  }

  try {
    const subsResp = await remnaFetch<unknown>("/api/subscriptions?page=1&limit=1000");
    if (!subsResp.error && subsResp.data) {
      type SubsListResp = { response?: unknown[]; total?: number } | unknown[];
      const u = subsResp.data as SubsListResp;
      const list = Array.isArray(u) ? u : Array.isArray(u.response) ? u.response : [];
      remnaSubscriptionsTotal.reset();
      const buckets: Record<string, number> = {};
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const status = String(obj.status ?? "unknown").toLowerCase() || "unknown";
        buckets[status] = (buckets[status] ?? 0) + 1;
      }
      for (const [s, n] of Object.entries(buckets)) {
        remnaSubscriptionsTotal.set({ status: s }, n);
      }
    }
  } catch (e) {
    console.warn("[metrics] Remna /api/subscriptions list failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Проверить доступность PostgreSQL. Лёгкий SELECT 1.
 */
export async function checkPrismaConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    prismaConnectionUp.set(1);
  } catch (e) {
    prismaConnectionUp.set(0);
    console.error("[metrics] Prisma connection check failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Запустить фоновый сборщик. Идемпотентно — повторный вызов не дублирует таймер.
 */
export function startMetricsCollector(): void {
  if (timer) return;
  if (!isRemnaConfigured()) {
    console.log("[metrics] Remnawave not configured — node metrics will stay at 0; HTTP/payment metrics still active");
  }
  // Первый проход — сразу, чтобы Prometheus видел данные при первом scrape
  void runOnce();
  timer = setInterval(() => {
    void runOnce();
  }, COLLECT_INTERVAL_MS);
  // unref — не блокируем завершение процесса
  if (typeof timer.unref === "function") timer.unref();
}

export function stopMetricsCollector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runOnce(): Promise<void> {
  if (isRunning) return; // защита от перекрытия долгих циклов
  isRunning = true;
  try {
    await Promise.allSettled([
      collectRemnaMetrics(),
      checkPrismaConnection(),
    ]);
  } finally {
    isRunning = false;
  }
}
