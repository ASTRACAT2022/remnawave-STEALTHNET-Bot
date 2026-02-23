FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod /src/go.mod
COPY cmd /src/cmd
COPY internal /src/internal
RUN go build -o /out/pepoapple-agent ./cmd/agent
RUN GOBIN=/out go install github.com/amnezia-vpn/amneziawg-go@latest && cp /out/amneziawg-go /out/awg2 || \
    (printf '#!/bin/sh\necho "awg2 binary is not available in this image build"\nexit 127\n' > /out/awg2 && chmod +x /out/awg2)

FROM alpine:3.20
ARG TARGETARCH
ARG SINGBOX_VERSION=1.12.0
RUN apk add --no-cache ca-certificates curl tar && \
    ARCH="${TARGETARCH:-amd64}" && \
    case "$ARCH" in \
      amd64) SB_ARCH="amd64" ;; \
      arm64) SB_ARCH="arm64" ;; \
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-linux-${SB_ARCH}.tar.gz" -o /tmp/sing-box.tgz && \
    tar -xzf /tmp/sing-box.tgz -C /tmp && \
    install -m 0755 "/tmp/sing-box-${SINGBOX_VERSION}-linux-${SB_ARCH}/sing-box" /usr/local/bin/sing-box && \
    rm -rf /tmp/sing-box.tgz "/tmp/sing-box-${SINGBOX_VERSION}-linux-${SB_ARCH}"
COPY --from=build /out/pepoapple-agent /usr/local/bin/pepoapple-agent
COPY --from=build /out/awg2 /usr/local/bin/awg2
ENTRYPOINT ["/usr/local/bin/pepoapple-agent"]
