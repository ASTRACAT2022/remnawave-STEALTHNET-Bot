from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models import SingboxNodeStatus, SingboxProtocol, SingboxSlotStatus


class SingboxNodeCreate(BaseModel):
    name: str
    protocol: SingboxProtocol
    port: int
    tls_enabled: bool = False
    public_host: Optional[str] = None
    capacity: Optional[int] = None
    metadata: dict = Field(default_factory=dict)
    custom_config_json: Optional[str] = None
    token: Optional[str] = None


class SingboxNodePatch(BaseModel):
    name: Optional[str] = None
    port: Optional[int] = None
    tls_enabled: Optional[bool] = None
    public_host: Optional[str] = None
    capacity: Optional[int] = None
    status: Optional[SingboxNodeStatus] = None
    metadata: Optional[dict] = None
    custom_config_json: Optional[str] = None


class SingboxNodeResponse(BaseModel):
    id: str
    name: str
    token: str
    status: SingboxNodeStatus
    last_seen_at: Optional[datetime]
    public_host: Optional[str]
    port: int
    protocol: SingboxProtocol
    tls_enabled: bool
    capacity: Optional[int]
    current_connections: int
    traffic_in_bytes: int
    traffic_out_bytes: int
    metadata: dict
    custom_config_json: Optional[str]
    created_at: datetime
    updated_at: datetime
    active_slots: int = 0

    model_config = {"from_attributes": True}


class SingboxNodeProvisionResponse(BaseModel):
    node: SingboxNodeResponse
    docker_compose_yml: str
    setup_instructions: list[str]


class SingboxCategoryCreate(BaseModel):
    name: str
    sort_order: int = 0


class SingboxCategoryResponse(BaseModel):
    id: str
    name: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SingboxTariffCreate(BaseModel):
    category_id: str
    name: str
    slot_count: int = 1
    duration_days: int = 30
    traffic_limit_bytes: Optional[int] = None
    price: float
    currency: str = "USD"
    sort_order: int = 0
    enabled: bool = True


class SingboxTariffPatch(BaseModel):
    name: Optional[str] = None
    slot_count: Optional[int] = None
    duration_days: Optional[int] = None
    traffic_limit_bytes: Optional[int] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    sort_order: Optional[int] = None
    enabled: Optional[bool] = None


class SingboxTariffResponse(BaseModel):
    id: str
    category_id: str
    name: str
    slot_count: int
    duration_days: int
    traffic_limit_bytes: Optional[int]
    price: float
    currency: str
    sort_order: int
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SingboxSlotResponse(BaseModel):
    id: str
    node_id: str
    client_id: str
    singbox_tariff_id: Optional[str]
    user_identifier: str
    secret: Optional[str]
    expires_at: datetime
    traffic_limit_bytes: Optional[int]
    traffic_used_bytes: int
    current_connections: int
    status: SingboxSlotStatus
    created_at: datetime
    updated_at: datetime
    protocol: Optional[SingboxProtocol] = None
    node_name: Optional[str] = None
    public_host: Optional[str] = None
    port: Optional[int] = None
    tls_enabled: Optional[bool] = None
    subscription_link: Optional[str] = None

    model_config = {"from_attributes": True}


class SingboxPaymentConfirm(BaseModel):
    client_id: str
    singbox_tariff_id: str
    external_payment_id: str
    provider: str = "manual"


class SingboxPaymentConfirmResponse(BaseModel):
    payment_id: str
    order_id: str
    created_slots: list[SingboxSlotResponse]
    subscription_url: str


class SingboxAgentRegisterRequest(BaseModel):
    name: Optional[str] = None
    protocol: SingboxProtocol
    port: int
    tls_enabled: bool = False
    public_host: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class SingboxAgentRegisterResponse(BaseModel):
    node_id: str
    poll_interval_sec: int = 60


class SingboxAgentHeartbeatSlotMetric(BaseModel):
    slot_id: str
    traffic_used: int = 0
    connections: int = 0


class SingboxAgentHeartbeatRequest(BaseModel):
    connections: int = 0
    traffic_in: int = 0
    traffic_out: int = 0
    slots: list[SingboxAgentHeartbeatSlotMetric] = Field(default_factory=list)


class SingboxAgentSlot(BaseModel):
    slot_id: str
    user_identifier: str
    secret: Optional[str]
    expires_at: datetime
    traffic_limit_bytes: Optional[int]
    traffic_used_bytes: int
    status: SingboxSlotStatus


class SingboxAgentSlotsResponse(BaseModel):
    node_id: str
    protocol: SingboxProtocol
    port: int
    tls_enabled: bool
    custom_config_json: Optional[str]
    slots: list[SingboxAgentSlot]

