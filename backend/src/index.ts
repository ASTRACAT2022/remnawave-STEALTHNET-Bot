import app from "./app.js";
import { env } from "./config/index.js";
import { prisma } from "./db.js";
import { ensureFirstAdmin } from "./modules/auth/auth.service.js";
import { ensureSystemSettings } from "./scripts/seed-system-settings.js";

async function main() {
  await prisma.$connect();

  await ensureFirstAdmin(env);
  await ensureSystemSettings();

  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`STEALTHNET 3.0 API listening on port ${env.PORT}`);
  });

  const shutdown = async () => {
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
