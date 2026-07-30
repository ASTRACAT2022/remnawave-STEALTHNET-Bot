import { randomBytes } from "crypto";
import { prisma } from "../../db.js";

/**
 * OlcRTC direct-link activation. The legacy file/table names only preserve
 * historical WDTT payment data; no WDTT or OlcRTC Manager HTTP API is called.
 */
export type CreateWdttSlotsResult =
  | { ok: true; slotsCreated: number; slotIds: string[] }
  | { ok: false; error: string; status: number };

type OlcRtcLinkNode = {
  id: string;
  name: string;
  status: string;
  capacity: number | null;
  currentSlots: number;
  olcrtcProvider: string;
  olcrtcTransport: string;
  olcrtcRoomId: string;
  olcrtcKey: string;
  olcrtcPayload: string | null;
};

function accessCode(): string {
  return `olc-${randomBytes(12).toString("hex")}`;
}

function linkComment(name: string): string {
  return name.replace(/[?$@#<>]/g, " ").trim() || "OlcRTC";
}

/** Builds the documented client convention: olcrtc://<auth>?<transport>@<room>#<key>$<comment>. */
export function buildOlcRtcLink(node: OlcRtcLinkNode): string {
  const payload = node.olcrtcPayload?.trim();
  const payloadPart = payload ? `<${payload}>` : "";
  return `olcrtc://${node.olcrtcProvider}?${node.olcrtcTransport}${payloadPart}@${node.olcrtcRoomId}#${node.olcrtcKey}$${linkComment(node.name)}`;
}

export async function createWdttSlotsByPaymentId(paymentId: string): Promise<CreateWdttSlotsResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId }, select: { wdttTariffId: true, clientId: true },
  });
  if (!payment?.wdttTariffId) return { ok: false, error: "Тариф OlcRTC не привязан к платежу", status: 400 };

  const tariff = await prisma.wdttTariff.findUnique({ where: { id: payment.wdttTariffId } });
  if (!tariff || !tariff.enabled) return { ok: false, error: "Тариф OlcRTC не найден или отключён", status: 404 };

  const assignedNodeIds = (await prisma.wdttTariffNode.findMany({
    where: { tariffId: tariff.id }, select: { nodeId: true },
  })).map((row) => row.nodeId);
  const nodes = await prisma.wdttNode.findMany({
    where: assignedNodeIds.length ? { id: { in: assignedNodeIds }, status: "ONLINE" } : { status: "ONLINE" },
    select: {
      id: true, name: true, status: true, capacity: true, currentSlots: true,
      olcrtcProvider: true, olcrtcTransport: true, olcrtcRoomId: true, olcrtcKey: true, olcrtcPayload: true,
    },
    orderBy: { updatedAt: "asc" },
  });
  const validNodes = nodes.filter((node) => node.olcrtcRoomId.trim() && /^[a-f0-9]{64}$/i.test(node.olcrtcKey));
  if (!validNodes.length) return { ok: false, error: "Нет настроенных OlcRTC нод. Проверьте room ID, ключ и статус ноды.", status: 503 };

  const expiresAt = new Date(Date.now() + tariff.durationDays * 86_400_000);
  const usage = new Map(validNodes.map((node) => [node.id, node.currentSlots]));
  const results: { nodeId: string; code: string; link: string }[] = [];
  for (let index = 0; index < tariff.proxyCount; index++) {
    const node = validNodes.find((candidate) => (usage.get(candidate.id) ?? 0) < (candidate.capacity ?? Infinity));
    if (!node) break;
    results.push({ nodeId: node.id, code: accessCode(), link: buildOlcRtcLink(node) });
    usage.set(node.id, (usage.get(node.id) ?? 0) + 1);
  }
  if (!results.length) return { ok: false, error: "На OlcRTC нодах нет свободных мест", status: 503 };

  const created = await prisma.$transaction(results.map((result) => prisma.wdttSlot.create({
    data: {
      nodeId: result.nodeId,
      clientId: payment.clientId,
      tariffId: tariff.id,
      paymentId,
      password: result.code,
      vkHash: "olcrtc",
      wdttLink: result.link,
      expiresAt,
      trafficLimitBytes: tariff.trafficLimitBytes,
      status: "ACTIVE",
    },
  })));
  await Promise.all(results.map((result) => prisma.wdttNode.update({
    where: { id: result.nodeId }, data: { currentSlots: { increment: 1 } },
  })));
  return { ok: true, slotsCreated: created.length, slotIds: created.map((slot) => slot.id) };
}
