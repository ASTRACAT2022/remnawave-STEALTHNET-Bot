from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class NodeCreate(BaseModel):
    server_id: str
    node_token: str
    engine_awg2_enabled: bool = True
    engine_singbox_enabled: bool = True
    desired_config: dict = Field(default_factory=dict)


class NodeResponse(BaseModel):
    id: str
    server_id: str
    node_token: str
    desired_config_revision: int
    applied_config_revision: int
    last_apply_status: str
    last_seen_at: Optional[datetime]
    status: str

    model_config = {"from_attributes": True}


class AgentHeartbeat(BaseModel):
    node_token: str
    engine_awg2_version: str = ""
    engine_singbox_version: str = ""


class AgentApplyResult(BaseModel):
    node_token: str
    applied_config_revision: int
    status: str
    details: dict = Field(default_factory=dict)


class AgentReportUsage(BaseModel):
    node_token: str
    user_uuid: str
    bytes_used: int
    device_hash: Optional[str] = None


class DesiredConfigResponse(BaseModel):
    node_id: str
    desired_config_revision: int
    applied_config_revision: int
    engine_awg2_enabled: bool = True
    engine_singbox_enabled: bool = True
    desired_config: dict


class ValidateDesiredConfigRequest(BaseModel):
    desired_config: dict = Field(default_factory=dict)
    engine_singbox_enabled: bool = True


class ValidateDesiredConfigResponse(BaseModel):
    ok: bool = True
    singbox_present: bool
    validated_by: str
