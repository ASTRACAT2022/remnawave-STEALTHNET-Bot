# syntax=docker/dockerfile:1.7
# OlcRTC server node. The upstream ref is pinned through build args so an
# operator can deliberately update it instead of inheriting an unknown image.
FROM golang:1.26-alpine3.22 AS builder

ARG OLCRTC_REPOSITORY=https://github.com/openlibrecommunity/olcrtc.git
ARG OLCRTC_REF=master
ARG GO_BUILD_MAX_PROCS=2

RUN apk add --no-cache ca-certificates git

WORKDIR /src
RUN git clone --depth 1 --recurse-submodules --branch "${OLCRTC_REF}" "${OLCRTC_REPOSITORY}" .
# Persist the Go module and compiler caches between Compose builds. This is
# particularly important for small VPS hosts: subsequent rebuilds download and
# compile only changed packages instead of rebuilding OlcRTC from scratch.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOMAXPROCS=${GO_BUILD_MAX_PROCS} go mod download && \
    GOMAXPROCS=${GO_BUILD_MAX_PROCS} CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/olcrtc ./cmd/olcrtc

FROM alpine:3.22

# ffmpeg is required only by videochannel, but keeping it in the common image
# allows switching transport through .env without another image variant.
RUN apk add --no-cache ca-certificates ffmpeg gettext && \
    addgroup -S olcrtc && \
    adduser -S -G olcrtc -h /app olcrtc && \
    mkdir -p /app/data /run/olcrtc && \
    chown -R olcrtc:olcrtc /app /run/olcrtc

COPY --from=builder /out/olcrtc /usr/local/bin/olcrtc
COPY --from=builder --chown=olcrtc:olcrtc /src/data /app/data
COPY --chown=olcrtc:olcrtc server.yaml.template /app/server.yaml.template
COPY --chown=olcrtc:olcrtc docker-entrypoint.sh /usr/local/bin/docker-entrypoint

RUN chmod 0755 /usr/local/bin/olcrtc /usr/local/bin/docker-entrypoint

WORKDIR /app
USER olcrtc
ENTRYPOINT ["/usr/local/bin/docker-entrypoint"]
