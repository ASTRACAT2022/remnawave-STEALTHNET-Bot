import base64
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import (
    Order,
    OrderStatus,
    Payment,
    PaymentStatus,
    SingboxCategory,
    SingboxNode,
    SingboxNodeStatus,
    SingboxProtocol,
    SingboxSlot,
    SingboxSlotStatus,
    SingboxTariff,
    User,
)
from app.schemas.singbox import (
    SingboxAgentHeartbeatRequest,
    SingboxAgentRegisterRequest,
    SingboxAgentRegisterResponse,
    SingboxAgentSlot,
    SingboxAgentSlotsResponse,
    SingboxCategoryCreate,
    SingboxCategoryResponse,
    SingboxNodeCreate,
    SingboxNodePatch,
    SingboxNodeProvisionResponse,
    SingboxNodeResponse,
    SingboxPaymentConfirm,
    SingboxPaymentConfirmResponse,
    SingboxSlotResponse,
    SingboxTariffCreate,
    SingboxTariffPatch,
    SingboxTariffResponse,
)
from app.services.audit import write_audit
from app.services.rbac import require_scopes

admin_router = APIRouter(prefix="/singbox", tags=["singbox"])
agent_router = APIRouter(prefix="/api/singbox-nodes", tags=["singbox-agent"])

MANAGED_INBOUND_TAG = "stealthnet-in"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _db_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_custom_config_json(raw_json: Optional[str]) -> Optional[str]:
    if raw_json is None:
        return None
    raw_json = raw_json.strip()
    if not raw_json:
        return None
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_custom_config_json") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="custom_config_must_be_object")
    inbounds = parsed.get("inbounds")
    if not isinstance(inbounds, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="custom_config_missing_inbounds")
    if not any(isinstance(item, dict) and item.get("tag") == MANAGED_INBOUND_TAG for item in inbounds):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'custom_config_missing_tag_{MANAGED_INBOUND_TAG}',
        )
    return json.dumps(parsed, ensure_ascii=True)


def _default_config_for(protocol: SingboxProtocol, port: int, tls_enabled: bool) -> str:
    base_config = {
        "log": {"level": "info"},
        "inbounds": [],
        "outbounds": [{"type": "direct", "tag": "direct"}],
        "route": {"rules": []},
    }
    if protocol == SingboxProtocol.vless:
        inbound = {
            "type": "vless",
            "tag": MANAGED_INBOUND_TAG,
            "listen": "::",
            "listen_port": port,
            "users": [],
            "tls": {"enabled": tls_enabled},
        }
    elif protocol == SingboxProtocol.shadowsocks:
        inbound = {
            "type": "shadowsocks",
            "tag": MANAGED_INBOUND_TAG,
            "listen": "::",
            "listen_port": port,
            "method": "chacha20-ietf-poly1305",
            "users": [],
        }
    elif protocol == SingboxProtocol.trojan:
        inbound = {
            "type": "trojan",
            "tag": MANAGED_INBOUND_TAG,
            "listen": "::",
            "listen_port": port,
            "users": [],
            "tls": {"enabled": tls_enabled},
        }
    else:
        inbound = {
            "type": "hysteria2",
            "tag": MANAGED_INBOUND_TAG,
            "listen": "::",
            "listen_port": port,
            "users": [],
            "tls": {"enabled": tls_enabled},
        }
    base_config["inbounds"].append(inbound)
    return json.dumps(base_config, ensure_ascii=True)


def _build_compose_template(api_url: str, token: str, protocol: SingboxProtocol, port: int, tls_enabled: bool) -> str:
    return (
        'services:\n'
        "  singbox-node:\n"
        "    image: ghcr.io/stealthnet/singbox-node-agent:beta\n"
        "    container_name: singbox-node\n"
        "    restart: unless-stopped\n"
        "    network_mode: host\n"
        "    environment:\n"
        f'      STEALTHNET_API_URL: "{api_url}"\n'
        f'      SINGBOX_NODE_TOKEN: "{token}"\n'
        f'      SINGBOX_PROTOCOL: "{protocol.value}"\n'
        f'      SINGBOX_PORT: "{port}"\n'
        f'      SINGBOX_TLS_ENABLED: "{1 if tls_enabled else 0}"\n'
        "    volumes:\n"
        "      - ./config:/etc/sing-box\n"
        "      - ./data:/var/lib/singbox-agent\n"
    )


def _slot_is_available(slot: SingboxSlot, now: datetime) -> bool:
    if slot.status != SingboxSlotStatus.active:
        return False
    if _as_utc(slot.expires_at) <= now:
        return False
    if slot.traffic_limit_bytes is not None and slot.traffic_used_bytes >= slot.traffic_limit_bytes:
        return False
    return True


def _expire_slots(db: Session, *, node_id: Optional[str] = None, client_id: Optional[str] = None) -> None:
    now = _now()
    query = select(SingboxSlot).where(SingboxSlot.status == SingboxSlotStatus.active)
    if node_id:
        query = query.where(SingboxSlot.node_id == node_id)
    if client_id:
        query = query.where(SingboxSlot.client_id == client_id)
    for slot in db.scalars(query):
        if not _slot_is_available(slot, now):
            slot.status = SingboxSlotStatus.expired


def _make_slot_credentials(protocol: SingboxProtocol) -> tuple[str, Optional[str]]:
    if protocol == SingboxProtocol.vless:
        return str(uuid.uuid4()), None
    if protocol == SingboxProtocol.trojan:
        return str(uuid.uuid4()), secrets.token_urlsafe(18)
    return f"user-{secrets.token_hex(4)}", secrets.token_urlsafe(18)


def _format_slot_link(node: SingboxNode, slot: SingboxSlot) -> str:
    host = node.public_host or "127.0.0.1"
    name = quote(f"{node.name}-{slot.id[:8]}")
    if node.protocol == SingboxProtocol.vless:
        security = "tls" if node.tls_enabled else "none"
        return f"vless://{slot.user_identifier}@{host}:{node.port}?type=tcp&encryption=none&security={security}#{name}"
    if node.protocol == SingboxProtocol.shadowsocks:
        method = node.metadata_json.get("ss_method", "chacha20-ietf-poly1305")
        password = slot.secret or ""
        auth = base64.urlsafe_b64encode(f"{method}:{password}".encode("utf-8")).decode("utf-8").rstrip("=")
        return f"ss://{auth}@{host}:{node.port}#{name}"
    if node.protocol == SingboxProtocol.trojan:
        password = slot.secret or slot.user_identifier
        security = "tls" if node.tls_enabled else "none"
        return f"trojan://{password}@{host}:{node.port}?security={security}#{name}"
    auth = slot.secret or ""
    if slot.user_identifier and slot.secret:
        auth = f"{slot.user_identifier}:{slot.secret}"
    insecure = 0 if node.tls_enabled else 1
    return f"hysteria2://{auth}@{host}:{node.port}?insecure={insecure}#{name}"


def _serialize_node(db: Session, node: SingboxNode) -> SingboxNodeResponse:
    now = _db_now()
    active_slots = db.scalar(
        select(func.count(SingboxSlot.id)).where(
            SingboxSlot.node_id == node.id,
            SingboxSlot.status == SingboxSlotStatus.active,
            SingboxSlot.expires_at > now,
        )
    )
    return SingboxNodeResponse(
        id=node.id,
        name=node.name,
        token=node.token,
        status=node.status,
        last_seen_at=node.last_seen_at,
        public_host=node.public_host,
        port=node.port,
        protocol=node.protocol,
        tls_enabled=node.tls_enabled,
        capacity=node.capacity,
        current_connections=node.current_connections,
        traffic_in_bytes=node.traffic_in_bytes,
        traffic_out_bytes=node.traffic_out_bytes,
        metadata=node.metadata_json,
        custom_config_json=node.custom_config_json,
        created_at=node.created_at,
        updated_at=node.updated_at,
        active_slots=int(active_slots or 0),
    )


def _serialize_slot(slot: SingboxSlot, node: SingboxNode) -> SingboxSlotResponse:
    return SingboxSlotResponse(
        id=slot.id,
        node_id=slot.node_id,
        client_id=slot.client_id,
        singbox_tariff_id=slot.singbox_tariff_id,
        user_identifier=slot.user_identifier,
        secret=slot.secret,
        expires_at=slot.expires_at,
        traffic_limit_bytes=slot.traffic_limit_bytes,
        traffic_used_bytes=slot.traffic_used_bytes,
        current_connections=slot.current_connections,
        status=slot.status,
        created_at=slot.created_at,
        updated_at=slot.updated_at,
        protocol=node.protocol,
        node_name=node.name,
        public_host=node.public_host,
        port=node.port,
        tls_enabled=node.tls_enabled,
        subscription_link=_format_slot_link(node, slot),
    )


def _load_agent_node(db: Session, node_id: str, node_token: Optional[str]) -> SingboxNode:
    if not node_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_node_token")
    node = db.get(SingboxNode, node_id)
    if not node or node.token != node_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid_node_credentials")
    if node.status == SingboxNodeStatus.disabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="node_disabled")
    return node


def _select_nodes_for_slots(db: Session, slot_count: int) -> list[SingboxNode]:
    nodes = db.scalars(select(SingboxNode).where(SingboxNode.status == SingboxNodeStatus.online)).all()
    if not nodes:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="no_online_singbox_nodes")

    now = _db_now()
    counts = dict(
        db.execute(
            select(SingboxSlot.node_id, func.count(SingboxSlot.id))
            .where(SingboxSlot.status == SingboxSlotStatus.active, SingboxSlot.expires_at > now)
            .group_by(SingboxSlot.node_id)
        ).all()
    )

    selected: list[SingboxNode] = []
    mutable_load = {node.id: int(counts.get(node.id, 0)) for node in nodes}
    for _ in range(slot_count):
        candidates = [
            node
            for node in nodes
            if node.capacity is None or mutable_load[node.id] < int(node.capacity)
        ]
        if not candidates:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="no_capacity_for_requested_slots")
        candidates.sort(
            key=lambda node: (
                mutable_load[node.id] / max(int(node.capacity or 1), 1) if node.capacity else mutable_load[node.id],
                mutable_load[node.id],
                node.created_at,
            )
        )
        chosen = candidates[0]
        selected.append(chosen)
        mutable_load[chosen.id] += 1
    return selected


@admin_router.post(
    "/nodes",
    response_model=SingboxNodeProvisionResponse,
    dependencies=[Depends(require_scopes("nodes.control"))],
)
def create_singbox_node(
    payload: SingboxNodeCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> SingboxNodeProvisionResponse:
    if payload.protocol == SingboxProtocol.hysteria2 and not payload.tls_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="hysteria2_requires_tls")

    custom_config_json = _normalize_custom_config_json(payload.custom_config_json)
    token = payload.token or secrets.token_urlsafe(24)
    node = SingboxNode(
        name=payload.name,
        token=token,
        status=SingboxNodeStatus.offline,
        public_host=payload.public_host,
        port=payload.port,
        protocol=payload.protocol,
        tls_enabled=payload.tls_enabled,
        capacity=payload.capacity,
        metadata_json=payload.metadata,
        custom_config_json=custom_config_json,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    write_audit(
        db,
        actor="singbox",
        action="singbox.node.created",
        entity_type="singbox_node",
        entity_id=node.id,
        payload={"protocol": node.protocol.value, "port": node.port},
    )
    api_url = str(request.base_url).rstrip("/") + "/api"
    return SingboxNodeProvisionResponse(
        node=_serialize_node(db, node),
        docker_compose_yml=_build_compose_template(api_url, token, node.protocol, node.port, node.tls_enabled),
        setup_instructions=[
            "Save docker-compose.yml on target server",
            "Run: docker compose up -d",
            "Wait until node sends register and heartbeat",
        ],
    )


@admin_router.get("/nodes", response_model=list[SingboxNodeResponse], dependencies=[Depends(require_scopes("nodes.control"))])
def list_singbox_nodes(db: Session = Depends(get_db)) -> list[SingboxNodeResponse]:
    nodes = db.scalars(select(SingboxNode).order_by(SingboxNode.created_at.desc())).all()
    return [_serialize_node(db, node) for node in nodes]


@admin_router.get(
    "/nodes/{node_id}",
    response_model=SingboxNodeResponse,
    dependencies=[Depends(require_scopes("nodes.control"))],
)
def get_singbox_node(node_id: str, db: Session = Depends(get_db)) -> SingboxNodeResponse:
    node = db.get(SingboxNode, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="singbox_node_not_found")
    return _serialize_node(db, node)


@admin_router.patch(
    "/nodes/{node_id}",
    response_model=SingboxNodeResponse,
    dependencies=[Depends(require_scopes("nodes.control"))],
)
def patch_singbox_node(node_id: str, payload: SingboxNodePatch, db: Session = Depends(get_db)) -> SingboxNodeResponse:
    node = db.get(SingboxNode, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="singbox_node_not_found")

    changes = payload.model_dump(exclude_unset=True)
    if "custom_config_json" in changes:
        node.custom_config_json = _normalize_custom_config_json(changes.pop("custom_config_json"))
    if "metadata" in changes and changes["metadata"] is not None:
        node.metadata_json = changes.pop("metadata")
    if "protocol" in changes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="protocol_is_immutable")
    for field_name, value in changes.items():
        setattr(node, field_name, value)
    db.commit()
    db.refresh(node)
    return _serialize_node(db, node)


@admin_router.get(
    "/nodes/{node_id}/slots",
    response_model=list[SingboxSlotResponse],
    dependencies=[Depends(require_scopes("nodes.control"))],
)
def list_singbox_node_slots(node_id: str, db: Session = Depends(get_db)) -> list[SingboxSlotResponse]:
    node = db.get(SingboxNode, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="singbox_node_not_found")
    _expire_slots(db, node_id=node.id)
    db.commit()
    slots = db.scalars(select(SingboxSlot).where(SingboxSlot.node_id == node.id).order_by(SingboxSlot.created_at.desc())).all()
    return [_serialize_slot(slot, node) for slot in slots]


@admin_router.post(
    "/categories",
    response_model=SingboxCategoryResponse,
    dependencies=[Depends(require_scopes("billing.write"))],
)
def create_singbox_category(payload: SingboxCategoryCreate, db: Session = Depends(get_db)) -> SingboxCategory:
    category = SingboxCategory(name=payload.name, sort_order=payload.sort_order)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@admin_router.get(
    "/categories",
    response_model=list[SingboxCategoryResponse],
    dependencies=[Depends(require_scopes("billing.read"))],
)
def list_singbox_categories(db: Session = Depends(get_db)) -> list[SingboxCategory]:
    return db.scalars(select(SingboxCategory).order_by(SingboxCategory.sort_order, SingboxCategory.created_at)).all()


@admin_router.post(
    "/tariffs",
    response_model=SingboxTariffResponse,
    dependencies=[Depends(require_scopes("billing.write"))],
)
def create_singbox_tariff(payload: SingboxTariffCreate, db: Session = Depends(get_db)) -> SingboxTariff:
    category = db.get(SingboxCategory, payload.category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="singbox_category_not_found")
    tariff = SingboxTariff(**payload.model_dump())
    db.add(tariff)
    db.commit()
    db.refresh(tariff)
    return tariff


@admin_router.get(
    "/tariffs",
    response_model=list[SingboxTariffResponse],
    dependencies=[Depends(require_scopes("billing.read"))],
)
def list_singbox_tariffs(
    category_id: Optional[str] = Query(default=None),
    enabled_only: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[SingboxTariff]:
    query = select(SingboxTariff)
    if category_id:
        query = query.where(SingboxTariff.category_id == category_id)
    if enabled_only:
        query = query.where(SingboxTariff.enabled.is_(True))
    return db.scalars(query.order_by(SingboxTariff.sort_order, SingboxTariff.created_at)).all()


@admin_router.patch(
    "/tariffs/{tariff_id}",
    response_model=SingboxTariffResponse,
    dependencies=[Depends(require_scopes("billing.write"))],
)
def patch_singbox_tariff(tariff_id: str, payload: SingboxTariffPatch, db: Session = Depends(get_db)) -> SingboxTariff:
    tariff = db.get(SingboxTariff, tariff_id)
    if not tariff:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="singbox_tariff_not_found")
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        setattr(tariff, field_name, value)
    db.commit()
    db.refresh(tariff)
    return tariff


@admin_router.post(
    "/payments/confirm",
    response_model=SingboxPaymentConfirmResponse,
    dependencies=[Depends(require_scopes("billing.write"))],
)
def confirm_singbox_payment(payload: SingboxPaymentConfirm, db: Session = Depends(get_db)) -> SingboxPaymentConfirmResponse:
    user = db.get(User, payload.client_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")

    tariff = db.get(SingboxTariff, payload.singbox_tariff_id)
    if not tariff or not tariff.enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="singbox_tariff_not_found")

    _expire_slots(db, client_id=user.id)

    now = _db_now()
    order = Order(
        user_id=user.id,
        plan_id=None,
        singbox_tariff_id=tariff.id,
        status=OrderStatus.paid,
        total_amount=tariff.price,
        currency=tariff.currency,
        paid_at=now,
    )
    db.add(order)
    db.flush()

    payment = Payment(
        order_id=order.id,
        provider=payload.provider,
        external_payment_id=payload.external_payment_id,
        status=PaymentStatus.succeeded,
        singbox_tariff_id=tariff.id,
        amount=tariff.price,
        currency=tariff.currency,
    )
    db.add(payment)
    db.flush()

    node_assignments = _select_nodes_for_slots(db, tariff.slot_count)
    created_slots: list[SingboxSlot] = []
    for node in node_assignments:
        user_identifier, secret = _make_slot_credentials(node.protocol)
        slot = SingboxSlot(
            node_id=node.id,
            client_id=user.id,
            singbox_tariff_id=tariff.id,
            user_identifier=user_identifier,
            secret=secret,
            expires_at=now + timedelta(days=tariff.duration_days),
            traffic_limit_bytes=tariff.traffic_limit_bytes,
            status=SingboxSlotStatus.active,
        )
        db.add(slot)
        created_slots.append(slot)

    write_audit(
        db,
        actor="billing",
        action="singbox.payment.confirmed",
        entity_type="user",
        entity_id=user.id,
        payload={"tariff_id": tariff.id, "slot_count": tariff.slot_count},
    )
    db.commit()

    slots_response = []
    for slot in created_slots:
        db.refresh(slot)
        node = db.get(SingboxNode, slot.node_id)
        if node:
            slots_response.append(_serialize_slot(slot, node))

    return SingboxPaymentConfirmResponse(
        payment_id=payment.id,
        order_id=order.id,
        created_slots=slots_response,
        subscription_url=f"/api/v1/singbox/subscription/{user.id}/{user.subscription_token}",
    )


@admin_router.get(
    "/clients/{client_id}/slots",
    response_model=list[SingboxSlotResponse],
    dependencies=[Depends(require_scopes("users.read"))],
)
def list_client_singbox_slots(client_id: str, db: Session = Depends(get_db)) -> list[SingboxSlotResponse]:
    user = db.get(User, client_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")

    _expire_slots(db, client_id=user.id)
    db.commit()

    slots = db.scalars(select(SingboxSlot).where(SingboxSlot.client_id == user.id).order_by(SingboxSlot.created_at.desc())).all()
    node_ids = {slot.node_id for slot in slots}
    nodes = {node.id: node for node in db.scalars(select(SingboxNode).where(SingboxNode.id.in_(node_ids))).all()} if node_ids else {}
    return [_serialize_slot(slot, nodes[slot.node_id]) for slot in slots if slot.node_id in nodes]


@admin_router.get("/subscription/{client_id}/{token}")
def get_client_subscription(
    client_id: str,
    token: str,
    as_base64: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> Response:
    user = db.get(User, client_id)
    if not user or user.subscription_token != token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="subscription_not_found")

    _expire_slots(db, client_id=user.id)
    db.commit()

    now = _db_now()
    slots = db.scalars(
        select(SingboxSlot)
        .where(
            SingboxSlot.client_id == user.id,
            SingboxSlot.status == SingboxSlotStatus.active,
            SingboxSlot.expires_at > now,
        )
        .order_by(SingboxSlot.created_at.desc())
    ).all()
    if not slots:
        return Response(content="", media_type="text/plain; charset=utf-8")

    node_ids = {slot.node_id for slot in slots}
    nodes = {node.id: node for node in db.scalars(select(SingboxNode).where(SingboxNode.id.in_(node_ids))).all()}
    lines = []
    for slot in slots:
        node = nodes.get(slot.node_id)
        if not node or node.status == SingboxNodeStatus.disabled:
            continue
        lines.append(_format_slot_link(node, slot))
    payload = "\n".join(lines)
    if as_base64:
        payload = base64.b64encode(payload.encode("utf-8")).decode("utf-8")
    return Response(content=payload, media_type="text/plain; charset=utf-8")


@agent_router.post("/register", response_model=SingboxAgentRegisterResponse)
def register_singbox_node(
    payload: SingboxAgentRegisterRequest,
    db: Session = Depends(get_db),
    x_singbox_node_token: Optional[str] = Header(default=None, alias="X-Singbox-Node-Token"),
) -> SingboxAgentRegisterResponse:
    if not x_singbox_node_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_node_token")
    node = db.scalar(select(SingboxNode).where(SingboxNode.token == x_singbox_node_token))
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="singbox_node_not_found")
    if node.status == SingboxNodeStatus.disabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="node_disabled")
    if payload.protocol == SingboxProtocol.hysteria2 and not payload.tls_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="hysteria2_requires_tls")

    if payload.name:
        node.name = payload.name
    node.protocol = payload.protocol
    node.port = payload.port
    node.tls_enabled = payload.tls_enabled
    node.public_host = payload.public_host or node.public_host
    node.metadata_json = payload.metadata
    node.status = SingboxNodeStatus.online
    node.last_seen_at = _now()

    db.commit()
    return SingboxAgentRegisterResponse(node_id=node.id, poll_interval_sec=60)


@agent_router.post("/{node_id}/heartbeat")
def singbox_heartbeat(
    node_id: str,
    payload: SingboxAgentHeartbeatRequest,
    db: Session = Depends(get_db),
    x_singbox_node_token: Optional[str] = Header(default=None, alias="X-Singbox-Node-Token"),
) -> dict:
    node = _load_agent_node(db, node_id, x_singbox_node_token)
    node.status = SingboxNodeStatus.online
    node.last_seen_at = _now()
    node.current_connections = payload.connections
    node.traffic_in_bytes = payload.traffic_in
    node.traffic_out_bytes = payload.traffic_out

    slot_metrics = {item.slot_id: item for item in payload.slots}
    if slot_metrics:
        for slot in db.scalars(select(SingboxSlot).where(SingboxSlot.node_id == node.id, SingboxSlot.id.in_(slot_metrics.keys()))):
            metric = slot_metrics[slot.id]
            slot.traffic_used_bytes = metric.traffic_used
            slot.current_connections = metric.connections

    _expire_slots(db, node_id=node.id)
    db.commit()
    return {"ok": True}


@agent_router.get("/{node_id}/slots", response_model=SingboxAgentSlotsResponse)
def get_singbox_slots_for_agent(
    node_id: str,
    db: Session = Depends(get_db),
    x_singbox_node_token: Optional[str] = Header(default=None, alias="X-Singbox-Node-Token"),
) -> SingboxAgentSlotsResponse:
    node = _load_agent_node(db, node_id, x_singbox_node_token)
    _expire_slots(db, node_id=node.id)
    db.commit()

    now = _now()
    slots = db.scalars(
        select(SingboxSlot).where(
            SingboxSlot.node_id == node.id,
            SingboxSlot.status == SingboxSlotStatus.active,
            SingboxSlot.expires_at > now,
        )
    ).all()
    payload_slots = [
        SingboxAgentSlot(
            slot_id=slot.id,
            user_identifier=slot.user_identifier,
            secret=slot.secret,
            expires_at=slot.expires_at,
            traffic_limit_bytes=slot.traffic_limit_bytes,
            traffic_used_bytes=slot.traffic_used_bytes,
            status=slot.status,
        )
        for slot in slots
        if _slot_is_available(slot, now)
    ]
    return SingboxAgentSlotsResponse(
        node_id=node.id,
        protocol=node.protocol,
        port=node.port,
        tls_enabled=node.tls_enabled,
        custom_config_json=node.custom_config_json or _default_config_for(node.protocol, node.port, node.tls_enabled),
        slots=payload_slots,
    )
