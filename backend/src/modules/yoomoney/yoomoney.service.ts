import { createHash } from "crypto";

export type YooMoneyConfig = {
  wallet: string;
  notificationSecret: string;
};

export function isYooMoneyConfigured(config: YooMoneyConfig | null): boolean {
  return Boolean(config?.wallet?.trim() && config?.notificationSecret?.trim());
}

export function createYooMoneyPaymentUrl(params: {
  wallet: string;
  amount: number;
  orderId: string;
  description: string;
  successUrl?: string | null;
}): string {
  const query = new URLSearchParams({
    receiver: params.wallet.trim(),
    "quickpay-form": "shop",
    paymentType: "AC",
    sum: Number(params.amount).toFixed(2),
    targets: params.description || `Оплата заказа ${params.orderId}`,
    label: params.orderId,
  });
  if (params.successUrl?.trim()) {
    query.set("successURL", params.successUrl.trim());
  }
  return `https://yoomoney.ru/quickpay/confirm.xml?${query.toString()}`;
}

export function verifyYooMoneySha1(body: Record<string, unknown>, notificationSecret: string): boolean {
  const source = [
    String(body.notification_type ?? ""),
    String(body.operation_id ?? ""),
    String(body.amount ?? ""),
    String(body.currency ?? ""),
    String(body.datetime ?? ""),
    String(body.sender ?? ""),
    String(body.codepro ?? ""),
    notificationSecret,
    String(body.label ?? ""),
  ].join("&");

  const expected = createHash("sha1").update(source, "utf8").digest("hex");
  const actual = String(body.sha1_hash ?? "").toLowerCase();
  return Boolean(actual) && actual === expected;
}
