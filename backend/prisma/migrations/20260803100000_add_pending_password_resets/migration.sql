-- CreateTable
CREATE TABLE "pending_password_resets" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_password_resets_token_key" ON "pending_password_resets"("token");

-- CreateIndex
CREATE INDEX "pending_password_resets_token_idx" ON "pending_password_resets"("token");

-- CreateIndex
CREATE INDEX "pending_password_resets_expires_at_idx" ON "pending_password_resets"("expires_at");

-- AddForeignKey
ALTER TABLE "pending_password_resets" ADD CONSTRAINT "pending_password_resets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
