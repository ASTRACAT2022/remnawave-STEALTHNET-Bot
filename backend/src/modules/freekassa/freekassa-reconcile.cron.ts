import cron, { type ScheduledTask } from "node-cron";
import { registerCron, unregisterCron, wrapCronTick } from "../diagnostics/cron-registry.js";
import { syncPendingFreekassaPayments } from "./freekassa-reconcile.service.js";

const CRON_NAME = "freekassa-reconcile";
const CRON_EXPR = "* * * * *";
const LOG = "[FreeKassa Sync]";

let task: ScheduledTask | null = null;
let running = false;

export async function runFreekassaReconcileTick(limit = 50) {
  if (running) {
    console.log(`${LOG} Previous run is still active, skip`);
    return { skipped: true };
  }
  running = true;
  try {
    const result = await syncPendingFreekassaPayments(limit);
    if (result.ok && result.markedPaid > 0) {
      console.log(`${LOG} Marked ${result.markedPaid}/${result.checked} pending payment(s) as paid`);
    } else if (result.ok && result.failed > 0) {
      console.warn(`${LOG} Checked ${result.checked} payment(s), failed=${result.failed}`);
    } else if (!result.ok) {
      console.warn(`${LOG} ${result.error}`);
    }
    return result;
  } finally {
    running = false;
  }
}

export function startFreekassaReconcileScheduler(): void {
  if (task) return;
  registerCron({
    name: CRON_NAME,
    cron: CRON_EXPR,
    description: "Сверка зависших FreeKassa/KASSA платежей через API",
    trigger: () => runFreekassaReconcileTick(100),
  });
  task = cron.schedule(CRON_EXPR, wrapCronTick(CRON_NAME, () => runFreekassaReconcileTick(50)));
  console.log(`${LOG} Scheduler started (${CRON_EXPR})`);
}

export function stopFreekassaReconcileScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
  unregisterCron(CRON_NAME);
}
