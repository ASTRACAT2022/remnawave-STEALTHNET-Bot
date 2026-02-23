-- Pepoapple MVP initial schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS squads (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(128) UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  selection_policy VARCHAR(32) NOT NULL DEFAULT 'round-robin',
  fallback_policy VARCHAR(128) NOT NULL DEFAULT 'none',
  allowed_protocols JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  external_identities JSONB NOT NULL DEFAULT '{}'::jsonb,
  uuid VARCHAR(36) UNIQUE NOT NULL,
  vless_id VARCHAR(36) UNIQUE NOT NULL,
  short_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  traffic_limit_bytes BIGINT NOT NULL DEFAULT 0,
  traffic_used_bytes BIGINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  max_devices INTEGER NOT NULL DEFAULT 1,
  hwid_policy VARCHAR(64) NOT NULL DEFAULT 'none',
  squad_id VARCHAR(36) REFERENCES squads(id),
  subscription_token VARCHAR(128) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servers (
  id VARCHAR(36) PRIMARY KEY,
  host VARCHAR(255) UNIQUE NOT NULL,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  provider VARCHAR(128) NOT NULL DEFAULT '',
  region VARCHAR(128) NOT NULL DEFAULT '',
  squad_id VARCHAR(36) NOT NULL REFERENCES squads(id),
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  last_paid_at TIMESTAMPTZ,
  next_due_at TIMESTAMPTZ,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS nodes (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) UNIQUE NOT NULL REFERENCES servers(id),
  node_token VARCHAR(128) UNIQUE NOT NULL,
  engine_awg2_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  engine_singbox_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  engine_awg2_version VARCHAR(64) NOT NULL DEFAULT '',
  engine_singbox_version VARCHAR(64) NOT NULL DEFAULT '',
  desired_config_revision INTEGER NOT NULL DEFAULT 1,
  applied_config_revision INTEGER NOT NULL DEFAULT 0,
  last_apply_status VARCHAR(64) NOT NULL DEFAULT 'pending',
  last_seen_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'provisioning',
  desired_config JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(128) UNIQUE NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  duration_days INTEGER NOT NULL DEFAULT 30,
  traffic_limit_bytes BIGINT NOT NULL DEFAULT 0,
  max_devices INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_squad_links (
  plan_id VARCHAR(36) PRIMARY KEY REFERENCES plans(id),
  squad_id VARCHAR(36) NOT NULL REFERENCES squads(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  plan_id VARCHAR(36) NOT NULL REFERENCES plans(id),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  total_amount DOUBLE PRECISION NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  idempotency_key VARCHAR(128) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(36) PRIMARY KEY,
  order_id VARCHAR(36) NOT NULL REFERENCES orders(id),
  provider VARCHAR(64) NOT NULL DEFAULT 'manual',
  external_payment_id VARCHAR(128) UNIQUE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  amount DOUBLE PRECISION NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_aliases (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  legacy_token VARCHAR(128) UNIQUE NOT NULL,
  subscription_token VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS node_usage (
  id VARCHAR(36) PRIMARY KEY,
  node_id VARCHAR(36) NOT NULL REFERENCES nodes(id),
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  bytes_used BIGINT NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id VARCHAR(36) PRIMARY KEY,
  mode VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'started',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  actor VARCHAR(128) NOT NULL DEFAULT 'system',
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(128) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
