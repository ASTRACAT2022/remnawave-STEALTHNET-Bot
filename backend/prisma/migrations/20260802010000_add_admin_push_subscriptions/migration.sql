-- CreateTable
CREATE TABLE "admin_push_subscriptions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_push_subscriptions_endpoint_key" ON "admin_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "admin_push_subscriptions_admin_id_idx" ON "admin_push_subscriptions"("admin_id");

-- AddForeignKey
ALTER TABLE "admin_push_subscriptions" ADD CONSTRAINT "admin_push_subscriptions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
