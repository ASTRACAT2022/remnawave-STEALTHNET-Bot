from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import ConfigRevision, ConfigRevisionStatus, Node, NodeStatus, Server
from app.schemas.nodes import (
    AgentApplyResult,
    AgentHeartbeat,
    AgentReportUsage,
    DesiredConfigResponse,
    NodeCreate,
    NodeResponse,
    ValidateDesiredConfigRequest,
    ValidateDesiredConfigResponse,
)
from app.services.audit import write_audit
from app.services.auth import AuthContext, get_auth_context
from app.services.rbac import require_scopes
from app.services.singbox_validation import SingboxValidationError, validate_desired_config
from app.services.traffic import report_usage
from app.services.webhooks import enqueue_event

admin_router = APIRouter(prefix="/nodes", tags=["nodes"])
agent_router = APIRouter(prefix="/agent", tags=["agent"])


def _validate_singbox_or_400(
    desired_config: dict,
    *,
    singbox_enabled: bool,
    require_singbox_present: bool = False,
) -> ValidateDesiredConfigResponse:
    try:
        result = validate_desired_config(
            desired_config,
            singbox_enabled=singbox_enabled,
            require_singbox_present=require_singbox_present,
        )
        return ValidateDesiredConfigResponse(
            ok=True,
            singbox_present=result.singbox_present,
            validated_by=result.validated_by,
        )
    except SingboxValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@admin_router.post("", response_model=NodeResponse, dependencies=[Depends(require_scopes("nodes.control"))])
def create_node(payload: NodeCreate, db: Session = Depends(get_db), ctx: AuthContext = Depends(get_auth_context)) -> Node:
    server = db.get(Server, payload.server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="server_not_found")

    _validate_singbox_or_400(payload.desired_config, singbox_enabled=payload.engine_singbox_enabled)

    node = Node(**payload.model_dump())
    db.add(node)
    db.flush()

    revision = ConfigRevision(node_id=node.id, revision=node.desired_config_revision, config=node.desired_config)
    db.add(revision)

    write_audit(db, ctx.principal_id, "node.created", "node", node.id, {"server_id": node.server_id})
    db.commit()
    db.refresh(node)
    return node


@admin_router.get("", response_model=list[NodeResponse], dependencies=[Depends(require_scopes("nodes.control"))])
def list_nodes(status_filter: Optional[str] = None, db: Session = Depends(get_db)) -> list[Node]:
    query = select(Node)
    if status_filter:
        query = query.where(Node.status == status_filter)
    return db.scalars(query.order_by(Node.last_seen_at.desc().nullslast())).all()


@admin_router.post(
    "/validate-config",
    response_model=ValidateDesiredConfigResponse,
    dependencies=[Depends(require_scopes("nodes.control"))],
)
def validate_node_config(payload: ValidateDesiredConfigRequest) -> ValidateDesiredConfigResponse:
    return _validate_singbox_or_400(
        payload.desired_config,
        singbox_enabled=payload.engine_singbox_enabled,
        require_singbox_present=True,
    )


@admin_router.post("/check-offline", dependencies=[Depends(require_scopes("nodes.control"))])
def check_offline_nodes(
    offline_after_seconds: int = 120,
    db: Session = Depends(get_db),
    ctx: AuthContext = Depends(get_auth_context),
) -> dict:
    now = datetime.now(timezone.utc)
    nodes = db.scalars(select(Node)).all()
    marked = 0
    for node in nodes:
        if not node.last_seen_at:
            continue
        delta = (now - node.last_seen_at).total_seconds()
        if delta > offline_after_seconds and node.status != NodeStatus.offline:
            node.status = NodeStatus.offline
            marked += 1
            enqueue_event(db, "node.offline", {"node_id": node.id, "last_seen_at": node.last_seen_at.isoformat()}, auto_commit=False)
            write_audit(db, ctx.principal_id, "node.marked_offline", "node", node.id, {"seconds_since_seen": int(delta)})
    db.commit()
    return {"ok": True, "marked_offline": marked}


@admin_router.post("/{node_id}/desired-config", dependencies=[Depends(require_scopes("nodes.control"))])
def update_desired_config(
    node_id: str,
    desired_config: dict = Body(default={}),
    db: Session = Depends(get_db),
    ctx: AuthContext = Depends(get_auth_context),
) -> dict:
    node = db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="node_not_found")

    _validate_singbox_or_400(desired_config, singbox_enabled=node.engine_singbox_enabled)

    node.desired_config_revision += 1
    node.desired_config = desired_config
    revision = ConfigRevision(node_id=node.id, revision=node.desired_config_revision, config=desired_config)
    db.add(revision)
    write_audit(
        db,
        ctx.principal_id,
        "node.desired_config_updated",
        "node",
        node.id,
        {"desired_revision": node.desired_config_revision},
    )
    db.commit()
    return {"ok": True, "desired_config_revision": node.desired_config_revision}


@admin_router.post("/{node_id}/rollback", dependencies=[Depends(require_scopes("nodes.control"))])
def rollback_node(
    node_id: str,
    to_revision: Optional[int] = Body(default=None),
    db: Session = Depends(get_db),
    ctx: AuthContext = Depends(get_auth_context),
) -> dict:
    node = db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="node_not_found")

    target_query = select(ConfigRevision).where(ConfigRevision.node_id == node.id)
    if to_revision is not None:
        target_query = target_query.where(ConfigRevision.revision == to_revision)
    target = db.scalar(target_query.order_by(desc(ConfigRevision.revision)))
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="revision_not_found")

    current_revision = node.desired_config_revision
    node.desired_config_revision += 1
    node.desired_config = target.config

    rollback_revision = ConfigRevision(
        node_id=node.id,
        revision=node.desired_config_revision,
        config=target.config,
        status=ConfigRevisionStatus.rolled_back,
        rolled_back_from=current_revision,
    )
    db.add(rollback_revision)
    write_audit(
        db,
        ctx.principal_id,
        "node.rollback_requested",
        "node",
        node.id,
        {"from": current_revision, "to": target.revision},
    )
    db.commit()

    return {"ok": True, "desired_config_revision": node.desired_config_revision, "rolled_back_to": target.revision}


@agent_router.post("/heartbeat")
def heartbeat(payload: AgentHeartbeat, db: Session = Depends(get_db)) -> dict:
    node = db.scalar(select(Node).where(Node.node_token == payload.node_token))
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="node_not_found")

    node.last_seen_at = datetime.now(timezone.utc)
    node.engine_awg2_version = payload.engine_awg2_version
    node.engine_singbox_version = payload.engine_singbox_version
    node.status = NodeStatus.online
    db.commit()
    return {"ok": True}


@agent_router.get("/desired-config", response_model=DesiredConfigResponse)
def desired_config(node_token: str = Query(...), db: Session = Depends(get_db)) -> DesiredConfigResponse:
    node = db.scalar(select(Node).where(Node.node_token == node_token))
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="node_not_found")

    return DesiredConfigResponse(
        node_id=node.id,
        desired_config_revision=node.desired_config_revision,
        applied_config_revision=node.applied_config_revision,
        engine_awg2_enabled=node.engine_awg2_enabled,
        engine_singbox_enabled=node.engine_singbox_enabled,
        desired_config=node.desired_config,
    )


@agent_router.post("/apply-result")
def apply_result(payload: AgentApplyResult, db: Session = Depends(get_db)) -> dict:
    node = db.scalar(select(Node).where(Node.node_token == payload.node_token))
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="node_not_found")

    node.applied_config_revision = payload.applied_config_revision
    node.last_apply_status = payload.status
    node.last_seen_at = datetime.now(timezone.utc)
    node.status = NodeStatus.online if payload.status == "success" else NodeStatus.error

    revision = db.scalar(
        select(ConfigRevision).where(
            ConfigRevision.node_id == node.id,
            ConfigRevision.revision == payload.applied_config_revision,
        )
    )
    if revision:
        revision.status = ConfigRevisionStatus.applied if payload.status == "success" else ConfigRevisionStatus.failed
        revision.applied_at = datetime.now(timezone.utc)

    write_audit(
        db,
        actor="node-agent",
        action="config.applied",
        entity_type="node",
        entity_id=node.id,
        payload={"status": payload.status, "revision": payload.applied_config_revision},
    )
    db.commit()

    enqueue_event(
        db,
        "config.applied",
        {"node_id": node.id, "status": payload.status, "revision": payload.applied_config_revision},
    )
    return {"ok": True}


@agent_router.post("/report-usage")
def usage(payload: AgentReportUsage, db: Session = Depends(get_db)) -> dict:
    report_usage(db, payload.node_token, payload.user_uuid, payload.bytes_used, payload.device_hash)
    return {"ok": True}
