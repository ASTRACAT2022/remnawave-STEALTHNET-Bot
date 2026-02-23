from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PlanCreate(BaseModel):
    name: str
    price: float
    currency: str = "USD"
    duration_days: int = 30
    traffic_limit_bytes: int = 0
    max_devices: int = 1
    squad_id: Optional[str] = None


class PlanResponse(BaseModel):
    id: str
    name: str
    price: float
    currency: str
    duration_days: int
    traffic_limit_bytes: int
    max_devices: int
    is_active: bool
    squad_id: Optional[str] = None

    model_config = {"from_attributes": True}


class OrderCreate(BaseModel):
    user_id: str
    plan_id: str


class OrderResponse(BaseModel):
    id: str
    user_id: str
    plan_id: Optional[str]
    singbox_tariff_id: Optional[str] = None
    status: str
    total_amount: float
    currency: str
    created_at: datetime
    paid_at: Optional[datetime]

    model_config = {"from_attributes": True}


class PaymentConfirm(BaseModel):
    order_id: str
    external_payment_id: str
    provider: str = "manual"


class PaymentResponse(BaseModel):
    id: str
    order_id: str
    provider: str
    external_payment_id: str
    status: str
    singbox_tariff_id: Optional[str] = None
    amount: float
    currency: str

    model_config = {"from_attributes": True}


class ReconcileUserSquadsRequest(BaseModel):
    dry_run: bool = True


class ReconcileUserSquadsResponse(BaseModel):
    dry_run: bool
    total_users_checked: int
    eligible_users: int
    users_to_update: int
    users_updated: int
    skipped_without_plan_mapping: int
    changed_user_ids: list[str]
