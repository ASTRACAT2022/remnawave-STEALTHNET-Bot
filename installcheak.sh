#!/usr/bin/env bash
set -euo pipefail

# STEALTHNET NaloGO auto installer (curl | bash friendly)
# Modes:
#   INSTALL_MODE_999=relay  -> deploy RU nalogo-relay node
#   INSTALL_MODE_999=panel  -> configure DE panel to use remote relay

REPO_URL="${REPO_URL_999:-https://github.com/ASTRACAT2022/remnawave-STEALTHNET-Bot.git}"
BRANCH="${BRANCH_999:-main}"
INSTALL_DIR="${INSTALL_DIR_999:-/opt/remnawave-STEALTHNET-Bot}"
MODE="${INSTALL_MODE_999:-panel}"

log() { printf '[installcheak] %s\n' "$*"; }
err() { printf '[installcheak][error] %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "command not found: $1"
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "/^${key}=/d" "$file"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$file"
}

clone_or_update_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Updating repo in $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch origin
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    log "Cloning repo $REPO_URL into $INSTALL_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

deploy_relay() {
  local relay_api_key="${RELAY_API_KEY_999:-}"
  local relay_port="${RELAY_PORT_999:-7070}"
  local relay_cors_origin="${RELAY_CORS_ORIGIN_999:-*}"
  local nalogo_proxy_url="${NALOGO_PROXY_URL_999:-}"

  [ -n "$relay_api_key" ] || err "RELAY_API_KEY_999 is required for relay mode"

  local env_file="$INSTALL_DIR/.env"
  if [ ! -f "$env_file" ]; then
    cp "$INSTALL_DIR/relay.env.example" "$env_file"
  fi

  upsert_env "$env_file" "RELAY_API_KEY" "$relay_api_key"
  upsert_env "$env_file" "RELAY_PORT" "$relay_port"
  upsert_env "$env_file" "RELAY_CORS_ORIGIN" "$relay_cors_origin"
  upsert_env "$env_file" "NALOGO_PROXY_URL" "$nalogo_proxy_url"

  log "Building and starting nalogo-relay"
  docker compose -f "$INSTALL_DIR/docker-compose.relay.yml" --env-file "$env_file" up -d --build

  log "Relay deployed"
  log "Health: curl -fsS http://127.0.0.1:${relay_port}/health"
}

configure_panel() {
  local relay_url="${NALOGO_REMOTE_RELAY_URL_999:-}"
  local relay_key="${NALOGO_REMOTE_RELAY_KEY_999:-}"
  local relay_timeout="${NALOGO_REMOTE_RELAY_TIMEOUT_MS_999:-60000}"
  local relay_only="${NALOGO_REMOTE_RELAY_ONLY_999:-true}"

  [ -n "$relay_url" ] || err "NALOGO_REMOTE_RELAY_URL_999 is required for panel mode"
  [ -n "$relay_key" ] || err "NALOGO_REMOTE_RELAY_KEY_999 is required for panel mode"

  local env_file="$INSTALL_DIR/.env"
  touch "$env_file"
  upsert_env "$env_file" "NALOGO_REMOTE_RELAY_URL" "$relay_url"
  upsert_env "$env_file" "NALOGO_REMOTE_RELAY_KEY" "$relay_key"
  upsert_env "$env_file" "NALOGO_REMOTE_RELAY_TIMEOUT_MS" "$relay_timeout"
  upsert_env "$env_file" "NALOGO_REMOTE_RELAY_ONLY" "$relay_only"

  # Keep local fallback enabled when relay-only=false
  upsert_env "$env_file" "NALOGO_NATIVE_FALLBACK_ON_BRIDGE_ERROR" "true"

  log "Recreating API with relay settings"
  docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d --force-recreate api

  log "Panel configured"
  log "Check logs: docker compose -f $INSTALL_DIR/docker-compose.yml logs --since=5m api"
}

main() {
  need_cmd git
  need_cmd docker
  docker compose version >/dev/null 2>&1 || err "docker compose v2 is required"

  clone_or_update_repo

  case "$MODE" in
    relay) deploy_relay ;;
    panel) configure_panel ;;
    *) err "Unknown INSTALL_MODE_999=$MODE (allowed: relay|panel)" ;;
  esac
}

main "$@"

