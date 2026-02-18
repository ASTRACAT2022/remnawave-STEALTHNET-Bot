import {
  processPendingNalogoReceipts,
  type NalogoRetryBatchResult,
} from "./nalogo-receipts.service.js";

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

const RETRY_INTERVAL_MS = readPositiveIntEnv("NALOGO_RETRY_INTERVAL_MS", 60_000);
const RETRY_BATCH_SIZE = Math.min(
  readPositiveIntEnv("NALOGO_RETRY_BATCH_SIZE", 100),
  500,
);
const RETRY_ITEM_DELAY_MS = readPositiveIntEnv("NALOGO_RETRY_ITEM_DELAY_MS", 3000);

export type NalogoRetryWorkerHandle = {
  stop: () => void;
};

export function startNalogoReceiptRetryWorker(): NalogoRetryWorkerHandle {
  let timer: NodeJS.Timeout | null = null;
  let inProgress = false;

  const tick = async () => {
    if (inProgress) return;
    inProgress = true;
    try {
      const result: NalogoRetryBatchResult = await processPendingNalogoReceipts({
        limit: RETRY_BATCH_SIZE,
        itemDelayMs: RETRY_ITEM_DELAY_MS,
      });

      if (!result.configured) {
        return;
      }
      if (result.created > 0 || result.failed > 0) {
        console.log("[NaloGO Retry Worker] Batch result", result);
      }
    } catch (e) {
      console.error("[NaloGO Retry Worker] Tick failed", e);
    } finally {
      inProgress = false;
    }
  };

  timer = setInterval(() => {
    void tick();
  }, RETRY_INTERVAL_MS);
  void tick();

  console.log("[NaloGO Retry Worker] Started", {
    intervalMs: RETRY_INTERVAL_MS,
    batchSize: RETRY_BATCH_SIZE,
    itemDelayMs: RETRY_ITEM_DELAY_MS,
  });

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
