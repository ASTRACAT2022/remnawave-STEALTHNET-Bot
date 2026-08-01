import { randomBytes } from "crypto";
import { prisma } from "../../db.js";

/**
 * OlcRTC activation. Legacy WDTT names are retained only to keep old payment
 * records compatible. A PER_CLIENT node creates one isolated server container
 * per paid slot, while STATIC nodes retain the former shared-link behaviour.
 */
export type CreateWdttSlotsResult =
  | { ok: true; slotsCreated: number; slotIds: string[] }
  | { ok: false; error: string; status: number };

export type RecoverWdttSlotsResult =
  | { ok: true; slotsCreated: number; slotIds: string[] }
  | { ok: false; error: string; status: number };

type OlcRtcLinkNode = {
  id: string;
  name: string;
  capacity: number | null;
  currentSlots: number;
  olcrtcProvider: string;
  olcrtcTransport: string;
  olcrtcRoomId: string;
  olcrtcKey: string;
  olcrtcPayload: string | null;
  olcrtcProvisionMode: string;
  olcrtcProvisionerUrl: string | null;
  olcrtcProvisionerToken: string | null;
};

type PersonalSlot = {
  id: string;
  status: string;
  node: Pick<OlcRtcLinkNode, "olcrtcProvisionMode" | "olcrtcProvisionerUrl" | "olcrtcProvisionerToken">;
};

const PERSONAL_VP8_PAYLOAD = "vp8-fps=30&vp8-batch=64";

function accessCode(): string {
  return `olc-${randomBytes(12).toString("hex")}`;
}

function encryptionKey(): string {
  return randomBytes(32).toString("hex");
}

function linkComment(name: string): string {
  return name.replace(/[?$@#<>]/g, " ").trim() || "OlcRTC";
}

/** Builds: olcrtc://<provider>?<transport><payload>@<room>#<key>$<comment>. */
export function buildOlcRtcLink(node: Pick<OlcRtcLinkNode, "name" | "olcrtcProvider" | "olcrtcTransport" | "olcrtcRoomId" | "olcrtcKey" | "olcrtcPayload">): string {
  const payload = node.olcrtcPayload?.trim();
  const payloadPart = payload ? `<${payload}>` : "";
  return `olcrtc://${node.olcrtcProvider}?${node.olcrtcTransport}${payloadPart}@${node.olcrtcRoomId}#${node.olcrtcKey}$${linkComment(node.name)}`;
}

function isStaticNode(node: OlcRtcLinkNode): boolean {
  return node.olcrtcProvisionMode !== "PER_CLIENT";
}

function isValidNode(node: OlcRtcLinkNode): boolean {
  if (isStaticNode(node)) return Boolean(node.olcrtcRoomId.trim()) && /^[a-f0-9]{64}$/i.test(node.olcrtcKey);
  return Boolean(node.olcrtcProvisionerUrl?.trim() && node.olcrtcProvisionerToken?.trim());
}

function provisionerUrl(base: string, path: string): string {
  const normalized = /^https?:\/\//i.test(base) ? base : `http://${base}`;
  return `${normalized.replace(/\/+$/, "")}${path}`;
}

async function provisionerRequest(node: PersonalSlot["node"], path: string, init: RequestInit): Promise<Response> {
  if (!node.olcrtcProvisionerUrl || !node.olcrtcProvisionerToken) {
    throw new Error("На ноде не настроен сервис персональных OlcRTC-серверов");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    try {
      return await fetch(provisionerUrl(node.olcrtcProvisionerUrl, path), {
        ...init,
        headers: { Authorization: `Bearer ${node.olcrtcProvisionerToken}`, "Content-Type": "application/json", ...init.headers },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Сервис выдачи личных OlcRTC-серверов не ответил за 15 секунд");
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function describeProvisionerFailure(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as { message?: unknown } | null;
  return typeof data?.message === "string" ? data.message : `HTTP ${response.status}`;
}

/** Removes the per-slot server. Returns false so callers can retry safely. */
export async function deprovisionOlcRtcSlot(slot: PersonalSlot): Promise<boolean> {
  if (slot.node.olcrtcProvisionMode !== "PER_CLIENT") return true;
  try {
    const response = await provisionerRequest(slot.node, `/v1/instances/${encodeURIComponent(slot.id)}`, { method: "DELETE" });
    return response.ok || response.status === 404;
  } catch (error) {
    console.error(`[OlcRTC] unable to deprovision ${slot.id}`, error);
    return false;
  }
}

export async function configureOlcRtcSlotForClient(input: { clientId: string; slotId: string; provider: "telemost" | "wbstream"; roomId: string }): Promise<{ link: string }> {
  const roomId = input.roomId.trim();
  const slot = await prisma.wdttSlot.findFirst({
    where: { id: input.slotId, clientId: input.clientId },
    include: { node: { select: { name: true, olcrtcProvisionMode: true, olcrtcProvisionerUrl: true, olcrtcProvisionerToken: true } } },
  });
  if (!slot) throw new Error("Подписка не найдена");
  if (slot.status !== "PENDING_CONFIG") throw new Error("Эта подписка уже настроена или недоступна");
  if (slot.expiresAt <= new Date()) throw new Error("Срок действия подписки уже закончился");
  if (slot.node.olcrtcProvisionMode !== "PER_CLIENT") throw new Error("Эта нода не поддерживает личную настройку");
  if (!roomId || roomId.length > 1000) throw new Error("Вставьте ссылку или ID комнаты");

  const key = encryptionKey();
  const response = await provisionerRequest(slot.node, "/v1/instances", {
    method: "POST",
    body: JSON.stringify({ subscriptionId: slot.id, provider: input.provider, roomId, encryptionKey: key }),
  });
  if (!response.ok) {
    const reason = await describeProvisionerFailure(response);
    throw new Error(`Не удалось запустить личный сервер: ${reason}`);
  }

  const link = buildOlcRtcLink({
    name: slot.node.name,
    olcrtcProvider: input.provider,
    olcrtcTransport: "vp8channel",
    olcrtcRoomId: roomId,
    olcrtcKey: key,
    olcrtcPayload: PERSONAL_VP8_PAYLOAD,
  });
  try {
    await prisma.$transaction([
      prisma.wdttSlot.update({ where: { id: slot.id }, data: { status: "ACTIVE", vkHash: "olcrtc", wdttLink: link, olcrtcProvider: input.provider, olcrtcRoomId: roomId } }),
      prisma.wdttSlotBackup.create({ data: { slotId: slot.id, clientId: input.clientId, reason: "CONFIGURED", provider: input.provider, roomId, wdttLink: link, expiresAt: slot.expiresAt } }),
    ]);
    await pruneOlcRtcBackups(slot.id).catch((error) => console.error(`[OlcRTC] unable to prune backups for ${slot.id}`, error));
  } catch (error) {
    await deprovisionOlcRtcSlot(slot);
    throw error;
  }
  return { link };
}

/** Stops the old personal server and returns its paid slot to the setup step. */
export async function reissueOlcRtcSlotForClient(input: { clientId: string; slotId: string }): Promise<void> {
  const slot = await prisma.wdttSlot.findFirst({
    where: { id: input.slotId, clientId: input.clientId },
    include: { node: { select: { olcrtcProvisionMode: true, olcrtcProvisionerUrl: true, olcrtcProvisionerToken: true } } },
  });
  if (!slot) throw new Error("Подписка не найдена");
  if (slot.status !== "ACTIVE") throw new Error("Перевыпустить можно только активную подписку");
  if (slot.expiresAt <= new Date()) throw new Error("Срок действия подписки уже закончился");
  if (slot.node.olcrtcProvisionMode !== "PER_CLIENT") throw new Error("Перевыпуск доступен только для личных OlcRTC-серверов");
  if (!await deprovisionOlcRtcSlot(slot)) throw new Error("Не удалось остановить старый личный сервер; повторите попытку");

  await prisma.$transaction([
    prisma.wdttSlot.update({
      where: { id: slot.id },
      data: { status: "PENDING_CONFIG", vkHash: "olcrtc-pending", wdttLink: "", olcrtcProvider: null, olcrtcRoomId: null },
    }),
    prisma.wdttSlotBackup.create({ data: { slotId: slot.id, clientId: input.clientId, reason: "REISSUED", provider: slot.olcrtcProvider, roomId: slot.olcrtcRoomId, wdttLink: slot.wdttLink, expiresAt: slot.expiresAt } }),
  ]);
  await pruneOlcRtcBackups(slot.id).catch((error) => console.error(`[OlcRTC] unable to prune backups for ${slot.id}`, error));
}

async function pruneOlcRtcBackups(slotId: string): Promise<void> {
  const stale = await prisma.wdttSlotBackup.findMany({ where: { slotId }, orderBy: { createdAt: "desc" }, skip: 10, select: { id: true } });
  if (stale.length) await prisma.wdttSlotBackup.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
}

/** Restores a saved room configuration by creating a fresh personal server and link. */
export async function restoreOlcRtcSlotBackupForClient(input: { clientId: string; slotId: string; backupId: string }): Promise<{ link: string }> {
  const backup = await prisma.wdttSlotBackup.findFirst({ where: { id: input.backupId, slotId: input.slotId, clientId: input.clientId } });
  if (!backup) throw new Error("Резервная копия OlcRTC не найдена");
  if ((backup.provider !== "telemost" && backup.provider !== "wbstream") || !backup.roomId?.trim()) {
    throw new Error("В этой резервной копии нет данных комнаты для восстановления");
  }
  return configureOlcRtcSlotForClient({ clientId: input.clientId, slotId: input.slotId, provider: backup.provider, roomId: backup.roomId });
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
      id: true, name: true, capacity: true, currentSlots: true, olcrtcProvider: true, olcrtcTransport: true,
      olcrtcRoomId: true, olcrtcKey: true, olcrtcPayload: true, olcrtcProvisionMode: true,
      olcrtcProvisionerUrl: true, olcrtcProvisionerToken: true,
    },
    orderBy: { updatedAt: "asc" },
  });
  // Prefer the personal mode whenever it is available. This makes a newly
  // created personal node take precedence over old shared-link nodes that may
  // still exist for historical subscriptions.
  const validNodes = nodes.filter(isValidNode).sort((left, right) => {
    const leftPersonal = left.olcrtcProvisionMode === "PER_CLIENT" ? 0 : 1;
    const rightPersonal = right.olcrtcProvisionMode === "PER_CLIENT" ? 0 : 1;
    return leftPersonal - rightPersonal;
  });
  if (!validNodes.length) return { ok: false, error: "Нет настроенных OlcRTC нод. Проверьте ноду и её статус.", status: 503 };

  const expiresAt = new Date(Date.now() + tariff.durationDays * 86_400_000);
  const usage = new Map(validNodes.map((node) => [node.id, node.currentSlots]));
  const results: { node: OlcRtcLinkNode; code: string; link: string; status: string }[] = [];
  for (let index = 0; index < tariff.proxyCount; index++) {
    const node = validNodes.find((candidate) => (usage.get(candidate.id) ?? 0) < (candidate.capacity ?? Infinity));
    if (!node) break;
    results.push({
      node,
      code: accessCode(),
      link: isStaticNode(node) ? buildOlcRtcLink(node) : "",
      status: isStaticNode(node) ? "ACTIVE" : "PENDING_CONFIG",
    });
    usage.set(node.id, (usage.get(node.id) ?? 0) + 1);
  }
  if (!results.length) return { ok: false, error: "На OlcRTC нодах нет свободных мест", status: 503 };

  const created = await prisma.$transaction(results.map((result) => prisma.wdttSlot.create({
    data: {
      nodeId: result.node.id, clientId: payment.clientId, tariffId: tariff.id, paymentId,
      password: result.code, vkHash: result.status === "ACTIVE" ? "olcrtc" : "olcrtc-pending",
      wdttLink: result.link, expiresAt, trafficLimitBytes: tariff.trafficLimitBytes, status: result.status,
    },
  })));
  await Promise.all(results.map((result) => prisma.wdttNode.update({
    where: { id: result.node.id }, data: { currentSlots: { increment: 1 } },
  })));
  return { ok: true, slotsCreated: created.length, slotIds: created.map((slot) => slot.id) };
}

/**
 * A payment can be confirmed while a node is temporarily offline. Do not make
 * the buyer pay again: this explicit recovery retries only PAID payments that
 * still have no slot at all.
 */
export async function recoverWdttSlotsForClient(clientId: string): Promise<RecoverWdttSlotsResult> {
  const payments = await prisma.payment.findMany({
    where: { clientId, status: "PAID", wdttTariffId: { not: null }, wdttSlots: { none: {} } },
    select: { id: true },
    orderBy: { paidAt: "asc" },
  });
  if (!payments.length) return { ok: false, error: "Не найдено оплаченных OlcRTC-тарифов без доступа", status: 404 };

  const slotIds: string[] = [];
  for (const payment of payments) {
    const result = await createWdttSlotsByPaymentId(payment.id);
    if (!result.ok) return result;
    slotIds.push(...result.slotIds);
  }
  return { ok: true, slotsCreated: slotIds.length, slotIds };
}
