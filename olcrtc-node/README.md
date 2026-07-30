# OlcRTC node for BillingStyle

This module builds the official `openlibrecommunity/olcrtc` source and runs an
OlcRTC **server** (`mode: srv`) in Docker. It is designed for `telemost` or
`wbstream` and uses Linux host networking so WebRTC/ICE traffic is not changed
by Docker NAT.

## Personal subscriptions (recommended)

This is the mode used when each buyer selects Telemost/WBStream and inserts
their own room link in the cabinet. BillingStyle generates a new 64-character
encryption key, asks the provisioner to start one dedicated container, and
then returns that buyer's `olcrtc://` link. When the subscription is revoked or
expires, BillingStyle stops and removes that dedicated container.

On the Linux VPS that will run the OlcRTC containers:

```sh
cd olcrtc-node
cp .env.personal.example .env
openssl rand -hex 32             # paste the result into OLCRTC_PROVISIONER_TOKEN
nano .env
docker compose build olcrtc-node provisioner
docker compose up -d provisioner
docker compose logs -f provisioner
```

The provisioner needs access to `/var/run/docker.sock`, therefore it has full
control over Docker on that VPS. Keep it on a trusted host. Set
`OLCRTC_PROVISIONER_LISTEN` to a private IP where possible. If you must use
`0.0.0.0:9500`, firewall port `9500` so **only the BillingStyle backend IP**
can reach it.

Then in **Admin → OlcRTC → Nodes → Add node** choose **Personal server for
each subscription**, fill in:

| BillingStyle field | Value |
| --- | --- |
| URL provisioner | `http://VPS_IP:9500` (or its private address) |
| Token provisioner | `OLCRTC_PROVISIONER_TOKEN` from `.env` |
| Capacity | Maximum number of personal containers you permit |

Click **Test**; it marks a reachable provisioner as ONLINE. Create an enabled
tariff and assign this node. After payment, the buyer opens **Cabinet →
OlcRTC → Configure**, selects **Telemost** or **WBStream**, and inserts their
own room URL/ID. The system issues a personal `vp8channel` configuration with
`vp8-fps=25&vp8-batch=1`.

## Shared static link (legacy mode)

On a Linux VPS with Docker and the Compose plugin:

```sh
cd olcrtc-node
cp .env.telemost.example .env   # or: cp .env.wbstream.example .env
openssl rand -hex 32            # copy the result into OLCRTC_KEY in .env
nano .env                        # set room ID and key
docker compose --profile standalone up -d --build
docker compose logs -f olcrtc-node
```

Create the room in Telemost or WBStream before starting the container, then put
its ID into `OLCRTC_ROOM_ID`. Keep the provider, transport, room ID, key and
transport payload identical on the server and client.

The default is `vp8channel` with this BillingStyle payload:

```text
vp8-fps=25&vp8-batch=1
```

In BillingStyle open **Admin → OlcRTC → Nodes**, select **Shared static link**
and use:

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

For personal subscriptions, update the images and provisioner together:

```sh
docker compose build --no-cache olcrtc-node provisioner
docker compose up -d provisioner
```

Never commit `.env`: it contains a provisioner control token and may contain a
shared encryption key or WBStream account token. An `olcrtc://` link is a
bearer configuration; rotate a leaked static room/key immediately.
