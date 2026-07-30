ALTER TABLE "wdtt_nodes"
  ADD COLUMN "olcrtc_provision_mode" TEXT NOT NULL DEFAULT 'STATIC',
  ADD COLUMN "olcrtc_provisioner_url" TEXT,
  ADD COLUMN "olcrtc_provisioner_token" TEXT;
