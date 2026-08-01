/**
 * OlcRTC direct-link administration. The filename and Prisma model names are
 * legacy-only; OlcRTC links are issued locally, while the optional retained
 * WDTT-compatible node mode talks to its original HTTP API.
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { deprovisionOlcRtcSlot, migrateOlcRtcSlotsToNode } from "./wdtt-slots-activation.service.js";

export const wdttAdminRouter = Router();
wdttAdminRouter.use(requireAuth);
wdttAdminRouter.use(requireAdminSection);

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const providers = ["jitsi", "telemost", "wbstream"] as const;
const transports = ["datachannel", "vp8channel", "seichannel", "videochannel"] as const;
const provisionModes = ["STATIC", "PER_CLIENT", "WDTT_COMPAT"] as const;

function isOlcRtcKey(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value.trim());
}

/** Accept a full URL or the convenient IP:port form used in the panel. */
function normalizeProvisionerUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** WDTT uses its own API, even though its nodes are administered alongside
 * OlcRTC for backward-compatible tariffs and subscriptions. */
function normalizeWdttApiUrl(value: string): string | null {
  return normalizeProvisionerUrl(value);
}

// ——— OlcRTC link nodes ———

// GET /api/admin/olcrtc/nodes — список нод
wdttAdminRouter.get("/nodes", asyncRoute(async (_req, res) => {
  const nodes = await prisma.wdttNode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { slots: true } },
    },
  });
  return res.json({
    items: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      status: n.status,
      lastSeenAt: n.lastSeenAt?.toISOString() ?? null,
      publicHost: n.publicHost,
      apiUrl: n.apiUrl,
      provider: n.olcrtcProvider,
      transport: n.olcrtcTransport,
      roomId: n.olcrtcRoomId,
      encryptionKey: n.olcrtcKey,
      payload: n.olcrtcPayload,
      provisionMode: n.olcrtcProvisionMode,
      provisionerUrl: n.olcrtcProvisionerUrl,
      provisionerToken: n.olcrtcProvisionerToken,
      wdttApiUrl: n.olcrtcProvisionMode === "WDTT_COMPAT" ? n.apiUrl : null,
      dtlsPort: n.dtlsPort,
      wgPort: n.wgPort,
      tunPort: n.tunPort,
      capacity: n.capacity,
      currentSlots: n.currentSlots,
      slotsCount: n._count.slots,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}));

// POST /api/admin/olcrtc/nodes — создать ноду
const createWdttNodeSchema = z.object({
  name: z.string().min(1, "Укажите название ноды").max(200).transform((s) => s.trim()),
  provider: z.enum(providers),
  transport: z.enum(transports),
  roomId: z.string().optional().default(""),
  encryptionKey: z.string().optional().default(""),
  payload: z.string().max(1000).optional().nullable(),
  provisionMode: z.enum(provisionModes).default("STATIC"),
  provisionerUrl: z.string().max(500).optional().nullable(),
  provisionerToken: z.string().min(32, "Токен provisioner должен содержать не менее 32 символов").optional().nullable(),
  wdttApiUrl: z.string().max(500).optional().nullable(),
  wdttApiKey: z.string().min(16, "API-ключ WDTT должен содержать не менее 16 символов").optional().nullable(),
  capacity: z.number().int().min(1).nullable().optional(),
}).superRefine((value, context) => {
  if (value.provisionMode === "STATIC") {
    if (!value.roomId.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["roomId"], message: "Укажите ID комнаты" });
    if (!isOlcRtcKey(value.encryptionKey)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["encryptionKey"], message: "Ключ должен содержать 64 шестнадцатеричных символа" });
  } else if (value.provisionMode === "PER_CLIENT") {
    if (!value.provisionerUrl?.trim() || !normalizeProvisionerUrl(value.provisionerUrl)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["provisionerUrl"], message: "Укажите IP:порт или URL provisioner-сервиса" });
    if (!value.provisionerToken?.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["provisionerToken"], message: "Укажите токен provisioner-сервиса" });
  } else {
    if (!value.wdttApiUrl?.trim() || !normalizeWdttApiUrl(value.wdttApiUrl)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["wdttApiUrl"], message: "Укажите URL WDTT API" });
    if (!value.wdttApiKey?.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["wdttApiKey"], message: "Укажите API-ключ WDTT" });
  }
});

wdttAdminRouter.post("/nodes", asyncRoute(async (req, res) => {
  const body = createWdttNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: body.error.issues[0]?.message ?? "Проверьте параметры ноды", errors: body.error.flatten() });
  }

  const node = await prisma.wdttNode.create({
    data: {
      name: body.data.name,
      // Required legacy columns. Runtime code uses the explicit olcrtc_* fields below.
      apiUrl: body.data.provisionMode === "PER_CLIENT" ? normalizeProvisionerUrl(body.data.provisionerUrl!)! : body.data.provisionMode === "WDTT_COMPAT" ? normalizeWdttApiUrl(body.data.wdttApiUrl!)! : body.data.roomId.trim(),
      apiKey: body.data.provisionMode === "PER_CLIENT" ? body.data.provisionerToken!.trim() : body.data.provisionMode === "WDTT_COMPAT" ? body.data.wdttApiKey!.trim() : body.data.encryptionKey.trim(),
      publicHost: null,
      olcrtcProvider: body.data.provisionMode === "WDTT_COMPAT" ? "wdtt" : body.data.provider,
      olcrtcTransport: body.data.transport,
      olcrtcRoomId: body.data.roomId.trim(),
      olcrtcKey: body.data.encryptionKey.trim(),
      olcrtcPayload: body.data.payload?.trim() || null,
      olcrtcProvisionMode: body.data.provisionMode,
      olcrtcProvisionerUrl: body.data.provisionMode === "PER_CLIENT" ? normalizeProvisionerUrl(body.data.provisionerUrl!)! : null,
      olcrtcProvisionerToken: body.data.provisionMode === "PER_CLIENT" ? body.data.provisionerToken!.trim() : null,
      status: "OFFLINE",
      capacity: body.data.capacity ?? null,
    },
  });

  return res.status(201).json({
    node: {
      id: node.id,
      name: node.name,
      status: node.status,
      provider: node.olcrtcProvider,
      transport: node.olcrtcTransport,
      roomId: node.olcrtcRoomId,
      encryptionKey: node.olcrtcKey,
      payload: node.olcrtcPayload,
      provisionMode: node.olcrtcProvisionMode,
      provisionerUrl: node.olcrtcProvisionerUrl,
      capacity: node.capacity,
      createdAt: node.createdAt.toISOString(),
    },
    instructions: body.data.provisionMode === "PER_CLIENT"
      ? "Нода добавлена. После оплаты клиент сам выберет Telemost/WBStream и получит отдельную ссылку olcrtc://."
      : body.data.provisionMode === "WDTT_COMPAT"
        ? "WDTT-нода добавлена. После оплаты биллинг запросит у неё персональный ключ и выдаст ссылку wdtt://."
      : "Нода добавлена. BillingStyle будет выдавать собственные ссылки olcrtc:// с этими параметрами.",
  });
}));

// GET /api/admin/olcrtc/nodes/:id — одна нода с подписками
wdttAdminRouter.get("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.wdttNode.findUnique({
    where: { id },
    include: {
      slots: {
        include: {
          client: { select: { id: true, email: true, telegramUsername: true, telegramId: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!node) return res.status(404).json({ message: "Node not found" });
  return res.json({
    id: node.id,
    name: node.name,
    status: node.status,
    lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
    publicHost: node.publicHost,
    apiUrl: node.apiUrl,
    apiKey: node.apiKey,
    provider: node.olcrtcProvider,
    transport: node.olcrtcTransport,
    roomId: node.olcrtcRoomId,
    encryptionKey: node.olcrtcKey,
    payload: node.olcrtcPayload,
    provisionMode: node.olcrtcProvisionMode,
    provisionerUrl: node.olcrtcProvisionerUrl,
    provisionerToken: node.olcrtcProvisionerToken,
    wdttApiUrl: node.olcrtcProvisionMode === "WDTT_COMPAT" ? node.apiUrl : null,
    dtlsPort: node.dtlsPort,
    wgPort: node.wgPort,
    tunPort: node.tunPort,
    capacity: node.capacity,
    currentSlots: node.currentSlots,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    slots: node.slots.map((s) => ({
      id: s.id,
      password: s.password,
      vkHash: s.vkHash,
      wdttLink: s.wdttLink,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      status: s.status,
      client: s.client,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

// PATCH /api/admin/olcrtc/nodes/:id — обновить ноду
const updateWdttNodeSchema = z.object({
  name: z.string().max(200).optional(),
  status: z.enum(["ONLINE", "OFFLINE", "DISABLED"]).optional(),
  provider: z.enum(providers).optional(),
  transport: z.enum(transports).optional(),
  roomId: z.string().min(1).optional(),
  encryptionKey: z.string().refine(isOlcRtcKey, "Ключ должен содержать 64 шестнадцатеричных символа").optional(),
  payload: z.string().max(1000).nullable().optional(),
  provisionMode: z.enum(provisionModes).optional(),
  provisionerUrl: z.string().max(500).nullable().optional(),
  provisionerToken: z.string().min(32).nullable().optional(),
  wdttApiUrl: z.string().max(500).nullable().optional(),
  wdttApiKey: z.string().min(16).nullable().optional(),
  capacity: z.number().int().min(1).nullable().optional(),
});

wdttAdminRouter.patch("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = updateWdttNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: body.error.issues[0]?.message ?? "Проверьте параметры ноды", errors: body.error.flatten() });
  }
  const node = await prisma.wdttNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });
  if (body.data.provisionerUrl && !normalizeProvisionerUrl(body.data.provisionerUrl)) {
    return res.status(400).json({ message: "Invalid input", errors: { fieldErrors: { provisionerUrl: ["Укажите IP:порт или URL provisioner-сервиса"] }, formErrors: [] } });
  }
  if (body.data.wdttApiUrl && !normalizeWdttApiUrl(body.data.wdttApiUrl)) {
    return res.status(400).json({ message: "Invalid input", errors: { fieldErrors: { wdttApiUrl: ["Укажите URL WDTT API"] }, formErrors: [] } });
  }

  const updated = await prisma.wdttNode.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined && { name: body.data.name }),
      ...(body.data.status !== undefined && { status: body.data.status }),
      ...(body.data.provider !== undefined && { olcrtcProvider: body.data.provider }),
      ...(body.data.transport !== undefined && { olcrtcTransport: body.data.transport }),
      ...(body.data.roomId !== undefined && { olcrtcRoomId: body.data.roomId.trim(), apiUrl: body.data.roomId.trim() }),
      ...(body.data.encryptionKey !== undefined && { olcrtcKey: body.data.encryptionKey.trim(), apiKey: body.data.encryptionKey.trim() }),
      ...(body.data.payload !== undefined && { olcrtcPayload: body.data.payload?.trim() || null }),
      ...(body.data.provisionMode !== undefined && { olcrtcProvisionMode: body.data.provisionMode }),
      ...(body.data.provisionerUrl !== undefined && { olcrtcProvisionerUrl: body.data.provisionerUrl ? normalizeProvisionerUrl(body.data.provisionerUrl) : null, apiUrl: body.data.provisionerUrl ? normalizeProvisionerUrl(body.data.provisionerUrl)! : node.apiUrl }),
      ...(body.data.provisionerToken !== undefined && { olcrtcProvisionerToken: body.data.provisionerToken?.trim() || null, apiKey: body.data.provisionerToken?.trim() || node.apiKey }),
      ...(body.data.wdttApiUrl !== undefined && { apiUrl: body.data.wdttApiUrl ? normalizeWdttApiUrl(body.data.wdttApiUrl)! : node.apiUrl }),
      ...(body.data.wdttApiKey !== undefined && { apiKey: body.data.wdttApiKey?.trim() || node.apiKey }),
      ...(body.data.capacity !== undefined && { capacity: body.data.capacity }),
    },
  });
  return res.json({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    provider: updated.olcrtcProvider,
    transport: updated.olcrtcTransport,
    roomId: updated.olcrtcRoomId,
    encryptionKey: updated.olcrtcKey,
    payload: updated.olcrtcPayload,
    provisionMode: updated.olcrtcProvisionMode,
    provisionerUrl: updated.olcrtcProvisionerUrl,
    wdttApiUrl: updated.olcrtcProvisionMode === "WDTT_COMPAT" ? updated.apiUrl : null,
    capacity: updated.capacity,
    subscriptionBaseUrl: updated.publicHost,
    updatedAt: updated.updatedAt.toISOString(),
  });
}));

// DELETE /api/admin/olcrtc/nodes/:id — удалить ноду
wdttAdminRouter.delete("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.wdttNode.findUnique({
    where: { id },
    include: {
      slots: {
        where: { status: { in: ["ACTIVE", "PENDING_CONFIG"] } },
        select: { id: true, status: true, password: true },
      },
    },
  });
  if (!node) return res.status(404).json({ message: "Node not found" });
  for (const slot of node.slots) {
    if (!await deprovisionOlcRtcSlot({ id: slot.id, status: slot.status, password: slot.password, node })) {
      return res.status(502).json({ message: "Не удалось остановить личный OlcRTC-сервер; нода не удалена" });
    }
  }
  await prisma.wdttNode.delete({ where: { id } });
  return res.status(204).send();
}));

// POST /api/admin/olcrtc/nodes/:id/test — тест связи с нодой
wdttAdminRouter.post("/nodes/:id/test", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.wdttNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });

  if (node.olcrtcProvisionMode === "PER_CLIENT") {
    if (!node.olcrtcProvisionerUrl || !node.olcrtcProvisionerToken) {
      return res.status(400).json({ success: false, error: "Заполните URL и токен provisioner-сервиса" });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const health = await fetch(`${node.olcrtcProvisionerUrl.replace(/\/+$/, "")}/healthz`, {
        headers: { Authorization: `Bearer ${node.olcrtcProvisionerToken}` }, signal: controller.signal,
      });
      if (!health.ok) return res.status(502).json({ success: false, error: `Provisioner вернул HTTP ${health.status}` });
    } catch {
      return res.status(502).json({ success: false, error: "Provisioner недоступен" });
    } finally {
      clearTimeout(timeout);
    }
  } else if (node.olcrtcProvisionMode === "WDTT_COMPAT") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const health = await fetch(`${node.apiUrl.replace(/\/+$/, "")}/api/health`, { headers: { "X-API-Key": node.apiKey }, signal: controller.signal });
      if (!health.ok) return res.status(502).json({ success: false, error: `WDTT API вернул HTTP ${health.status}` });
    } catch {
      return res.status(502).json({ success: false, error: "WDTT API недоступен" });
    } finally {
      clearTimeout(timeout);
    }
  } else if (!node.olcrtcRoomId.trim() || !isOlcRtcKey(node.olcrtcKey)) {
    return res.status(400).json({ success: false, error: "Заполните room ID и 64-символьный ключ OlcRTC" });
  }
  await prisma.wdttNode.update({ where: { id }, data: { status: "ONLINE", lastSeenAt: new Date() } });
  return res.json({ success: true, nodeStatus: "ONLINE", data: { provider: node.olcrtcProvider, transport: node.olcrtcTransport, provisionMode: node.olcrtcProvisionMode } });
}));

const migrateSlotsSchema = z.object({
  targetNodeId: z.string().min(1),
  slotIds: z.array(z.string().min(1)).min(1, "Выберите хотя бы одно подключение").max(200, "За один запуск можно перенести не более 200 подключений"),
});

// POST /api/admin/olcrtc/slots/migrate — no payment is created or changed.
// A slot switches only after its new personal container is confirmed running.
wdttAdminRouter.post("/slots/migrate", asyncRoute(async (req, res) => {
  const body = migrateSlotsSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Проверьте параметры миграции", errors: body.error.flatten() });
  try {
    const result = await migrateOlcRtcSlotsToNode(body.data);
    return res.json({ success: result.failed.length === 0, ...result });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Не удалось начать миграцию" });
  }
}));

// ——— WDTT Категории ———

const wdttCategoryIdSchema = z.object({ id: z.string().min(1) });
const createWdttCategorySchema = z.object({ name: z.string().min(1).max(200), sortOrder: z.number().int().optional() });
const updateWdttCategorySchema = z.object({ name: z.string().min(1).max(200).optional(), sortOrder: z.number().int().optional() });

wdttAdminRouter.get("/categories", asyncRoute(async (_req, res) => {
  const list = await prisma.wdttCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      tariffs: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { assignedNodes: { select: { nodeId: true } } },
      },
    },
  });
  return res.json({
    items: list.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      tariffs: c.tariffs.map((t) => ({
        id: t.id,
        categoryId: t.categoryId,
        name: t.name,
        proxyCount: t.proxyCount,
        durationDays: t.durationDays,
        trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
        price: t.price,
        currency: t.currency,
        sortOrder: t.sortOrder,
        enabled: t.enabled,
        nodeIds: t.assignedNodes.map((a) => a.nodeId),
      })),
    })),
  });
}));

wdttAdminRouter.post("/categories", asyncRoute(async (req, res) => {
  const body = createWdttCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const created = await prisma.wdttCategory.create({
    data: { name: body.data.name.trim(), sortOrder: body.data.sortOrder ?? 0 },
  });
  return res.status(201).json({ id: created.id, name: created.name, sortOrder: created.sortOrder });
}));

wdttAdminRouter.patch("/categories/:id", asyncRoute(async (req, res) => {
  const id = wdttCategoryIdSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const body = updateWdttCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const updated = await prisma.wdttCategory.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined && { name: body.data.name.trim() }),
      ...(body.data.sortOrder !== undefined && { sortOrder: body.data.sortOrder }),
    },
  });
  return res.json(updated);
}));

wdttAdminRouter.delete("/categories/:id", asyncRoute(async (req, res) => {
  const id = wdttCategoryIdSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  await prisma.wdttCategory.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— WDTT Тарифы ———

const createWdttTariffSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(200),
  proxyCount: z.number().int().min(1),
  durationDays: z.number().int().min(1),
  trafficLimitBytes: z.union([z.bigint(), z.string(), z.number()]).nullable().optional(),
  price: z.number().min(0),
  currency: z.string().min(1).max(10),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  nodeIds: z.array(z.string().min(1)).optional(),
});

const updateWdttTariffSchema = createWdttTariffSchema.partial();

wdttAdminRouter.get("/tariffs", asyncRoute(async (req, res) => {
  const categoryId = req.query.categoryId as string | undefined;
  const list = await prisma.wdttTariff.findMany({
    where: categoryId ? { categoryId } : {},
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { category: { select: { name: true } } },
  });
  return res.json({
    items: list.map((t) => ({
      id: t.id,
      categoryId: t.categoryId,
      categoryName: t.category.name,
      name: t.name,
      proxyCount: t.proxyCount,
      durationDays: t.durationDays,
      trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
      price: t.price,
      currency: t.currency,
      sortOrder: t.sortOrder,
      enabled: t.enabled,
    })),
  });
}));

wdttAdminRouter.post("/tariffs", asyncRoute(async (req, res) => {
  const body = createWdttTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const cat = await prisma.wdttCategory.findUnique({ where: { id: body.data.categoryId } });
  if (!cat) return res.status(400).json({ message: "Категория не найдена" });
  const trafficBytes = body.data.trafficLimitBytes != null
    ? BigInt(typeof body.data.trafficLimitBytes === "string" ? body.data.trafficLimitBytes : body.data.trafficLimitBytes)
    : null;
  const created = await prisma.$transaction(async (tx) => {
    const tariff = await tx.wdttTariff.create({
      data: {
        categoryId: body.data.categoryId,
        name: body.data.name.trim(),
        proxyCount: body.data.proxyCount,
        durationDays: body.data.durationDays,
        trafficLimitBytes: trafficBytes,
        price: body.data.price,
        currency: body.data.currency.toUpperCase(),
        sortOrder: body.data.sortOrder ?? 0,
        enabled: body.data.enabled ?? true,
      },
    });
    const nodeIds = body.data.nodeIds ?? [];
    if (nodeIds.length > 0) {
      await tx.wdttTariffNode.createMany({
        data: nodeIds.map((nodeId) => ({ tariffId: tariff.id, nodeId })),
        skipDuplicates: true,
      });
    }
    return tariff;
  });
  return res.status(201).json({
    id: created.id,
    categoryId: created.categoryId,
    name: created.name,
    proxyCount: created.proxyCount,
    durationDays: created.durationDays,
    trafficLimitBytes: created.trafficLimitBytes?.toString() ?? null,
    price: created.price,
    currency: created.currency,
    sortOrder: created.sortOrder,
    enabled: created.enabled,
  });
}));

wdttAdminRouter.patch("/tariffs/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const body = updateWdttTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const data: Record<string, unknown> = {};
  if (body.data.name !== undefined) data.name = body.data.name.trim();
  if (body.data.categoryId !== undefined) data.categoryId = body.data.categoryId;
  if (body.data.proxyCount !== undefined) data.proxyCount = body.data.proxyCount;
  if (body.data.durationDays !== undefined) data.durationDays = body.data.durationDays;
  if (body.data.trafficLimitBytes !== undefined) {
    data.trafficLimitBytes = body.data.trafficLimitBytes != null
      ? BigInt(typeof body.data.trafficLimitBytes === "string" ? body.data.trafficLimitBytes : body.data.trafficLimitBytes)
      : null;
  }
  if (body.data.price !== undefined) data.price = body.data.price;
  if (body.data.currency !== undefined) data.currency = body.data.currency.toUpperCase();
  if (body.data.sortOrder !== undefined) data.sortOrder = body.data.sortOrder;
  if (body.data.enabled !== undefined) data.enabled = body.data.enabled;
  const updated = await prisma.$transaction(async (tx) => {
    const tariff = await tx.wdttTariff.update({ where: { id }, data: data as object });
    if (body.data.nodeIds !== undefined) {
      await tx.wdttTariffNode.deleteMany({ where: { tariffId: id } });
      const nodeIds = body.data.nodeIds;
      if (nodeIds && nodeIds.length > 0) {
        await tx.wdttTariffNode.createMany({
          data: nodeIds.map((nodeId: string) => ({ tariffId: id, nodeId })),
          skipDuplicates: true,
        });
      }
    }
    return tariff;
  });
  return res.json({
    id: updated.id,
    categoryId: updated.categoryId,
    name: updated.name,
    proxyCount: updated.proxyCount,
    durationDays: updated.durationDays,
    trafficLimitBytes: updated.trafficLimitBytes?.toString() ?? null,
    price: updated.price,
    currency: updated.currency,
    sortOrder: updated.sortOrder,
    enabled: updated.enabled,
  });
}));

wdttAdminRouter.delete("/tariffs/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  await prisma.wdttTariff.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— OlcRTC subscriptions ———

// GET /api/admin/olcrtc/slots — список всех подписок
wdttAdminRouter.get("/slots", asyncRoute(async (_req, res) => {
  const slots = await prisma.wdttSlot.findMany({
    include: {
      node: { select: { id: true, name: true, publicHost: true, dtlsPort: true, wgPort: true, tunPort: true, olcrtcProvisionMode: true } },
      client: { select: { id: true, email: true, telegramUsername: true, telegramId: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({
    items: slots.map((s) => ({
      id: s.id,
      nodeId: s.nodeId,
      nodeName: s.node.name,
      nodeProvisionMode: s.node.olcrtcProvisionMode,
      publicHost: s.node.publicHost,
      dtlsPort: s.node.dtlsPort,
      wgPort: s.node.wgPort,
      tunPort: s.node.tunPort,
      clientId: s.clientId,
      clientEmail: s.client.email,
      clientTelegram: s.client.telegramUsername,
      clientTelegramId: s.client.telegramId,
      password: s.password,
      vkHash: s.vkHash,
      wdttLink: s.wdttLink,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      status: s.status,
      revokeReason: s.revokeReason,
      revokedAt: s.revokedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

// PATCH /api/admin/olcrtc/slots/:id — изменить подписку
const updateWdttSlotSchema = z.object({
  status: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]).optional(),
  expiresAt: z.string().optional(),
});

wdttAdminRouter.patch("/slots/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = updateWdttSlotSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const slot = await prisma.wdttSlot.findUnique({ where: { id } });
  if (!slot) return res.status(404).json({ message: "Slot not found" });
  if (body.data.status && ["EXPIRED", "REVOKED"].includes(body.data.status) && (slot.status === "ACTIVE" || slot.status === "PENDING_CONFIG")) {
    const fullSlot = await prisma.wdttSlot.findUnique({
      where: { id },
      include: { node: { select: { olcrtcProvisionMode: true, olcrtcProvisionerUrl: true, olcrtcProvisionerToken: true, apiUrl: true, apiKey: true } } },
    });
    if (fullSlot && !await deprovisionOlcRtcSlot(fullSlot)) {
      return res.status(502).json({ message: "Не удалось остановить личный OlcRTC-сервер; повторите операцию" });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.wdttSlot.update({ where: { id }, data: { status: body.data.status, revokedAt: new Date(), revokeReason: "manual" } });
      await tx.wdttNode.update({ where: { id: slot.nodeId }, data: { currentSlots: { decrement: 1 } } });
      return value;
    });
    return res.json({ id: updated.id, status: updated.status, expiresAt: updated.expiresAt.toISOString() });
  }
  const data: Record<string, unknown> = {};
  if (body.data.status !== undefined) data.status = body.data.status;
  if (body.data.expiresAt !== undefined) data.expiresAt = new Date(body.data.expiresAt);
  const updated = await prisma.wdttSlot.update({ where: { id }, data: data as object });
  return res.json({
    id: updated.id,
    status: updated.status,
    expiresAt: updated.expiresAt.toISOString(),
  });
}));

// DELETE /api/admin/olcrtc/slots/:id — удалить подписку
wdttAdminRouter.delete("/slots/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const slot = await prisma.wdttSlot.findUnique({
    where: { id },
    include: { node: true },
  });
  if (!slot) return res.status(404).json({ message: "Slot not found" });
  if (!await deprovisionOlcRtcSlot(slot)) {
    return res.status(502).json({ message: "Не удалось остановить личный OlcRTC-сервер; повторите операцию" });
  }

  // Уменьшаем currentSlots на ноде
  await prisma.wdttNode.update({
    where: { id: slot.nodeId },
    data: { currentSlots: { decrement: 1 } },
  });

  await prisma.wdttSlot.delete({ where: { id } });
  return res.status(204).send();
}));

// POST /api/admin/olcrtc/slots/:id/revoke — отозвать доступ вручную
wdttAdminRouter.post("/slots/:id/revoke", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const slot = await prisma.wdttSlot.findUnique({
    where: { id },
    include: { node: true },
  });
  if (!slot) return res.status(404).json({ message: "Slot not found" });
  if (slot.status !== "ACTIVE" && slot.status !== "PENDING_CONFIG") {
    return res.status(409).json({ message: "Доступ уже отозван или истёк" });
  }
  if (!await deprovisionOlcRtcSlot(slot)) {
    return res.status(502).json({ message: "Не удалось остановить личный OlcRTC-сервер; повторите операцию" });
  }

  // Обновляем статус слота
  await prisma.wdttSlot.update({
    where: { id },
    data: { status: "REVOKED", revokeReason: "manual", revokedAt: new Date() },
  });

  // Уменьшаем currentSlots
  await prisma.wdttNode.update({
    where: { id: slot.nodeId },
    data: { currentSlots: { decrement: 1 } },
  });

  return res.json({ success: true, message: "Доступ отозван" });
}));

// GET /api/admin/olcrtc/slots/export — экспорт подписок в CSV
wdttAdminRouter.get("/slots/export", asyncRoute(async (req, res) => {
  const format = (req.query.format as string) || "csv";
  if (format !== "csv") {
    return res.status(400).json({ message: "Supported format: csv" });
  }
  const slots = await prisma.wdttSlot.findMany({
    include: {
      node: { select: { id: true, name: true, publicHost: true, dtlsPort: true, wgPort: true, tunPort: true } },
      client: { select: { id: true, email: true, telegramUsername: true } },
    },
    orderBy: [{ nodeId: "asc" }, { createdAt: "desc" }],
  });
  const header = "nodeId;nodeName;host;dtlsPort;wgPort;tunPort;slotId;password;vkHash;clientId;email;telegram;status;expiresAt;trafficLimitBytes;trafficUsedBytes;createdAt";
  const rows = slots.map((s) => {
    const escape = (v: string | null | undefined) =>
      v == null ? "" : String(v).replace(/;/g, ",").replace(/\n/g, " ");
    return [
      s.node.id,
      escape(s.node.name),
      escape(s.node.publicHost),
      s.node.dtlsPort,
      s.node.wgPort,
      s.node.tunPort,
      s.id,
      escape(s.password),
      escape(s.vkHash),
      s.client.id,
      escape(s.client.email),
      escape(s.client.telegramUsername),
      s.status,
      s.expiresAt.toISOString(),
      s.trafficLimitBytes?.toString() ?? "",
      s.trafficUsedBytes.toString(),
      s.createdAt.toISOString(),
    ].join(";");
  });
  const csv = [header, ...rows].join("\n");
  const bom = "\uFEFF";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=wdtt-slots.csv");
  return res.send(bom + csv);
}));
