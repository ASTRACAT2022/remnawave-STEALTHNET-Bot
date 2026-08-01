#!/bin/sh
# Build sequentially: concurrent Go builds are slower and can exhaust a small VPS.
set -eu

docker compose build provisioner
docker compose build olcrtc-node
