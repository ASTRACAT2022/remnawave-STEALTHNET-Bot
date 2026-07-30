/**
 * OlcRTC direct-link administration. The filename and Prisma model names are
 * legacy-only; OlcRTC links are issued locally without a Manager HTTP API.
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";

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

function isOlcRtcKey(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value.trim());
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
  roomId: z.string().min(1, "Укажите ID комнаты"),
  encryptionKey: z.string().refine(isOlcRtcKey, "Ключ должен содержать 64 шестнадцатеричных символа"),
  payload: z.string().max(1000).optional().nullable(),
  capacity: z.number().int().min(1).nullable().optional(),
});

wdttAdminRouter.post("/nodes", asyncRoute(async (req, res) => {
  const body = createWdttNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }

  const node = await prisma.wdttNode.create({
    data: {
      name: body.data.name,
      // Required legacy columns. Runtime code uses the explicit olcrtc_* fields below.
      apiUrl: body.data.roomId.trim(),
      apiKey: body.data.encryptionKey.trim(),
      publicHost: null,
      olcrtcProvider: body.data.provider,
      olcrtcTransport: body.data.transport,
      olcrtcRoomId: body.data.roomId.trim(),
      olcrtcKey: body.data.encryptionKey.trim(),
      olcrtcPayload: body.data.payload?.trim() || null,
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
      capacity: node.capacity,
      createdAt: node.createdAt.toISOString(),
    },
    instructions: "Нода добавлена. BillingStyle будет выдавать собственные ссылки olcrtc:// с этими параметрами.",
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
  capacity: z.number().int().min(1).nullable().optional(),
});

wdttAdminRouter.patch("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = updateWdttNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const node = await prisma.wdttNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });

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
    capacity: updated.capacity,
    subscriptionBaseUrl: updated.publicHost,
    updatedAt: updated.updatedAt.toISOString(),
  });
}));

// DELETE /api/admin/olcrtc/nodes/:id — удалить ноду
wdttAdminRouter.delete("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.wdttNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });
  await prisma.wdttNode.delete({ where: { id } });
  return res.status(204).send();
}));

// POST /api/admin/olcrtc/nodes/:id/test — тест связи с нодой
wdttAdminRouter.post("/nodes/:id/test", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.wdttNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });

  if (!node.olcrtcRoomId.trim() || !isOlcRtcKey(node.olcrtcKey)) {
    return res.status(400).json({ success: false, error: "Заполните room ID и 64-символьный ключ OlcRTC" });
  }
  await prisma.wdttNode.update({ where: { id }, data: { status: "ONLINE", lastSeenAt: new Date() } });
  return res.json({ success: true, nodeStatus: "ONLINE", data: { provider: node.olcrtcProvider, transport: node.olcrtcTransport } });
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
      node: { select: { id: true, name: true, publicHost: true, dtlsPort: true, wgPort: true, tunPort: true } },
      client: { select: { id: true, email: true, telegramUsername: true, telegramId: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({
    items: slots.map((s) => ({
      id: s.id,
      nodeId: s.nodeId,
      nodeName: s.node.name,
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
