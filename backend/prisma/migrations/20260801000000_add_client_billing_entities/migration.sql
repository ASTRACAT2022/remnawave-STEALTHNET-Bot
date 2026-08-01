CREATE TABLE "client_payers" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "type" VARCHAR(20) NOT NULL DEFAULT 'PERSON',
  "country" VARCHAR(2) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "tax_id" VARCHAR(64),
  "email" VARCHAR(320),
  "address" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_payers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_team_members" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "role" VARCHAR(20) NOT NULL DEFAULT 'VIEWER',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_team_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_visits" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "auth_method" VARCHAR(32) NOT NULL DEFAULT 'web',
  "ip" VARCHAR(64),
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_visits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_payers_client_id_idx" ON "client_payers"("client_id");
CREATE INDEX "client_payers_client_id_is_default_idx" ON "client_payers"("client_id", "is_default");
CREATE UNIQUE INDEX "client_team_members_client_id_email_key" ON "client_team_members"("client_id", "email");
CREATE INDEX "client_team_members_client_id_idx" ON "client_team_members"("client_id");
CREATE INDEX "client_visits_client_id_created_at_idx" ON "client_visits"("client_id", "created_at" DESC);

ALTER TABLE "client_payers" ADD CONSTRAINT "client_payers_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_team_members" ADD CONSTRAINT "client_team_members_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_visits" ADD CONSTRAINT "client_visits_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
