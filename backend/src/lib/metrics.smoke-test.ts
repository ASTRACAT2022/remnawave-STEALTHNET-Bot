/**
 * Smoke test для модуля metrics. Запускать:
 *   npx tsx src/lib/metrics.smoke-test.ts
 *
 * Проверяет:
 *  - модуль metrics.ts импортируется без ошибок
 *  - registry инициализируется, не пустой
 *  - renderMetrics() возвращает валидный Prometheus exposition format
 *  - HTTP middleware работает с mock request/response
 *  - payment helpers не падают при вызове с разными outcomes
 *
 * НЕ зависит от БД, не требует env — полностью изолирован.
 */

import {
  registry,
  renderMetrics,
  httpMetricsMiddleware,
  httpRequestsInFlight,
  paymentWebhookTotal,
  paymentProcessedTotal,
  tariffActivationsTotal,
  PROMETHEUS_CONTENT_TYPE,
  normalizeRoute,
} from "./metrics.js";
import {
  recordPaymentWebhookReceived,
  recordPaymentWebhookOutcome,
  recordPaymentProcessed,
  recordPaymentFailed,
  deriveProduct,
  recordTariffActivation,
  recordReferralReward,
  recordGiftActivation,
} from "./payment-metrics.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });
}

async function main() {
  console.log("== Prometheus metrics smoke test ==\n");

  await test("registry exists and is a Registry", () => {
    if (!registry || typeof registry.metrics !== "function") {
      throw new Error("registry invalid");
    }
  });

  await test("renderMetrics() returns valid text", async () => {
    const text = await renderMetrics();
    if (typeof text !== "string" || text.length === 0) {
      throw new Error(`empty or wrong type: ${typeof text}`);
    }
    // Prometheus format начинается с комментариев или метрик
    if (!text.includes("#") && !text.includes("stealthnet_")) {
      throw new Error("no metrics or comments in output");
    }
    console.log(`    (rendered ${text.length} bytes, ${text.split("\n").length} lines)`);
  });

  await test("renderMetrics() contains expected default metrics", async () => {
    const text = await renderMetrics();
    const expected = [
      "stealthnet_process_cpu_user_seconds_total",
      "stealthnet_nodejs_eventloop_lag_seconds",
      "stealthnet_nodejs_heap_size_total_bytes",
    ];
    for (const m of expected) {
      if (!text.includes(m)) throw new Error(`missing ${m}`);
    }
  });

  await test("renderMetrics() contains our custom metrics", async () => {
    const text = await renderMetrics();
    const expected = [
      "stealthnet_http_requests_total",
      "stealthnet_payment_webhook_total",
      "stealthnet_payment_processed_total",
      "stealthnet_payment_failed_total",
      "stealthnet_payment_processing_duration_seconds",
      "stealthnet_remna_api_up",
      "stealthnet_remna_nodes",
      "stealthnet_remna_node_users_online",
      "stealthnet_remna_node_bandwidth_bytes",
      "stealthnet_tariff_activations_total",
      "stealthnet_referral_rewards_total",
      "stealthnet_gift_activations_total",
      "stealthnet_prisma_connection_up",
    ];
    for (const m of expected) {
      if (!text.includes(m)) throw new Error(`missing ${m}`);
    }
  });

  await test("payment helpers don't throw on various inputs", () => {
    recordPaymentWebhookReceived("freekassa");
    recordPaymentWebhookOutcome("freekassa", "accepted");
    recordPaymentWebhookOutcome("freekassa", "rejected_signature");
    recordPaymentWebhookOutcome("freekassa", "unknown_outcome_falls_to_ignored");
    recordPaymentProcessed("freekassa", "tariff", 0.123);
    recordPaymentFailed("freekassa", "signature_invalid");
    recordTariffActivation("vpn", "success");
    recordReferralReward("success");
    recordGiftActivation("success");
    paymentWebhookTotal.inc({ provider: "test", outcome: "received" });
    paymentProcessedTotal.inc({ provider: "test", product: "tariff" });
    tariffActivationsTotal.inc({ tariff_type: "vpn", outcome: "success" });
  });

  await test("deriveProduct handles all payment shapes", () => {
    if (deriveProduct({ proxyTariffId: "x" }) !== "proxy") throw new Error("proxy");
    if (deriveProduct({ singboxTariffId: "x" }) !== "singbox") throw new Error("singbox");
    if (deriveProduct({ wdttTariffId: "x" }) !== "wdtt") throw new Error("wdtt");
    if (deriveProduct({ tariffId: "x" }) !== "tariff") throw new Error("tariff");
    if (deriveProduct({ metadata: '{"extraOption":{}}' }) !== "extra_option") throw new Error("extra");
    if (deriveProduct({}) !== "topup") throw new Error("topup");
  });

  await test("normalizeRoute sanitizes paths", () => {
    // UUID → :uuid
    const r1 = normalizeRoute({ path: "/api/admin/clients/abc12345-1234-1234-1234-123456789012" });
    if (!r1.includes(":uuid")) throw new Error(`UUID: got ${r1}`);
    // Cuid → :id
    const r2 = normalizeRoute({ path: "/api/admin/payments/cm1234567890abcdefghij" });
    if (!r2.includes(":id")) throw new Error(`cuid: got ${r2}`);
    // File → :file
    const r3 = normalizeRoute({ path: "/uploads/avatar.png" });
    if (!r3.includes(":file")) throw new Error(`file: got ${r3}`);
    // Static path unchanged
    const r4 = normalizeRoute({ path: "/api/webhooks/freekassa" });
    if (r4 !== "/api/webhooks/freekassa") throw new Error(`static: got ${r4}`);
    // Route+baseUrl
    const r5 = normalizeRoute({ baseUrl: "/api/admin", route: { path: "/:id" } });
    if (r5 !== "/api/admin/:id") throw new Error(`route+base: got ${r5}`);
  });

  await test("httpMetricsMiddleware() function returned", () => {
    const mw = httpMetricsMiddleware();
    if (typeof mw !== "function") throw new Error("not a function");
    if (mw.length !== 3) throw new Error("wrong arity (expected (req,res,next))");
  });

  await test("httpMetricsMiddleware skips /metrics", async () => {
    const mw = httpMetricsMiddleware();
    let nextCalled = false;
    const req = { path: "/metrics", method: "GET" } as any;
    const res = {} as any;
    mw(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error("next() not called");
    const v = await httpRequestsInFlight.get();
    const inflight = (v.values?.[0]?.value ?? 0);
    if (inflight !== 0) {
      throw new Error(`in-flight should be 0 for /metrics, got ${inflight}`);
    }
  });

  await test("httpMetricsMiddleware skips /api/health", () => {
    const mw = httpMetricsMiddleware();
    let nextCalled = false;
    mw({ path: "/api/health", method: "GET" } as any, {} as any, () => { nextCalled = true; });
    if (!nextCalled) throw new Error("next() not called for /api/health");
  });

  await test("httpMetricsMiddleware fires finish event for other paths", async () => {
    const mw = httpMetricsMiddleware();
    const res: any = {
      statusCode: 200,
      on: (event: string, cb: () => void) => {
        if (event === "finish") setImmediate(cb);
      },
      writableEnded: false,
      headersSent: false,
    };
    let nextCalled = false;
    mw({ path: "/api/some/route", method: "POST" } as any, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error("next not called");
    // дать finish сработать
    await new Promise((r) => setTimeout(r, 50));
    // in-flight должен вернуться к 0
    const v = await httpRequestsInFlight.get();
    const inflight = (v.values?.[0]?.value ?? 0);
    if (inflight !== 0) {
      throw new Error(`in-flight not decremented: ${inflight}`);
    }
  });

  await test("content type is Prometheus text format", () => {
    if (!PROMETHEUS_CONTENT_TYPE.includes("text/plain")) {
      throw new Error(`unexpected content type: ${PROMETHEUS_CONTENT_TYPE}`);
    }
  });

  await test("after instrumenting, metrics show non-zero values", async () => {
    // force a few more events
    recordPaymentWebhookReceived("freekassa");
    recordPaymentProcessed("freekassa", "tariff", 0.05);
    recordTariffActivation("vpn", "success");
    const text = await renderMetrics();
    if (!text.includes('stealthnet_payment_processed_total{provider="freekassa",product="tariff"}')) {
      throw new Error("custom counter not in output");
    }
    if (!text.includes('stealthnet_tariff_activations_total{outcome="success",tariff_type="vpn"}') &&
        !text.includes('stealthnet_tariff_activations_total{tariff_type="vpn",outcome="success"}')) {
      throw new Error("business counter not in output");
    }
  });

  console.log(`\n== ${passed} passed, ${failed} failed ==\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke test crashed:", e);
  process.exit(2);
});
