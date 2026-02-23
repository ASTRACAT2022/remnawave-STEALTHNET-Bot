from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models import Order, OrderStatus, Payment, PaymentStatus, Plan, PlanSquadLink, User, UserStatus
from app.services.audit import write_audit


def confirm_payment_and_activate(db: Session, order_id: str, external_payment_id: str, provider: str) -> Payment:
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="order_not_found")

    if order.status == OrderStatus.paid:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="order_already_paid")

    user = db.get(User, order.user_id)
    if not order.plan_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="order_not_plan_based")

    plan = db.get(Plan, order.plan_id)
    if not user or not plan:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="order_inconsistent")

    payment = Payment(
        order_id=order.id,
        provider=provider,
        external_payment_id=external_payment_id,
        status=PaymentStatus.succeeded,
        amount=order.total_amount,
        currency=order.currency,
    )

    now = datetime.now(timezone.utc)
    order.status = OrderStatus.paid
    order.paid_at = now

    base = user.expires_at if user.expires_at and user.expires_at > now else now
    user.expires_at = base + timedelta(days=plan.duration_days)
    user.traffic_limit_bytes = plan.traffic_limit_bytes
    user.max_devices = plan.max_devices
    plan_squad = db.get(PlanSquadLink, plan.id)
    if plan_squad:
        user.squad_id = plan_squad.squad_id
    user.status = UserStatus.active

    db.add(payment)
    db.flush()
    write_audit(
        db,
        actor="billing",
        action="payment.confirmed",
        entity_type="order",
        entity_id=order.id,
        payload={"payment_id": payment.id, "user_id": user.id},
    )
    db.commit()
    db.refresh(payment)
    return payment


def reconcile_user_squads_by_latest_paid_plan(db: Session, *, dry_run: bool = True) -> dict:
    links = db.scalars(select(PlanSquadLink)).all()
    if not links:
        return {
            "dry_run": dry_run,
            "total_users_checked": 0,
            "eligible_users": 0,
            "users_to_update": 0,
            "users_updated": 0,
            "skipped_without_plan_mapping": 0,
            "changed_user_ids": [],
        }

    squad_by_plan_id = {link.plan_id: link.squad_id for link in links}
    paid_orders = db.scalars(
        select(Order)
        .where(
            Order.status == OrderStatus.paid,
            Order.plan_id.is_not(None),
        )
        .order_by(desc(Order.paid_at), desc(Order.created_at))
    ).all()

    latest_plan_by_user: dict[str, str] = {}
    skipped_without_plan_mapping = 0
    for order in paid_orders:
        if not order.plan_id:
            continue
        if order.user_id in latest_plan_by_user:
            continue
        squad_id = squad_by_plan_id.get(order.plan_id)
        if not squad_id:
            skipped_without_plan_mapping += 1
            continue
        latest_plan_by_user[order.user_id] = squad_id

    if not latest_plan_by_user:
        return {
            "dry_run": dry_run,
            "total_users_checked": 0,
            "eligible_users": 0,
            "users_to_update": 0,
            "users_updated": 0,
            "skipped_without_plan_mapping": skipped_without_plan_mapping,
            "changed_user_ids": [],
        }

    users = db.scalars(select(User).where(User.id.in_(list(latest_plan_by_user.keys())))).all()
    changed_user_ids = [user.id for user in users if latest_plan_by_user.get(user.id) != user.squad_id]

    users_updated = 0
    if not dry_run and changed_user_ids:
        for user in users:
            target_squad_id = latest_plan_by_user.get(user.id)
            if not target_squad_id or user.squad_id == target_squad_id:
                continue
            user.squad_id = target_squad_id
            users_updated += 1
        db.commit()

    return {
        "dry_run": dry_run,
        "total_users_checked": len(users),
        "eligible_users": len(latest_plan_by_user),
        "users_to_update": len(changed_user_ids),
        "users_updated": users_updated,
        "skipped_without_plan_mapping": skipped_without_plan_mapping,
        "changed_user_ids": changed_user_ids,
    }
