/**
 * Откат услуг при возврате платежа (refund).
 *
 * Проблема, которую закрывает этот модуль: раньше refund только зачислял
 * средства на баланс и менял статус платежа, а VPN-подписка/слоты в Remna
 * продолжали работать. Здесь мы отзываем всё, что было активировано/продлено
 * данным платежом:
 *   - VPN-подписку (Subscription.remnawaveUuid) → Remna revoke
 *   - WDTT-слоты (WdttSlot.paymentId)
 *   - Proxy- и Singbox-слоты (по tariff + client, созданные после платежа)
 */

import { prisma } from "../../db.js";
import { remnaRevokeUserSubscription, isRemnaConfigured } from "../remna/remna.client.js";

export type RevokePaymentServicesResult = {
  revokedSubscriptions: string[];
  revokedWdttSlots: number;
  revokedProxySlots: number;
  revokedSingboxSlots: number;
};

/**
 * Находит все услуги, активированные данным платежом, и отзывает их.
 * Вызывается из клиентского refund и из админского refund.
 */
export async function revokePaymentServices(
  paymentId: string,
  opts?: { ownerClientId?: string; skipIfNotFound?: boolean },
): Promise<RevokePaymentServicesResult> {
  const result: RevokePaymentServicesResult = {
    revokedSubscriptions: [],
    revokedWdttSlots: 0,
    revokedProxySlots: 0,
    revokedSingboxSlots: 0,
  };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      clientId: true,
      createdAt: true,
      subscriptionId: true,
      tariffId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      wdttTariffId: true,
    },
  });
  if (!payment) return result;

  const clientId = opts?.ownerClientId ?? payment.clientId;

  // ── 1. VPN-подписка ────────────────────────────────────────────────────
  // Предпочитаем прямую привязку payment.subscriptionId (заполняется при активации).
  // Фолбэк — подписки, у которых есть платёж с таким id (relation payments).
  let subscriptionIds: string[] = [];
  if (payment.subscriptionId) {
    subscriptionIds.push(payment.subscriptionId);
  }
  if (payment.tariffId) {
    const linked = await prisma.subscription.findMany({
      where: { payments: { some: { id: payment.id } } },
      select: { id: true },
    });
    for (const s of linked) {
      if (!subscriptionIds.includes(s.id)) subscriptionIds.push(s.id);
    }
  }

  if (subscriptionIds.length > 0) {
    const subs = await prisma.subscription.findMany({
      where: { id: { in: subscriptionIds }, ownerId: clientId },
      select: { id: true, remnawaveUuid: true },
    });
    for (const sub of subs) {
      if (!sub.remnawaveUuid) continue;
      if (isRemnaConfigured()) {
        try {
          const r = await remnaRevokeUserSubscription(sub.remnawaveUuid);
          if (r.error) {
            console.error(`[refund-revoke] remna revoke failed sub=${sub.id}:`, r.error);
          } else {
            result.revokedSubscriptions.push(sub.id);
          }
        } catch (e) {
          console.error(`[refund-revoke] remna revoke error sub=${sub.id}:`, e);
        }
      }
      // Страховка для панели: подписка считается истёкшей, даже если Remna недоступна.
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { expireAt: new Date(), autoRenewEnabled: false },
      }).catch(() => {});
    }
  }

  // ── 2. WDTT-слоты (прямая привязка по paymentId) ───────────────────────
  if (payment.wdttTariffId) {
    try {
      const upd = await prisma.wdttSlot.updateMany({
        where: { paymentId: payment.id, clientId, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date(), revokeReason: "refund" },
      });
      result.revokedWdttSlots = upd.count;
    } catch (e) {
      console.error("[refund-revoke] wdtt slots revoke error:", e);
    }
  }

  // ── 3. Proxy- и Singbox-слоты (по tariff + client, созданные после платежа) ──
  if (payment.proxyTariffId) {
    try {
      const upd = await prisma.proxySlot.updateMany({
        where: {
          clientId,
          proxyTariffId: payment.proxyTariffId,
          status: "ACTIVE",
          createdAt: { gte: payment.createdAt },
        },
        data: { status: "REVOKED", expiresAt: new Date() },
      });
      result.revokedProxySlots = upd.count;
    } catch (e) {
      console.error("[refund-revoke] proxy slots revoke error:", e);
    }
  }

  if (payment.singboxTariffId) {
    try {
      const upd = await prisma.singboxSlot.updateMany({
        where: {
          clientId,
          singboxTariffId: payment.singboxTariffId,
          status: "ACTIVE",
          createdAt: { gte: payment.createdAt },
        },
        data: { status: "REVOKED", expiresAt: new Date() },
      });
      result.revokedSingboxSlots = upd.count;
    } catch (e) {
      console.error("[refund-revoke] singbox slots revoke error:", e);
    }
  }

  return result;
}
