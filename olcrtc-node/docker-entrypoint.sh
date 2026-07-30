#!/bin/sh
set -eu

required() {
  if [ -z "$2" ]; then
    echo "[olcrtc-node] $1 must be set" >&2
    exit 64
  fi
}

OLCRTC_PROVIDER="${OLCRTC_PROVIDER:-telemost}"
OLCRTC_TRANSPORT="${OLCRTC_TRANSPORT:-vp8channel}"
OLCRTC_DNS="${OLCRTC_DNS:-8.8.8.8:53}"
OLCRTC_DEBUG="${OLCRTC_DEBUG:-false}"
OLCRTC_VP8_FPS="${OLCRTC_VP8_FPS:-25}"
OLCRTC_VP8_BATCH_SIZE="${OLCRTC_VP8_BATCH_SIZE:-1}"
OLCRTC_SEI_FPS="${OLCRTC_SEI_FPS:-60}"
OLCRTC_SEI_BATCH_SIZE="${OLCRTC_SEI_BATCH_SIZE:-64}"
OLCRTC_SEI_FRAGMENT_SIZE="${OLCRTC_SEI_FRAGMENT_SIZE:-900}"
OLCRTC_SEI_ACK_TIMEOUT_MS="${OLCRTC_SEI_ACK_TIMEOUT_MS:-2000}"
OLCRTC_VIDEO_WIDTH="${OLCRTC_VIDEO_WIDTH:-1920}"
OLCRTC_VIDEO_HEIGHT="${OLCRTC_VIDEO_HEIGHT:-1080}"
OLCRTC_VIDEO_FPS="${OLCRTC_VIDEO_FPS:-30}"
OLCRTC_VIDEO_BITRATE="${OLCRTC_VIDEO_BITRATE:-2M}"
OLCRTC_VIDEO_HW="${OLCRTC_VIDEO_HW:-none}"
OLCRTC_VIDEO_CODEC="${OLCRTC_VIDEO_CODEC:-qrcode}"
OLCRTC_VIDEO_QR_SIZE="${OLCRTC_VIDEO_QR_SIZE:-0}"
OLCRTC_VIDEO_QR_RECOVERY="${OLCRTC_VIDEO_QR_RECOVERY:-low}"
OLCRTC_VIDEO_TILE_MODULE="${OLCRTC_VIDEO_TILE_MODULE:-4}"
OLCRTC_VIDEO_TILE_RS="${OLCRTC_VIDEO_TILE_RS:-20}"
OLCRTC_UPSTREAM_SOCKS_HOST="${OLCRTC_UPSTREAM_SOCKS_HOST:-}"
OLCRTC_UPSTREAM_SOCKS_PORT="${OLCRTC_UPSTREAM_SOCKS_PORT:-0}"
OLCRTC_UPSTREAM_SOCKS_USER="${OLCRTC_UPSTREAM_SOCKS_USER:-}"
OLCRTC_UPSTREAM_SOCKS_PASS="${OLCRTC_UPSTREAM_SOCKS_PASS:-}"
OLCRTC_WBSTREAM_TOKEN="${OLCRTC_WBSTREAM_TOKEN:-}"

required OLCRTC_ROOM_ID "${OLCRTC_ROOM_ID:-}"
required OLCRTC_KEY "${OLCRTC_KEY:-}"

case "$OLCRTC_PROVIDER" in
  telemost|wbstream) ;;
  *) echo "[olcrtc-node] OLCRTC_PROVIDER must be telemost or wbstream" >&2; exit 64 ;;
esac

case "$OLCRTC_TRANSPORT" in
  vp8channel|seichannel|videochannel|datachannel) ;;
  *) echo "[olcrtc-node] unsupported OLCRTC_TRANSPORT: $OLCRTC_TRANSPORT" >&2; exit 64 ;;
esac

if ! printf %s "$OLCRTC_KEY" | grep -Eq '^[0-9A-Fa-f]{64}$'; then
  echo "[olcrtc-node] OLCRTC_KEY must contain exactly 64 hexadecimal characters" >&2
  exit 64
fi

if [ "$OLCRTC_PROVIDER" = "telemost" ] && [ "$OLCRTC_TRANSPORT" = "datachannel" ]; then
  echo "[olcrtc-node] Telemost does not support datachannel; use vp8channel or videochannel" >&2
  exit 64
fi

if [ "$OLCRTC_PROVIDER" = "wbstream" ] && [ "$OLCRTC_TRANSPORT" = "datachannel" ] && [ -z "$OLCRTC_WBSTREAM_TOKEN" ]; then
  echo "[olcrtc-node] WBStream datachannel needs OLCRTC_WBSTREAM_TOKEN with moderator rights" >&2
  exit 64
fi

export OLCRTC_PROVIDER OLCRTC_TRANSPORT OLCRTC_DNS OLCRTC_DEBUG \
  OLCRTC_VP8_FPS OLCRTC_VP8_BATCH_SIZE \
  OLCRTC_SEI_FPS OLCRTC_SEI_BATCH_SIZE OLCRTC_SEI_FRAGMENT_SIZE OLCRTC_SEI_ACK_TIMEOUT_MS \
  OLCRTC_VIDEO_WIDTH OLCRTC_VIDEO_HEIGHT OLCRTC_VIDEO_FPS OLCRTC_VIDEO_BITRATE \
  OLCRTC_VIDEO_HW OLCRTC_VIDEO_CODEC OLCRTC_VIDEO_QR_SIZE OLCRTC_VIDEO_QR_RECOVERY \
  OLCRTC_VIDEO_TILE_MODULE OLCRTC_VIDEO_TILE_RS \
  OLCRTC_UPSTREAM_SOCKS_HOST OLCRTC_UPSTREAM_SOCKS_PORT \
  OLCRTC_UPSTREAM_SOCKS_USER OLCRTC_UPSTREAM_SOCKS_PASS \
  OLCRTC_ROOM_ID OLCRTC_KEY OLCRTC_WBSTREAM_TOKEN

envsubst < /app/server.yaml.template > /run/olcrtc/server.yaml
# The token is optional. Omit the YAML field completely when it is not used.
if [ -z "$OLCRTC_WBSTREAM_TOKEN" ]; then
  sed -i '/^  token: ""$/d' /run/olcrtc/server.yaml
fi

echo "[olcrtc-node] starting provider=$OLCRTC_PROVIDER transport=$OLCRTC_TRANSPORT room=$OLCRTC_ROOM_ID"
exec /usr/local/bin/olcrtc /run/olcrtc/server.yaml
