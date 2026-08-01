import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireClientAuth } from "../client/client.middleware.js";
import { configureOlcRtcSlotForClient, recoverWdttSlotsForClient, reissueOlcRtcSlotForClient, restoreOlcRtcSlotBackupForClient } from "./wdtt-slots-activation.service.js";

type AuthRequest = express.Request & { clientId: string };

export const wdttClientRouter = Router();
wdttClientRouter.use(requireClientAuth);

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

wdttClientRouter.get("/slots", asyncRoute(async (req, res) => {
  const clientId = (req as AuthRequest).clientId;
  const slots = await prisma.wdttSlot.findMany({
    where: { clientId },
    include: {
      node: { select: { name: true, publicHost: true, dtlsPort: true, wgPort: true, tunPort: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({
    items: slots.map((s) => ({
      id: s.id,
      nodeName: s.node.name,
      publicHost: s.node.publicHost,
      dtlsPort: s.node.dtlsPort,
      wgPort: s.node.wgPort,
      tunPort: s.node.tunPort,
      password: s.password,
      vkHash: s.vkHash,
      wdttLink: s.wdttLink,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      status: s.status,
      requiresConfiguration: s.status === "PENDING_CONFIG",
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

const configureSlotSchema = z.object({
  provider: z.enum(["telemost", "wbstream"]),
  roomId: z.string().trim().min(1, "Вставьте ссылку или ID комнаты").max(1000),
});

// POST /api/client/olcrtc/slots/:id/configure — client selects carrier and their room.
wdttClientRouter.post("/slots/:id/configure", asyncRoute(async (req, res) => {
  const body = configureSlotSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Проверьте данные комнаты", errors: body.error.flatten() });
  try {
    const result = await configureOlcRtcSlotForClient({
      clientId: (req as AuthRequest).clientId,
      slotId: req.params.id,
      provider: body.data.provider,
      roomId: body.data.roomId,
    });
    return res.json({ success: true, wdttLink: result.link });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Не удалось настроить подключение" });
  }
}));

wdttClientRouter.get("/slots/:id/backups", asyncRoute(async (req, res) => {
  const clientId = (req as AuthRequest).clientId;
  const slot = await prisma.wdttSlot.findFirst({ where: { id: req.params.id, clientId }, select: { id: true } });
  if (!slot) return res.status(404).json({ message: "Подписка не найдена" });
  const items = await prisma.wdttSlotBackup.findMany({ where: { slotId: slot.id, clientId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, reason: true, provider: true, roomId: true, createdAt: true } });
  return res.json({ items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) });
}));

wdttClientRouter.post("/slots/:id/backups/:backupId/restore", asyncRoute(async (req, res) => {
  try {
    const result = await restoreOlcRtcSlotBackupForClient({ clientId: (req as AuthRequest).clientId, slotId: req.params.id, backupId: req.params.backupId });
    return res.json({ success: true, wdttLink: result.link });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Не удалось восстановить резервную копию" });
  }
}));

// POST /api/client/olcrtc/slots/:id/reissue — rotates a personal server and link.
wdttClientRouter.post("/slots/:id/reissue", asyncRoute(async (req, res) => {
  try {
    await reissueOlcRtcSlotForClient({ clientId: (req as AuthRequest).clientId, slotId: req.params.id });
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Не удалось перевыпустить ссылку" });
  }
}));

// POST /api/client/olcrtc/slots/recover — creates a missing slot for an already paid purchase.
wdttClientRouter.post("/slots/recover", asyncRoute(async (req, res) => {
  const result = await recoverWdttSlotsForClient((req as AuthRequest).clientId);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ success: true, slotsCreated: result.slotsCreated });
}));

wdttClientRouter.get("/tariffs", asyncRoute(async (_req, res) => {
  const categories = await prisma.wdttCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      tariffs: {
        where: { enabled: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  return res.json({
    items: categories.map((c) => ({
      id: c.id,
      name: c.name,
      tariffs: c.tariffs.map((t) => ({
        id: t.id,
        name: t.name,
        proxyCount: t.proxyCount,
        durationDays: t.durationDays,
        trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
        price: t.price,
        currency: t.currency,
      })),
    })),
  });
}));
