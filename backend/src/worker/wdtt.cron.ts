/** OlcRTC expiry checker. Personal-server slots are physically stopped first. */
import { prisma } from "../db.js";
import { deprovisionOlcRtcSlot } from "../modules/wdtt/wdtt-slots-activation.service.js";

const CRON_INTERVAL_MS = 5 * 60 * 1000;

async function checkExpiredOlcRtcAccesses(): Promise<void> {
  const expired = await prisma.wdttSlot.findMany({
    where: { status: { in: ["ACTIVE", "PENDING_CONFIG"] }, expiresAt: { lt: new Date() } },
    select: {
      id: true, nodeId: true, status: true, password: true,
      node: { select: { olcrtcProvisionMode: true, olcrtcProvisionerUrl: true, olcrtcProvisionerToken: true, apiUrl: true, apiKey: true } },
    },
  });
  if (!expired.length) return;
  const releasable = [] as typeof expired;
  for (const slot of expired) {
    if (await deprovisionOlcRtcSlot(slot)) releasable.push(slot);
  }
  if (!releasable.length) return;
  await prisma.$transaction([
    prisma.wdttSlot.updateMany({ where: { id: { in: releasable.map((access) => access.id) } }, data: { status: "EXPIRED", revokeReason: "expired", revokedAt: new Date() } }),
    ...releasable.map((access) => prisma.wdttNode.update({ where: { id: access.nodeId }, data: { currentSlots: { decrement: 1 } } })),
  ]);
  console.log(`[OlcRTC cron] Expired ${releasable.length} subscriptions`);
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startWdttCron(): void {
  console.log(`[OlcRTC cron] Starting local expiry checker (every ${CRON_INTERVAL_MS / 60_000} min)`);
  checkExpiredOlcRtcAccesses().catch(console.error);
  interval = setInterval(() => checkExpiredOlcRtcAccesses().catch(console.error), CRON_INTERVAL_MS);
}

export function stopWdttCron(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
