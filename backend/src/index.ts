import app from "./app.js";
import { env } from "./config/index.js";
import { prisma } from "./db.js";
import { ensureFirstAdmin } from "./modules/auth/auth.service.js";
import { ensureSystemSettings } from "./scripts/seed-system-settings.js";
import { startAutoBroadcastScheduler, stopAutoBroadcastScheduler } from "./modules/auto-broadcast/auto-broadcast-scheduler.js";
import { startContestDailyReminderScheduler, stopContestDailyReminderScheduler } from "./modules/contest/contest-daily-reminder-scheduler.js";
import { startAutoRenewScheduler } from "./modules/payment/auto-renew.cron.js";
import { startAutoBackupScheduler, stopAutoBackupScheduler } from "./modules/backup/auto-backup.scheduler.js";
import { startGiftExpiryCron } from "./modules/gift/gift-expiry.cron.js";
import { startAbandonedAccountsCleanup } from "./modules/client/abandoned-accounts.cron.js";

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    REMNAWAVE STEALTHNET                    ║');
  console.log('║                      System Initialization                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\n');

  console.log('🔌 Connecting to database...');
  await prisma.$connect();
  console.log('✅ Database connected successfully\n');

  console.log('👤 Ensuring first admin user...');
  await ensureFirstAdmin(env);
  console.log('✅ Admin user check completed\n');

  console.log('⚙️  Initializing system settings...');
  await ensureSystemSettings();
  console.log('✅ System settings initialized\n');

  console.log('📢 Starting auto-broadcast scheduler...');
  await startAutoBroadcastScheduler();
  console.log('✅ Auto-broadcast scheduler started\n');

  console.log('🏆 Starting contest daily reminder scheduler...');
  startContestDailyReminderScheduler(env.CONTEST_REMINDER_CRON ?? undefined);
  console.log('✅ Contest reminder scheduler started\n');

  console.log('💳 Starting auto-renew scheduler...');
  startAutoRenewScheduler();
  console.log('✅ Auto-renew scheduler started\n');

  console.log('🎁 Starting gift expiry cron...');
  startGiftExpiryCron();
  console.log('✅ Gift expiry cron started\n');

  console.log('🧹 Starting abandoned accounts cleanup...');
  startAbandonedAccountsCleanup();
  console.log('✅ Abandoned accounts cleanup started\n');

  console.log('💾 Starting auto-backup scheduler...');
  await startAutoBackupScheduler();
  console.log('✅ Auto-backup scheduler started\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 All systems operational. Starting HTTP server...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`🌐 API v3.2.7 listening on port ${env.PORT}`);
    console.log(`🔗 http://localhost:${env.PORT}`);
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    READY TO SERVE                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');
  });

  const shutdown = async () => {
    stopAutoBroadcastScheduler();
    stopContestDailyReminderScheduler();
    stopAutoBackupScheduler();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
