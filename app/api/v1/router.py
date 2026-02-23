from fastapi import APIRouter

from app.api.v1.endpoints import (
    analytics,
    audit,
    auth,
    backup,
    billing,
    health,
    infra_billing,
    migration,
    nodes,
    protocols,
    reseller,
    singbox,
    squads,
    subscription,
    users,
    webhooks,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(squads.router)
api_router.include_router(nodes.admin_router)
api_router.include_router(billing.router)
api_router.include_router(subscription.router)
api_router.include_router(infra_billing.router)
api_router.include_router(migration.router)
api_router.include_router(protocols.router)
api_router.include_router(webhooks.router)
api_router.include_router(reseller.router)
api_router.include_router(backup.router)
api_router.include_router(analytics.router)
api_router.include_router(audit.router)
api_router.include_router(singbox.admin_router)

agent_router = APIRouter()
agent_router.include_router(nodes.agent_router)
agent_router.include_router(singbox.agent_router)
