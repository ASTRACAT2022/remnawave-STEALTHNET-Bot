/**
 * Prometheus metrics для STEALTHNET.
 *
 * Только технические метрики (никаких финансовых сумм, балансов, PII):
 *   - HTTP: длительность и количество запросов
 *   - Платежи: счётчики успешных/неуспешных операций по каждому кассе
 *   - Remnawave: количество нод, статус, пользователи, bandwidth
 *   - Бизнес-операции: tariff activation, proxy slots, gift и т.п.
 *   - Системные: длительность Prisma-запросов, размер event-loop лагов
 *
 * Дизайн:
 *   - Реестр изолирован (default metrics НЕ глобальный), чтобы не цеплять
 *     чужие метрики в тестах.
 *   - Метрики, которые нельзя посчитать без stateful-объекта (bandwidth нод),
 *     обновляются через collectors() — pull-модель. Push-модель только для
 *     событий (HTTP, платежи).
 *   - Если Remnawave не настроена (нет REMNA_API_URL/TOKEN), метрики нод
 *     остаются нулями — endpoint /metrics всё равно работает корректно.
 *
 * Endpoint: GET /metrics (text/plain; version=0.0.4)
 * Auth: НЕТ, т.к. endpoint отдаёт только агрегаты (никаких PII).
 *       Если нужна защита — закрыть на уровне nginx (allow IP Prometheus).
 */

import client, { Registry, Counter, Histogram, Gauge, Summary, collectDefaultMetrics } from "prom-client";

// Изолированный registry — не трогаем глобальный prom-client.register.
export const registry = new Registry();

// Дефолтные Node.js метрики (event-loop lag, GC, memory, CPU, fd).
// С interval 5000 мс — для production нагрузок достаточно, на каждый scrape
// не дёргаем.
collectDefaultMetrics({
  register: registry,
  prefix: "stealthnet_",
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  eventLoopMonitoringPrecision: 5,
});

// ═══════════════════════════════════════════════════════════════════════════
// HTTP
// ═══════════════════════════════════════════════════════════════════════════

export const httpRequestDuration = new Histogram({
  name: "stealthnet_http_request_duration_seconds",
  help: "HTTP request duration in seconds, labeled by method, route, status_code",
  labelNames: ["method", "route", "status_code"] as const,
  // Buckets оптимизированы под API с типичным p50 ~10ms, p99 ~500ms.
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: "stealthnet_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

export const httpRequestsInFlight = new Gauge({
  name: "stealthnet_http_requests_in_flight",
  help: "In-flight HTTP requests",
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// ПЛАТЕЖИ — технические счётчики по каждой кассе
// Метки: provider (freekassa, heleket, telegram_stars, ...), outcome
// Финансовых сумм НЕТ — только счётчики операций (важно для SLA/SLO).
// ═══════════════════════════════════════════════════════════════════════════

export const paymentWebhookTotal = new Counter({
  name: "stealthnet_payment_webhook_total",
  help: "Payment webhook events received (raw, before signature validation)",
  labelNames: ["provider", "outcome"] as const,
  // outcome: received | signature_invalid | bad_payload | processed | ignored
  registers: [registry],
});

export const paymentProcessedTotal = new Counter({
  name: "stealthnet_payment_processed_total",
  help: "Successfully processed payment operations by provider and product type",
  labelNames: ["provider", "product"] as const,
  // product: topup | tariff | proxy | singbox | wdtt | extra_option
  registers: [registry],
});

export const paymentFailedTotal = new Counter({
  name: "stealthnet_payment_failed_total",
  help: "Failed payment operations (signature fail, amount mismatch, processing error)",
  labelNames: ["provider", "reason"] as const,
  registers: [registry],
});

export const paymentProcessingDuration = new Histogram({
  name: "stealthnet_payment_processing_duration_seconds",
  help: "End-to-end payment processing duration in seconds",
  labelNames: ["provider", "product"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// REMNAWAVE NODES — pull-модель через collect()
// Заполняется в metrics-collector (index.ts), обновляется каждые 30s.
// ═══════════════════════════════════════════════════════════════════════════

export const remnaNodesTotal = new Gauge({
  name: "stealthnet_remna_nodes",
  help: "Total Remnawave nodes by status",
  labelNames: ["status"] as const,
  // status: connected | disconnected | disabled | connecting | unknown
  registers: [registry],
});

export const remnaNodeUsersOnline = new Gauge({
  name: "stealthnet_remna_node_users_online",
  help: "Currently online users per node",
  labelNames: ["node_uuid", "node_name", "country"] as const,
  registers: [registry],
});

export const remnaNodeBandwidthBytes = new Gauge({
  name: "stealthnet_remna_node_bandwidth_bytes",
  help: "Bandwidth usage per node in bytes (cumulative from Remna API)",
  labelNames: ["node_uuid", "node_name", "direction"] as const,
  // direction: upload | download
  registers: [registry],
});

export const remnaNodeBandwidthBps = new Gauge({
  name: "stealthnet_remna_node_bandwidth_bps",
  help: "Current bandwidth in bits per second (realtime) per node",
  labelNames: ["node_uuid", "node_name", "direction"] as const,
  registers: [registry],
});

export const remnaApiUp = new Gauge({
  name: "stealthnet_remna_api_up",
  help: "1 if Remnawave API is reachable and responding, 0 otherwise",
  registers: [registry],
});

export const remnaApiRequestDuration = new Histogram({
  name: "stealthnet_remna_api_request_duration_seconds",
  help: "Remnawave API call duration",
  labelNames: ["endpoint", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// REMNAWAVE USERS / SUBSCRIPTIONS — обновляются из Remna API
// ═══════════════════════════════════════════════════════════════════════════

export const remnaUsersTotal = new Gauge({
  name: "stealthnet_remna_users",
  help: "Total Remnawave users by status",
  labelNames: ["status"] as const,
  // status: active | disabled | expired | limited | trial
  registers: [registry],
});

export const remnaSubscriptionsTotal = new Gauge({
  name: "stealthnet_remna_subscriptions",
  help: "Total Remnawave subscriptions by status",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const remnaSystemStats = new Gauge({
  name: "stealthnet_remna_system_stat",
  help: "Remnawave system-wide stat values",
  labelNames: ["metric"] as const,
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// БИЗНЕС-ОПЕРАЦИИ (только счётчики, без сумм)
// ═══════════════════════════════════════════════════════════════════════════

export const tariffActivationsTotal = new Counter({
  name: "stealthnet_tariff_activations_total",
  help: "Tariff activation events",
  labelNames: ["tariff_type", "outcome"] as const,
  // tariff_type: vpn | proxy | singbox | wdtt
  // outcome: success | failed | already_active
  registers: [registry],
});

export const referralRewardsTotal = new Counter({
  name: "stealthnet_referral_rewards_total",
  help: "Referral reward events",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

export const giftActivationsTotal = new Counter({
  name: "stealthnet_gift_activations_total",
  help: "Gift code activation events",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

export const clientRegistrationsTotal = new Counter({
  name: "stealthnet_client_registrations_total",
  help: "Client registration events",
  labelNames: ["source"] as const,
  // source: telegram | email | oauth_google | oauth_apple | manual
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE / PRISMA
// ═══════════════════════════════════════════════════════════════════════════

export const prismaQueryDuration = new Histogram({
  name: "stealthnet_prisma_query_duration_seconds",
  help: "Prisma query duration",
  labelNames: ["model", "operation"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

export const prismaConnectionUp = new Gauge({
  name: "stealthnet_prisma_connection_up",
  help: "1 if Prisma can reach the database, 0 otherwise",
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// КРОНЫ / SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════

export const cronJobDuration = new Histogram({
  name: "stealthnet_cron_job_duration_seconds",
  help: "Scheduled job duration",
  labelNames: ["job", "outcome"] as const,
  buckets: [0.01, 0.1, 1, 5, 30, 60, 300, 600],
  registers: [registry],
});

export const cronJobLastSuccess = new Gauge({
  name: "stealthnet_cron_job_last_success_timestamp",
  help: "Unix timestamp of last successful run for a scheduled job",
  labelNames: ["job"] as const,
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// УДОБНЫЕ ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Извлечь «нормализованный» route для меток (без ID в URL, чтобы не взорвать cardinality).
 * Примеры:
 *   /api/admin/clients/abc123           → /api/admin/clients/:id
 *   /api/webhooks/freekassa             → /api/webhooks/freekassa
 *   /api/uploads/avatars/x.png          → /api/uploads/avatars/:filename
 *   /                                  → /
 * Если параметры сложно отличить — возвращаем first-2-сегмента.
 */
export function normalizeRoute(req: { route?: { path?: string }; baseUrl?: string; path?: string }): string {
  // Express req.route доступен только после матча роутера. До матча
  // (404) используем исходный path с санитизацией.
  const fromRoute = req.route?.path;
  const base = req.baseUrl || "";
  if (fromRoute) {
    return sanitizePath(base + fromRoute);
  }
  return sanitizePath(req.path || "");
}

function sanitizePath(p: string): string {
  if (!p) return "/";
  // Убираем query string, если пробрался.
  const clean = p.split("?")[0] || "/";
  // UUID-подобные сегменты
  let out = clean
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    // Чисто числовые ID (≥ 4 цифры чтобы не сожрать /v1/123)
    .replace(/\/[0-9]{6,}/g, "/:id")
    // Cuid-подобные (cm..., cka..., и т.п.)
    .replace(/\/c[a-z0-9]{20,}/gi, "/:id")
    // Email-подобные в path
    .replace(/\/[^\s/]+@[^\s/]+/g, "/:email")
    // Файлы с расширением
    .replace(/\/[^/]+\.[a-z0-9]{2,5}$/i, "/:file");
  return out || "/";
}

/**
 * Express middleware: метрит длительность + общее число запросов.
 * Должен быть установлен ПЕРВЫМ после helmet (чтобы ловить ВСЕ запросы,
 * включая 404, но при этом не считать 4xx ошибки дважды).
 *
 * Помечает ли `req._metricsStart` для последующего измерения внутри хендлеров,
 * если им нужно замерить конкретный шаг.
 */
export function httpMetricsMiddleware() {
  return function (req: any, res: any, next: () => void) {
    // Не считаем сам /metrics (иначе scrape'ы заспамят счётчик).
    if (req.path === "/metrics" || req.path === "/api/health") {
      return next();
    }
    const startNs = process.hrtime.bigint();
    httpRequestsInFlight.inc();
    res.on("finish", () => {
      const route = normalizeRoute(req);
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };
      const seconds = Number(process.hrtime.bigint() - startNs) / 1e9;
      httpRequestDuration.observe(labels, seconds);
      httpRequestsTotal.inc(labels);
      httpRequestsInFlight.dec();
    });
    res.on("close", () => {
      // Если клиент отвалился до finish — всё равно уменьшим in-flight.
      if (res.writableEnded === false && res.headersSent === false) {
        httpRequestsInFlight.dec();
      }
    });
    next();
  };
}

/**
 * Измерить длительность асинхронной операции с заданными labels.
 * Пример:
 *   await timedHistogram(paymentProcessingDuration, { provider: "freekassa", product: "tariff" }, async () => {...})
 */
export async function timedHistogram<T>(
  hist: Histogram<string>,
  labels: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const end = hist.startTimer(labels);
  try {
    return await fn();
  } finally {
    end();
  }
}

/**
 * Content-type для Prometheus exposition format v0.0.4.
 */
export const PROMETHEUS_CONTENT_TYPE = registry.contentType;

/**
 * Render the registry в текстовый формат.
 */
export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export default registry;
