import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/index.js";
import { authRouter } from "./modules/auth/index.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { proxyAdminRouter } from "./modules/proxy/proxy.admin.routes.js";
import { proxyAgentRouter } from "./modules/proxy/proxy.agent.routes.js";
import { singboxAdminRouter } from "./modules/singbox/singbox.admin.routes.js";
import { singboxAgentRouter } from "./modules/singbox/singbox.agent.routes.js";
import { clientRouter, publicConfigRouter } from "./modules/client/client.routes.js";
import { remnaWebhooksRouter } from "./modules/webhooks/remna.webhooks.routes.js";
import { plategaWebhooksRouter } from "./modules/webhooks/platega.webhooks.routes.js";
import { yoomoneyWebhooksRouter } from "./modules/webhooks/yoomoney.webhooks.routes.js";
import { yookassaWebhooksRouter } from "./modules/webhooks/yookassa.webhooks.routes.js";
import { cryptopayWebhooksRouter } from "./modules/webhooks/cryptopay.webhooks.routes.js";
import { heleketWebhooksRouter } from "./modules/webhooks/heleket.webhooks.routes.js";
import { botAdminRouter } from "./modules/bot-admin/bot-admin.routes.js";
import { contestAdminRouter } from "./modules/contest/contest.admin.routes.js";
import { contestPublicRouter } from "./modules/contest/contest.public.routes.js";
import { adminReferralsRouter } from "./modules/admin/referrals.routes.js";
import { trafficAbuseRouter } from "./modules/admin/traffic-abuse.routes.js";
import { apiKeysAdminRouter } from "./modules/api-keys/api-keys.admin.routes.js";
import { externalApiRouter } from "./modules/api-keys/external-api.routes.js";
import { geoMapRouter } from "./modules/geo-map/geo-map.routes.js";
import { giftRouter, giftPublicRouter } from "./modules/gift/gift.routes.js";
import { paymentRedirectRouter } from "./modules/payment-redirect/payment-redirect.routes.js";
import { startHealthCheck } from "./modules/health/health.service.js";
import healthRouter from "./modules/health/health.routes.js";
import { checkMaintenance } from "./modules/health/maintenance.middleware.js";

const app = express();

// За nginx: иначе express-rate-limit падает из-за X-Forwarded-For
app.set("trust proxy", 1);

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  origin: env.CORS_ORIGIN === "*" ? true : (env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean) : false),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
}));
// Crypto Pay и Heleket webhooks нужен raw body для проверки подписи (до express.json)
app.use("/api/webhooks/cryptopay", express.raw({ type: "application/json" }), cryptopayWebhooksRouter);
app.use("/api/webhooks/heleket", express.raw({ type: "application/json" }), heleketWebhooksRouter);

// Лимит 5MB для настроек с логотипом и favicon (data URL)
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ——— Защита от накрутки аккаунтов и перебора ———
const dev = process.env.NODE_ENV === "development";

// Админка: логин и 2FA — жёсткий лимит по IP
const authStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 1000 : 2000,
  message: { message: "Too many login attempts" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", authStrictLimiter);
app.use("/api/auth/2fa-login", authStrictLimiter);

// Клиент: регистрация — сильно ограничить с одного IP
const clientRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: dev ? 500 : 500,
  message: { message: "Too many registration attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/client/auth/register", clientRegisterLimiter);

// Клиент: вход через Telegram Mini App (создание аккаунта или логин)
const clientTelegramMiniappLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: dev ? 1000 : 1500,
  message: { message: "Too many attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/client/auth/telegram-miniapp", clientTelegramMiniappLimiter);

// Клиент: OAuth (Google, Apple) — ограничение от перебора
const clientOAuthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: dev ? 1000 : 300,
  message: { message: "Too many OAuth attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/client/auth/google", clientOAuthLimiter);
app.use("/api/client/auth/apple", clientOAuthLimiter);

// Клиент: все auth-эндпоинты (логин, verify-email, 2fa и т.д.) — общий лимит
const clientAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 2000 : 600,
  message: { message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/client/auth", clientAuthLimiter);

// Общий лимит на весь API (по IP: каждый клиент/NAT имеет свой счётчик)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 2000 : 1500,
  message: { message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// Gift public endpoint: 5 attempts per minute per IP (brute force protection)
const giftPublicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: dev ? 100 : 5,
  message: { message: "Слишком много попыток. Подождите минуту." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/gift/public", giftPublicLimiter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "3.2.7" });
});

// Health Check и управление техническими работами
app.use("/api/health", healthRouter);

// Запуск Health Checker для Remna API
startHealthCheck();

// Middleware для проверки режима технических работ
app.use(checkMaintenance);

// Статика для загруженных файлов (маскоты, видео)
app.use("/api/uploads", express.static(path.join("/app/uploads"), {
  maxAge: "30d",
  immutable: true,
}));

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/referrals", adminReferralsRouter);
app.use("/api/admin/traffic-abuse", trafficAbuseRouter);
app.use("/api/admin/api-keys", apiKeysAdminRouter);
app.use("/api/admin/geo-map", geoMapRouter);
app.use("/api/admin/contests", contestAdminRouter);
app.use("/api/admin/proxy", proxyAdminRouter);
app.use("/api/admin/singbox", singboxAdminRouter);
app.use("/api/proxy-nodes", proxyAgentRouter);
app.use("/api/singbox-nodes", singboxAgentRouter);
app.use("/api/client", clientRouter);
app.use("/api/client/gift", giftRouter);
app.use("/api/gift/public", giftPublicRouter);
app.use("/api/public", publicConfigRouter);
app.use("/api/public", contestPublicRouter);
app.use("/api/pay", paymentRedirectRouter);
app.use("/api/v1", externalApiRouter);
app.use("/api/bot-admin", botAdminRouter);
app.use("/api/webhooks", remnaWebhooksRouter);
app.use("/api/webhooks", plategaWebhooksRouter);
app.use("/api/webhooks", yoomoneyWebhooksRouter);
app.use("/api/webhooks", yookassaWebhooksRouter);
// cryptopay уже смонтирован выше с raw body

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

export default app;
