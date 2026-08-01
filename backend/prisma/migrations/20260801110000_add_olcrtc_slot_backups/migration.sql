ALTER TABLE "wdtt_slots"
  ADD COLUMN IF NOT EXISTS "olcrtc_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "olcrtc_room_id" TEXT;

CREATE TABLE IF NOT EXISTS "wdtt_slot_backups" (
  "id" TEXT NOT NULL,
  "slot_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "provider" TEXT,
  "room_id" TEXT,
  "wdtt_link" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wdtt_slot_backups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wdtt_slot_backups_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "wdtt_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "wdtt_slot_backups_slot_id_created_at_idx" ON "wdtt_slot_backups"("slot_id", "created_at");
CREATE INDEX IF NOT EXISTS "wdtt_slot_backups_client_id_created_at_idx" ON "wdtt_slot_backups"("client_id", "created_at");
