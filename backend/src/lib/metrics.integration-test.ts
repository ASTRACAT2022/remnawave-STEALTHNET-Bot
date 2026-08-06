/**
 * Интеграционный smoke test: поднимает Express app с middleware
 * (БЕЗ запуска всего API — только роутер `/metrics`), дёргает
 * endpoint и проверяет формат ответа.
 *
 * Запуск: npx tsx src/lib/metrics.integration-test.ts
 */
import express from "express";
import {
  httpMetricsMiddleware,
  renderMetrics,
  PROMETHEUS_CONTENT_TYPE,
  registry,
  timedHistogram,
  paymentProcessingDuration,
} from "./metrics.js";
import {
  recordPaymentWebhookReceived,
  recordPaymentProcessed,
  recordTariffActivation,
} from "./payment-metrics.js";

let passed = 0, failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => {
    passed++; console.log(`  ✓ ${name}`);
  }).catch((e) => {
    failed++; console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : e}`);
  });
}

async function main() {
  console.log("\n== Integration test: Express + /metrics ==\n");

  // Не импортируем app.ts целиком — он тянет prisma и .env. Делаем мини-приложение.
  const app = express();
  app.use(httpMetricsMiddleware());
  app.get("/metrics", async (_req, res) => {
    try {
      const body = await renderMetrics();
      res.setHeader("Content-Type", PROMETHEUS_CONTENT_TYPE);
      res.status(200).send(body);
    } catch (e) {
      res.status(500).send(`# error: ${e}\n`);
    }
  });
  app.get("/api/something/:id", (req, res) => {
    res.json({ ok: true, id: req.params.id });
  });
  app.get("/api/error", (_req, res) => res.status(500).json({ message: "boom" }));

  const server = app.listen(0); // случайный порт
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    await test("GET /metrics returns 200 with Prometheus content type", async () => {
      const res = await fetch(`${base}/metrics`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/plain")) throw new Error(`wrong content-type: ${ct}`);
      if (!ct.includes("version=0.0.4")) throw new Error(`not prom format: ${ct}`);
      const body = await res.text();
      if (!body.includes("stealthnet_")) throw new Error("no stealthnet_ metrics in body");
    });

    await test("GET /metrics is not counted in http_requests_total", async () => {
      // Take a baseline snapshot
      const before = (await registry.getSingleMetric("stealthnet_http_requests_total")?.get()) as any;
      const beforeCount = before?.values?.find((v: any) => v.labels?.route === "/metrics")?.value ?? 0;
      // Hit /metrics multiple times
      for (let i = 0; i < 3; i++) await fetch(`${base}/metrics`);
      const after = (await registry.getSingleMetric("stealthnet_http_requests_total")?.get()) as any;
      const afterCount = after?.values?.find((v: any) => v.labels?.route === "/metrics")?.value ?? 0;
      if (afterCount !== beforeCount) {
        throw new Error(`/metrics was counted: before=${beforeCount}, after=${afterCount}`);
      }
    });

    await test("Other paths ARE counted with normalized routes", async () => {
      const res = await fetch(`${base}/api/something/abc-123-uuid-here`);
      await res.text();
      const m = await registry.getSingleMetric("stealthnet_http_requests_total")?.get() as any;
      const withUuid = (m?.values ?? []).find((v: any) =>
        v.labels?.route?.includes("/api/something/:uuid") ||
        v.labels?.route?.includes("/api/something/:id")
      );
      if (!withUuid) {
        const allRoutes = (m?.values ?? []).map((v: any) => v.labels?.route).filter(Boolean);
        throw new Error(`no /api/something/:uuid label, got: ${allRoutes.join(", ")}`);
      }
      if (withUuid.value < 1) throw new Error(`count too low: ${withUuid.value}`);
    });

    await test("5xx responses are counted in http_requests_total", async () => {
      await fetch(`${base}/api/error`);
      const m = await registry.getSingleMetric("stealthnet_http_requests_total")?.get() as any;
      const errRow = (m?.values ?? []).find((v: any) =>
        v.labels?.status_code === "500" && v.labels?.route === "/api/error"
      );
      if (!errRow) {
        throw new Error("5xx not in http_requests_total");
      }
    });

    await test("http_request_duration_seconds histogram has buckets", async () => {
      await fetch(`${base}/api/something/x`);
      const m = await registry.getSingleMetric("stealthnet_http_request_duration_seconds")?.get() as any;
      const buckets = (m?.values ?? []).filter((v: any) => v.labels?.route === "/api/something/:id");
      if (buckets.length < 3) throw new Error(`too few buckets: ${buckets.length}`);
      // Должен быть хотя бы один с le="+Inf"
      if (!buckets.some((v: any) => v.labels?.le === "+Inf")) {
        throw new Error("no +Inf bucket");
      }
    });

    await test("payment metrics flow into /metrics output", async () => {
      recordPaymentWebhookReceived("heleket");
      recordPaymentProcessed("heleket", "proxy", 0.123);
      recordTariffActivation("proxy", "success");
      const res = await fetch(`${base}/metrics`);
      const body = await res.text();
      if (!body.includes('stealthnet_payment_webhook_total{provider="heleket",outcome="received"}')) {
        throw new Error("heleket webhook counter missing");
      }
      if (!body.includes('stealthnet_payment_processed_total{provider="heleket",product="proxy"}')) {
        throw new Error("heleket processed counter missing");
      }
    });

    await test("timedHistogram() works correctly", async () => {
      const result = await timedHistogram(
        paymentProcessingDuration,
        { provider: "freekassa", product: "tariff" },
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return "done";
        }
      );
      if (result !== "done") throw new Error("did not return value");
    });

    await test("metrics is fast (< 100ms per render)", async () => {
      const start = Date.now();
      await renderMetrics();
      const ms = Date.now() - start;
      if (ms > 100) throw new Error(`too slow: ${ms}ms`);
      console.log(`    (rendered in ${ms}ms)`);
    });

    console.log(`\n== ${passed} passed, ${failed} failed ==\n`);
  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("integration test crashed:", e);
  process.exit(2);
});
