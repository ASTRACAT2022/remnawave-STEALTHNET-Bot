import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserStatus(str, enum.Enum):
    active = "active"
    blocked = "blocked"
    expired = "expired"
    deleted = "deleted"


class RoleName(str, enum.Enum):
    super_admin = "super_admin"
    admin = "admin"
    operator = "operator"
    billing_manager = "billing_manager"
    support = "support"
    reseller = "reseller"
    user = "user"


class SquadSelectionPolicy(str, enum.Enum):
    random = "random"
    weighted = "weighted"
    round_robin = "round-robin"
    geo = "geo"


class NodeStatus(str, enum.Enum):
    online = "online"
    offline = "offline"
    error = "error"
    provisioning = "provisioning"


class OrderStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    cancelled = "cancelled"


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    succeeded = "succeeded"
    failed = "failed"


class MigrationMode(str, enum.Enum):
    dry_run = "dry-run"
    apply = "apply"
    verify = "verify"


class MigrationStatus(str, enum.Enum):
    started = "started"
    finished = "finished"
    failed = "failed"


class ApiKeyStatus(str, enum.Enum):
    active = "active"
    revoked = "revoked"


class ProtocolType(str, enum.Enum):
    awg2 = "AWG2"
    tuic = "TUIC"
    vless = "VLESS"
    sing_box = "Sing-box"


class WebhookDeliveryStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"


class DeviceEvictionPolicy(str, enum.Enum):
    reject = "reject"
    evict_oldest = "evict_oldest"


class ConfigRevisionStatus(str, enum.Enum):
    desired = "desired"
    applied = "applied"
    failed = "failed"
    rolled_back = "rolled_back"


class SingboxNodeStatus(str, enum.Enum):
    online = "ONLINE"
    offline = "OFFLINE"
    disabled = "DISABLED"


class SingboxProtocol(str, enum.Enum):
    vless = "VLESS"
    shadowsocks = "SHADOWSOCKS"
    trojan = "TROJAN"
    hysteria2 = "HYSTERIA2"


class SingboxSlotStatus(str, enum.Enum):
    active = "ACTIVE"
    expired = "EXPIRED"
    revoked = "REVOKED"


class Reseller(Base):
    __tablename__ = "resellers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="reseller")
    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="reseller")


class AuthPrincipal(Base):
    __tablename__ = "auth_principals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[RoleName] = mapped_column(Enum(RoleName), default=RoleName.admin)
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    refresh_token_version: Mapped[int] = mapped_column(Integer, default=1)
    reseller_id: Mapped[Optional[str]] = mapped_column(ForeignKey("resellers.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128))
    key_prefix: Mapped[str] = mapped_column(String(16), index=True)
    key_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[ApiKeyStatus] = mapped_column(Enum(ApiKeyStatus), default=ApiKeyStatus.active)
    owner_principal_id: Mapped[str] = mapped_column(ForeignKey("auth_principals.id"), index=True)
    reseller_id: Mapped[Optional[str]] = mapped_column(ForeignKey("resellers.id"), nullable=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    reseller: Mapped["Reseller"] = relationship(back_populates="api_keys")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    external_identities: Mapped[dict] = mapped_column(JSON, default=dict)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    vless_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    short_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus), default=UserStatus.active)
    traffic_limit_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    traffic_used_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    max_devices: Mapped[int] = mapped_column(Integer, default=1)
    hwid_policy: Mapped[str] = mapped_column(String(64), default="none")
    strict_bind: Mapped[bool] = mapped_column(Boolean, default=False)
    device_eviction_policy: Mapped[DeviceEvictionPolicy] = mapped_column(
        Enum(DeviceEvictionPolicy), default=DeviceEvictionPolicy.reject
    )
    squad_id: Mapped[Optional[str]] = mapped_column(ForeignKey("squads.id"), nullable=True)
    reseller_id: Mapped[Optional[str]] = mapped_column(ForeignKey("resellers.id"), nullable=True, index=True)
    subscription_token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    squad: Mapped["Squad"] = relationship(back_populates="users")
    reseller: Mapped["Reseller"] = relationship(back_populates="users")
    devices: Mapped[list["Device"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    singbox_slots: Mapped[list["SingboxSlot"]] = relationship(back_populates="client")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    device_hash: Mapped[str] = mapped_column(String(128), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="devices")


class Squad(Base):
    __tablename__ = "squads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    selection_policy: Mapped[SquadSelectionPolicy] = mapped_column(
        Enum(SquadSelectionPolicy), default=SquadSelectionPolicy.round_robin
    )
    fallback_policy: Mapped[str] = mapped_column(String(128), default="none")
    allowed_protocols: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    servers: Mapped[list["Server"]] = relationship(back_populates="squad", cascade="all, delete-orphan")
    users: Mapped[list["User"]] = relationship(back_populates="squad")


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    host: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    provider: Mapped[str] = mapped_column(String(128), default="")
    region: Mapped[str] = mapped_column(String(128), default="")
    squad_id: Mapped[str] = mapped_column(ForeignKey("squads.id"), index=True)
    status: Mapped[str] = mapped_column(String(64), default="active")
    last_paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    price: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    infra_status: Mapped[str] = mapped_column(String(64), default="ok")
    reminder_days_before: Mapped[int] = mapped_column(Integer, default=3)

    squad: Mapped["Squad"] = relationship(back_populates="servers")
    node: Mapped["Node"] = relationship(back_populates="server", uselist=False)


class ProtocolProfile(Base):
    __tablename__ = "protocol_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    protocol_type: Mapped[ProtocolType] = mapped_column(Enum(ProtocolType))
    schema_json: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    server_id: Mapped[str] = mapped_column(ForeignKey("servers.id"), unique=True, index=True)
    node_token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    engine_awg2_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    engine_singbox_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    engine_awg2_version: Mapped[str] = mapped_column(String(64), default="")
    engine_singbox_version: Mapped[str] = mapped_column(String(64), default="")
    desired_config_revision: Mapped[int] = mapped_column(Integer, default=1)
    applied_config_revision: Mapped[int] = mapped_column(Integer, default=0)
    last_apply_status: Mapped[str] = mapped_column(String(64), default="pending")
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[NodeStatus] = mapped_column(Enum(NodeStatus), default=NodeStatus.provisioning)
    desired_config: Mapped[dict] = mapped_column(JSON, default=dict)

    server: Mapped["Server"] = relationship(back_populates="node")
    config_revisions: Mapped[list["ConfigRevision"]] = relationship(back_populates="node", cascade="all, delete-orphan")


class SingboxNode(Base):
    __tablename__ = "singbox_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128))
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    status: Mapped[SingboxNodeStatus] = mapped_column(Enum(SingboxNodeStatus), default=SingboxNodeStatus.offline)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    public_host: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    port: Mapped[int] = mapped_column(Integer)
    protocol: Mapped[SingboxProtocol] = mapped_column(Enum(SingboxProtocol))
    tls_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    capacity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    current_connections: Mapped[int] = mapped_column(Integer, default=0)
    traffic_in_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    traffic_out_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    custom_config_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    slots: Mapped[list["SingboxSlot"]] = relationship(back_populates="node", cascade="all, delete-orphan")


class SingboxCategory(Base):
    __tablename__ = "singbox_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tariffs: Mapped[list["SingboxTariff"]] = relationship(back_populates="category", cascade="all, delete-orphan")


class SingboxTariff(Base):
    __tablename__ = "singbox_tariffs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category_id: Mapped[str] = mapped_column(ForeignKey("singbox_categories.id"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    slot_count: Mapped[int] = mapped_column(Integer, default=1)
    duration_days: Mapped[int] = mapped_column(Integer, default=30)
    traffic_limit_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    price: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    category: Mapped["SingboxCategory"] = relationship(back_populates="tariffs")
    slots: Mapped[list["SingboxSlot"]] = relationship(back_populates="tariff")


class SingboxSlot(Base):
    __tablename__ = "singbox_slots"
    __table_args__ = (UniqueConstraint("node_id", "user_identifier", name="uq_singbox_slot_node_user_identifier"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    node_id: Mapped[str] = mapped_column(ForeignKey("singbox_nodes.id"), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    singbox_tariff_id: Mapped[Optional[str]] = mapped_column(ForeignKey("singbox_tariffs.id"), nullable=True, index=True)
    user_identifier: Mapped[str] = mapped_column(String(128))
    secret: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    traffic_limit_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    traffic_used_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    current_connections: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[SingboxSlotStatus] = mapped_column(Enum(SingboxSlotStatus), default=SingboxSlotStatus.active)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    node: Mapped["SingboxNode"] = relationship(back_populates="slots")
    client: Mapped["User"] = relationship(back_populates="singbox_slots")
    tariff: Mapped[Optional["SingboxTariff"]] = relationship(back_populates="slots")


class ConfigRevision(Base):
    __tablename__ = "config_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[ConfigRevisionStatus] = mapped_column(Enum(ConfigRevisionStatus), default=ConfigRevisionStatus.desired)
    rolled_back_from: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    node: Mapped["Node"] = relationship(back_populates="config_revisions")


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    price: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    duration_days: Mapped[int] = mapped_column(Integer, default=30)
    traffic_limit_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    max_devices: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanSquadLink(Base):
    __tablename__ = "plan_squad_links"

    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.id"), primary_key=True)
    squad_id: Mapped[str] = mapped_column(ForeignKey("squads.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    plan_id: Mapped[Optional[str]] = mapped_column(ForeignKey("plans.id"), index=True, nullable=True)
    singbox_tariff_id: Mapped[Optional[str]] = mapped_column(ForeignKey("singbox_tariffs.id"), index=True, nullable=True)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.pending)
    total_amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    provider: Mapped[str] = mapped_column(String(64), default="manual")
    external_payment_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus), default=PaymentStatus.pending)
    singbox_tariff_id: Mapped[Optional[str]] = mapped_column(ForeignKey("singbox_tariffs.id"), index=True, nullable=True)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SubscriptionAlias(Base):
    __tablename__ = "subscription_aliases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    legacy_token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    subscription_token: Mapped[str] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NodeUsage(Base):
    __tablename__ = "node_usage"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    bytes_used: Mapped[int] = mapped_column(BigInteger)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MigrationRun(Base):
    __tablename__ = "migration_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    mode: Mapped[MigrationMode] = mapped_column(Enum(MigrationMode))
    status: Mapped[MigrationStatus] = mapped_column(Enum(MigrationStatus), default=MigrationStatus.started)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class WebhookEndpoint(Base):
    __tablename__ = "webhook_endpoints"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128))
    target_url: Mapped[str] = mapped_column(String(1024))
    secret: Mapped[str] = mapped_column(String(255))
    events: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    endpoint_id: Mapped[str] = mapped_column(ForeignKey("webhook_endpoints.id"), index=True)
    event: Mapped[str] = mapped_column(String(128), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[WebhookDeliveryStatus] = mapped_column(Enum(WebhookDeliveryStatus), default=WebhookDeliveryStatus.pending)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    response_status: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class BackupSnapshot(Base):
    __tablename__ = "backup_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    storage_type: Mapped[str] = mapped_column(String(32), default="local")
    file_path: Mapped[str] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(32), default="created")
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor: Mapped[str] = mapped_column(String(128), default="system")
    action: Mapped[str] = mapped_column(String(128), index=True)
    entity_type: Mapped[str] = mapped_column(String(128), index=True)
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
