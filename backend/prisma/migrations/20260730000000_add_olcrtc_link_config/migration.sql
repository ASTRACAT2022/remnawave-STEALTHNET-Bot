-- Direct OlcRTC-link configuration. Legacy wdtt_* tables are retained so
-- existing payment history is never removed during the product migration.
ALTER TABLE "wdtt_nodes" ADD COLUMN IF NOT EXISTS "olcrtc_provider" TEXT NOT NULL DEFAULT 'jitsi';
ALTER TABLE "wdtt_nodes" ADD COLUMN IF NOT EXISTS "olcrtc_transport" TEXT NOT NULL DEFAULT 'datachannel';
ALTER TABLE "wdtt_nodes" ADD COLUMN IF NOT EXISTS "olcrtc_room_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "wdtt_nodes" ADD COLUMN IF NOT EXISTS "olcrtc_key" TEXT NOT NULL DEFAULT '';
ALTER TABLE "wdtt_nodes" ADD COLUMN IF NOT EXISTS "olcrtc_payload" TEXT;
