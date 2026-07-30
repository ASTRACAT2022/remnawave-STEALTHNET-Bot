/** OlcRTC direct-link expiry bookkeeping. Links have no remote per-user revoke API. */
import { prisma } from "../db.js";

const CRON_INTERVAL_MS = 5 * 60 * 1000;

async function checkExpiredOlcRtcAccesses(): Promise<void> {
  const expired = await prisma.wdttSlot.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    select: { id: true, nodeId: true },
  });
  if (!expired.length) return;
  await prisma.$transaction([
    prisma.wdttSlot.updateMany({ where: { id: { in: expired.map((access) => access.id) } }, data: { status: "EXPIRED", revokeReason: "expired", revokedAt: new Date() } }),
    ...expired.map((access) => prisma.wdttNode.update({ where: { id: access.nodeId }, data: { currentSlots: { decrement: 1 } } })),
  ]);
  console.log(`[OlcRTC cron] Marked ${expired.length} direct links as expired`);
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
