-- Pepoapple full-feature expansion schema

CREATE TABLE IF NOT EXISTS resellers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(128) UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_principals (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(128) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'admin',
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  refresh_token_version INTEGER NOT NULL DEFAULT 1,
  reseller_id VARCHAR(36) REFERENCES resellers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  owner_principal_id VARCHAR(36) NOT NULL REFERENCES auth_principals(id),
  reseller_id VARCHAR(36) REFERENCES resellers(id),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS strict_bind BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_eviction_policy VARCHAR(32) NOT NULL DEFAULT 'reject';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_id VARCHAR(36) REFERENCES resellers(id);

CREATE TABLE IF NOT EXISTS plan_squad_links (
  plan_id VARCHAR(36) PRIMARY KEY REFERENCES plans(id),
  squad_id VARCHAR(36) NOT NULL REFERENCES squads(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  device_hash VARCHAR(128) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE servers ADD COLUMN IF NOT EXISTS infra_status VARCHAR(64) NOT NULL DEFAULT 'ok';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS reminder_days_before INTEGER NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS protocol_profiles (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(128) UNIQUE NOT NULL,
  protocol_type VARCHAR(32) NOT NULL,
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_revisions (
  id VARCHAR(36) PRIMARY KEY,
  node_id VARCHAR(36) NOT NULL REFERENCES nodes(id),
  revision INTEGER NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'desired',
  rolled_back_from INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  target_url VARCHAR(1024) NOT NULL,
  secret VARCHAR(255) NOT NULL,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id VARCHAR(36) PRIMARY KEY,
  endpoint_id VARCHAR(36) NOT NULL REFERENCES webhook_endpoints(id),
  event VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  storage_type VARCHAR(32) NOT NULL DEFAULT 'local',
  file_path VARCHAR(1024) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'created',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
