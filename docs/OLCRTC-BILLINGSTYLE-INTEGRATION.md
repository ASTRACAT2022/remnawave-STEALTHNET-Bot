# OlcRTC direct links in BillingStyle

BillingStyle uses its own OlcRTC node catalogue and issues a direct client link
after payment. It does not call `olcrtc-manager` and does not create manager
subscriptions.

## Configure a node

1. Start OlcRTC server with a working room and shared 32-byte key.
2. In BillingStyle open **OlcRTC**, add a node and enter the provider,
   transport, room ID, 64-character hexadecimal encryption key, and optional
   transport payload.
3. Test the node to mark it online, assign it to a tariff, and enable the
   tariff.

For every successful payment, BillingStyle selects an available node and gives
the customer a link in the official format:

```text
olcrtc://<provider>?<transport><payload>@<room-id>#<encryption-key>$<name>
```

The official scheme is `olcrtc://`; `ortc://` is not the format documented by
the OlcRTC project.

## Important limitation

This is a bearer configuration: every client with the same server room and key
has the same technical access. BillingStyle records expiry, capacity and
revocation locally, but cannot disconnect one already-issued direct link from
the OlcRTC server. Individual technical revocation requires a separate room
and key (or a manager process) for each customer.
