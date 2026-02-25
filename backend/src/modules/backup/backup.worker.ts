import { parseDatabaseUrl, saveBackupToFile } from "./backup.service.js";

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const AUTO_BACKUP_ENABLED = readBooleanEnv("AUTO_BACKUP_ENABLED", true);
const AUTO_BACKUP_INTERVAL_MS = readPositiveIntEnv("AUTO_BACKUP_INTERVAL_MS", 60 * 60 * 1000);

export type AutoBackupWorkerHandle = {
  stop: () => void;
};

export function startAutoBackupWorker(): AutoBackupWorkerHandle {
  let timer: NodeJS.Timeout | null = null;
  let inProgress = false;

  if (!AUTO_BACKUP_ENABLED) {
    console.log("[Auto Backup Worker] Disabled by AUTO_BACKUP_ENABLED=false");
    return { stop: () => {} };
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[Auto Backup Worker] DATABASE_URL is not set, worker disabled");
    return { stop: () => {} };
  }
  const db = parseDatabaseUrl(url);
  if (!db) {
    console.warn("[Auto Backup Worker] Invalid DATABASE_URL, worker disabled");
    return { stop: () => {} };
  }

  const tick = async () => {
    if (inProgress) return;
    inProgress = true;
    try {
      const result = await saveBackupToFile(db);
      console.log("[Auto Backup Worker] Backup created", {
        path: result.relativePath,
      });
    } catch (e) {
      console.error("[Auto Backup Worker] Backup failed", e);
    } finally {
      inProgress = false;
    }
  };

  timer = setInterval(() => {
    void tick();
  }, AUTO_BACKUP_INTERVAL_MS);
  timer.unref?.();
  void tick();

  console.log("[Auto Backup Worker] Started", {
    intervalMs: AUTO_BACKUP_INTERVAL_MS,
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
