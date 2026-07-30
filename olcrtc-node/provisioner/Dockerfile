FROM golang:1.25-alpine AS builder

WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/olcrtc-provisioner .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=builder /out/olcrtc-provisioner /usr/local/bin/olcrtc-provisioner
# The Docker socket is intentionally mounted for lifecycle control. It is
# normally root-owned, so this process must run as root inside its isolated
# container. Never expose the provisioner port to the public Internet.
ENTRYPOINT ["/usr/local/bin/olcrtc-provisioner"]
