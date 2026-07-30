# OlcRTC node for BillingStyle

This module builds the official `openlibrecommunity/olcrtc` source and runs an
OlcRTC **server** (`mode: srv`) in Docker. It is designed for `telemost` or
`wbstream` and uses Linux host networking so WebRTC/ICE traffic is not changed
by Docker NAT.

## Deploy

On a Linux VPS with Docker and the Compose plugin:

```sh
cd olcrtc-node
cp .env.telemost.example .env   # or: cp .env.wbstream.example .env
openssl rand -hex 32            # copy the result into OLCRTC_KEY in .env
nano .env                        # set room ID and key
docker compose up -d --build
docker compose logs -f olcrtc-node
```

Create the room in Telemost or WBStream before starting the container, then put
its ID into `OLCRTC_ROOM_ID`. Keep the provider, transport, room ID, key and
transport payload identical on the server and client.

The default is `vp8channel` with this BillingStyle payload:

```text
vp8-fps=25&vp8-batch=1
```

In BillingStyle open **Admin → OlcRTC → Nodes** and use:

| BillingStyle field | Telemost example | WBStream example |
| --- | --- | --- |
| Provider | `telemost` | `wbstream` |
| Transport | `vp8channel` | `vp8channel` |
| Room ID | `OLCRTC_ROOM_ID` | `OLCRTC_ROOM_ID` |
| Encryption key | `OLCRTC_KEY` | `OLCRTC_KEY` |
| Payload | `vp8-fps=25&vp8-batch=1` | `vp8-fps=25&vp8-batch=1` |

Do not use `datachannel` with Telemost. WBStream `datachannel` requires a
token with moderator rights; guest mode should use `vp8channel`, `seichannel`,
or `videochannel` instead.

## Operate and update

```sh
docker compose ps
docker compose logs -f olcrtc-node
docker compose restart olcrtc-node

# Update the official OlcRTC source selected by OLCRTC_REF, then rebuild.
docker compose build --no-cache olcrtc-node
docker compose up -d olcrtc-node
```

Never commit `.env`: it contains the shared encryption key and potentially a
WBStream account token. A direct `olcrtc://` link is a bearer configuration;
rotate the room and key if it leaks.
