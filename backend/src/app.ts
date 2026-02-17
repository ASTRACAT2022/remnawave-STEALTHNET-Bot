import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { env } from "./config/index.js";
import { prisma } from "./db.js";
import { authRouter } from "./modules/auth/index.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { clientRouter, publicConfigRouter } from "./modules/client/client.routes.js";
import { remnaWebhooksRouter } from "./modules/webhooks/remna.webhooks.routes.js";
import { plategaWebhooksRouter } from "./modules/webhooks/platega.webhooks.routes.js";
import { yoomoneyWebhooksRouter } from "./modules/webhooks/yoomoney.webhooks.routes.js";
import { yookassaWebhooksRouter } from "./modules/webhooks/yookassa.webhooks.routes.js";

const app = express();

// За nginx: иначе express-rate-limit падает из-за X-Forwarded-For
app.set("trust proxy", 1);

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
// Лимит 5MB для настроек с логотипом и favicon (data URL)
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

function isTrustedBotRequest(req: express.Request): boolean {
  const configuredKey = env.BOT_INTERNAL_API_KEY?.trim();
  if (!configuredKey) return false;
  const providedKey = req.header("X-Bot-Internal-Key")?.trim();
  return Boolean(providedKey && providedKey === configuredKey);
}

function buildRateLimitKey(req: express.Request): string {
  const auth = req.header("Authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      const digest = createHash("sha256").update(token).digest("hex").slice(0, 16);
      return `bearer:${digest}`;
    }
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "development" ? 5000 : 3000,
  message: { message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: buildRateLimitKey,
  skip: isTrustedBotRequest,
});
app.use("/api/", limiter);

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", version: "3.1.0", database: "ok" });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    res.status(503).json({ status: "degraded", version: "3.1.0", database: "down", error });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/client", clientRouter);
app.use("/api/public", publicConfigRouter);
app.use("/api/webhooks", remnaWebhooksRouter);
app.use("/api/webhooks", plategaWebhooksRouter);
app.use("/api/webhooks", yoomoneyWebhooksRouter);
app.use("/api/webhooks", yookassaWebhooksRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

export default app;
