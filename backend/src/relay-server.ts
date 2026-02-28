import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { z } from "zod";
import {
  createNalogoReceipt,
  testNalogoConnection,
  type NalogoConfig,
} from "./modules/nalogo/nalogo.service.js";

const relayEnvSchema = z.object({
  RELAY_PORT: z.coerce.number().default(7070),
  RELAY_API_KEY: z.string().optional(),
  RELAY_AUTH_DISABLED: z.string().optional(),
  RELAY_CORS_ORIGIN: z.string().default("*"),
});

const relayEnvParsed = relayEnvSchema.safeParse(process.env);
if (!relayEnvParsed.success) {
  console.error("Invalid relay env:", relayEnvParsed.error.flatten().fieldErrors);
  process.exit(1);
}
const relayEnv = relayEnvParsed.data;
const relayAuthDisabled = (() => {
  const raw = relayEnv.RELAY_AUTH_DISABLED?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
})();
const relayApiKey = relayEnv.RELAY_API_KEY?.trim() ?? "";

if (!relayAuthDisabled && relayApiKey.length < 8) {
  console.error("Invalid relay env: RELAY_API_KEY must be set (min 8 chars) when RELAY_AUTH_DISABLED=false");
  process.exit(1);
}

const nalogoConfigSchema = z.object({
  enabled: z.boolean().default(true),
  inn: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().max(200).nullable().optional(),
  timeoutSeconds: z.number().min(1).max(300).optional(),
  proxyUrl: z.string().max(2000).nullable().optional(),
  pythonBridgeEnabled: z.boolean().optional(),
  pythonBridgeOnly: z.boolean().optional(),
});

const receiptParamsSchema = z.object({
  name: z.string().min(1).max(300),
  amountRub: z.number().positive(),
  quantity: z.number().int().positive().max(100).optional(),
  clientPhone: z.string().max(100).nullable().optional(),
  clientName: z.string().max(300).nullable().optional(),
  clientInn: z.string().max(30).nullable().optional(),
});

const testBodySchema = z.object({
  config: nalogoConfigSchema,
});

const createBodySchema = z.object({
  config: nalogoConfigSchema,
  params: receiptParamsSchema,
});

function pickApiKey(req: express.Request): string {
  const bearer = req.header("Authorization")?.trim();
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return req.header("X-Relay-Key")?.trim() ?? "";
}

function toNalogoConfig(input: z.infer<typeof nalogoConfigSchema>): NalogoConfig {
  return {
    enabled: input.enabled,
    inn: input.inn,
    password: input.password,
    deviceId: input.deviceId ?? null,
    timeoutSeconds: input.timeoutSeconds,
    proxyUrl: input.proxyUrl ?? null,
    pythonBridgeEnabled: input.pythonBridgeEnabled,
    pythonBridgeOnly: input.pythonBridgeOnly,
  };
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: relayEnv.RELAY_CORS_ORIGIN === "*"
    ? true
    : relayEnv.RELAY_CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
}));
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "nalogo-relay" });
});

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (relayAuthDisabled) return next();
  const provided = pickApiKey(req);
  if (!provided || provided !== relayApiKey) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
});

app.post("/relay/nalogo/test", async (req, res) => {
  const parsed = testBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  }

  const result = await testNalogoConnection(toNalogoConfig(parsed.data.config));
  if (!result.ok) {
    return res.status(result.status).json(result);
  }
  return res.json(result);
});

app.post("/relay/nalogo/create", async (req, res) => {
  const parsed = createBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  }

  const result = await createNalogoReceipt(
    toNalogoConfig(parsed.data.config),
    parsed.data.params,
  );
  if ("receiptUuid" in result) {
    return res.json(result);
  }
  return res.status(result.status).json(result);
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[nalogo-relay] unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

const server = app.listen(relayEnv.RELAY_PORT, "0.0.0.0", () => {
  console.log(
    `NaloGO relay listening on port ${relayEnv.RELAY_PORT} (auth=${relayAuthDisabled ? "disabled" : "enabled"})`,
  );
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
