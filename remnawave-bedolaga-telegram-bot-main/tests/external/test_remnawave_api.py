from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.external.remnawave_api import RemnaWaveAPI, RemnaWaveAPIError


@pytest.fixture
def anyio_backend() -> str:
    return 'asyncio'


def _build_api() -> RemnaWaveAPI:
    return RemnaWaveAPI(base_url='https://panel.example', api_key='token')


def _sample_user() -> dict:
    timestamp = '2026-01-01T00:00:00Z'
    return {
        'uuid': 'user-uuid',
        'shortUuid': 'short-uuid',
        'username': 'test-user',
        'status': 'ACTIVE',
        'trafficLimitBytes': 0,
        'trafficLimitStrategy': 'NO_RESET',
        'expireAt': timestamp,
        'subscriptionUrl': '',
        'activeInternalSquads': [],
        'createdAt': timestamp,
        'updatedAt': timestamp,
    }


@pytest.mark.anyio('asyncio')
async def test_get_user_by_telegram_id_returns_empty_on_semantic_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    api = _build_api()

    async def fake_make_request(*args, **kwargs):
        raise RemnaWaveAPIError(
            'User with specified params not found',
            status_code=400,
            response_data={'message': 'User with specified params not found'},
        )

    monkeypatch.setattr(api, '_make_request', fake_make_request, raising=False)

    users = await api.get_user_by_telegram_id(123456)
    assert users == []


@pytest.mark.anyio('asyncio')
async def test_get_user_by_uuid_returns_none_on_semantic_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    api = _build_api()

    async def fake_make_request(*args, **kwargs):
        raise RemnaWaveAPIError(
            'User with specified params not found',
            status_code=400,
            response_data={'message': 'User with specified params not found'},
        )

    monkeypatch.setattr(api, '_make_request', fake_make_request, raising=False)

    user = await api.get_user_by_uuid('missing-uuid')
    assert user is None


@pytest.mark.anyio('asyncio')
async def test_get_user_by_telegram_id_accepts_single_object_response(monkeypatch: pytest.MonkeyPatch) -> None:
    api = _build_api()

    async def fake_make_request(*args, **kwargs):
        return {'response': _sample_user()}

    async def fake_enrich(user):
        return user

    monkeypatch.setattr(api, '_make_request', fake_make_request, raising=False)
    monkeypatch.setattr(api, 'enrich_user_with_happ_link', fake_enrich, raising=False)

    users = await api.get_user_by_telegram_id(123456)

    assert len(users) == 1
    assert users[0].uuid == 'user-uuid'

