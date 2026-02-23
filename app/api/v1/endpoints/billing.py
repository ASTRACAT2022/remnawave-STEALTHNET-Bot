from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Order, OrderStatus, Payment, Plan, PlanSquadLink, Squad, User
from app.schemas.billing import (
    OrderCreate,
    OrderResponse,
    PaymentConfirm,
    PaymentResponse,
    PlanCreate,
    PlanResponse,
    ReconcileUserSquadsRequest,
    ReconcileUserSquadsResponse,
)
from app.services.audit import write_audit
from app.services.billing import confirm_payment_and_activate, reconcile_user_squads_by_latest_paid_plan
from app.services.rbac import require_scopes
from app.services.webhooks import enqueue_event

router = APIRouter(tags=["billing"])


@router.post("/plans", response_model=PlanResponse, dependencies=[Depends(require_scopes("billing.write"))])
def create_plan(payload: PlanCreate, db: Session = Depends(get_db)) -> PlanResponse:
    squad_id = payload.squad_id
    if squad_id:
        squad = db.get(Squad, squad_id)
        if not squad:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="squad_not_found")

    plan_data = payload.model_dump(exclude={"squad_id"})
    plan = Plan(**plan_data)
    db.add(plan)
    db.flush()

    if squad_id:
        db.add(PlanSquadLink(plan_id=plan.id, squad_id=squad_id))

    write_audit(db, "billing", "plan.created", "plan", plan.id, {"name": plan.name, "squad_id": squad_id})
    db.commit()
    db.refresh(plan)
    return PlanResponse(
        id=plan.id,
        name=plan.name,
        price=plan.price,
        currency=plan.currency,
        duration_days=plan.duration_days,
        traffic_limit_bytes=plan.traffic_limit_bytes,
        max_devices=plan.max_devices,
        is_active=plan.is_active,
        squad_id=squad_id,
    )


@router.get("/plans", response_model=list[PlanResponse], dependencies=[Depends(require_scopes("billing.read"))])
def list_plans(db: Session = Depends(get_db)) -> list[PlanResponse]:
    plans = db.scalars(select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.price)).all()
    links = db.scalars(select(PlanSquadLink).where(PlanSquadLink.plan_id.in_([plan.id for plan in plans]))).all() if plans else []
    squad_by_plan_id = {link.plan_id: link.squad_id for link in links}
    return [
        PlanResponse(
            id=plan.id,
            name=plan.name,
            price=plan.price,
            currency=plan.currency,
            duration_days=plan.duration_days,
            traffic_limit_bytes=plan.traffic_limit_bytes,
            max_devices=plan.max_devices,
            is_active=plan.is_active,
            squad_id=squad_by_plan_id.get(plan.id),
        )
        for plan in plans
    ]


@router.post(
    "/plans/{plan_id}/assign-squad",
    response_model=PlanResponse,
    dependencies=[Depends(require_scopes("billing.write"))],
)
def assign_plan_squad(plan_id: str, squad_id: str, db: Session = Depends(get_db)) -> PlanResponse:
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="plan_not_found")

    squad = db.get(Squad, squad_id)
    if not squad:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="squad_not_found")

    link = db.get(PlanSquadLink, plan.id)
    if link:
        link.squad_id = squad.id
    else:
        db.add(PlanSquadLink(plan_id=plan.id, squad_id=squad.id))
    db.commit()

    return PlanResponse(
        id=plan.id,
        name=plan.name,
        price=plan.price,
        currency=plan.currency,
        duration_days=plan.duration_days,
        traffic_limit_bytes=plan.traffic_limit_bytes,
        max_devices=plan.max_devices,
        is_active=plan.is_active,
        squad_id=squad.id,
    )


@router.post("/orders", response_model=OrderResponse, dependencies=[Depends(require_scopes("billing.write"))])
def create_order(
    payload: OrderCreate,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> Order:
    user = db.get(User, payload.user_id)
    plan = db.get(Plan, payload.plan_id)
    if not user or not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_or_plan_not_found")

    if idempotency_key:
        existing = db.scalar(select(Order).where(Order.idempotency_key == idempotency_key))
        if existing:
            return existing

    order = Order(
        user_id=user.id,
        plan_id=plan.id,
        total_amount=plan.price,
        currency=plan.currency,
        status=OrderStatus.pending,
        idempotency_key=idempotency_key,
    )
    db.add(order)
    write_audit(db, "billing", "order.created", "order", order.id, {"user_id": user.id, "plan_id": plan.id})
    db.commit()
    db.refresh(order)
    return order


@router.post("/payments/confirm", response_model=PaymentResponse, dependencies=[Depends(require_scopes("billing.write"))])
def confirm_payment(payload: PaymentConfirm, db: Session = Depends(get_db)) -> PaymentResponse:
    payment = confirm_payment_and_activate(db, payload.order_id, payload.external_payment_id, payload.provider)
    enqueue_event(db, "order.paid", {"order_id": payload.order_id, "payment_id": payment.id})
    return payment


@router.get("/orders/{order_id}", response_model=OrderResponse, dependencies=[Depends(require_scopes("billing.read"))])
def get_order(order_id: str, db: Session = Depends(get_db)) -> Order:
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="order_not_found")
    return order


@router.get("/orders", response_model=list[OrderResponse], dependencies=[Depends(require_scopes("billing.read"))])
def list_orders(limit: int = 100, db: Session = Depends(get_db)) -> list[Order]:
    return db.scalars(select(Order).order_by(Order.created_at.desc()).limit(limit)).all()


@router.get("/payments", response_model=list[PaymentResponse], dependencies=[Depends(require_scopes("billing.read"))])
def list_payments(limit: int = 100, db: Session = Depends(get_db)) -> list[Payment]:
    return db.scalars(select(Payment).order_by(Payment.created_at.desc()).limit(limit)).all()


@router.post(
    "/plans/reconcile-user-squads",
    response_model=ReconcileUserSquadsResponse,
    dependencies=[Depends(require_scopes("billing.write"))],
)
def reconcile_user_squads(payload: ReconcileUserSquadsRequest, db: Session = Depends(get_db)) -> ReconcileUserSquadsResponse:
    return reconcile_user_squads_by_latest_paid_plan(db, dry_run=payload.dry_run)
