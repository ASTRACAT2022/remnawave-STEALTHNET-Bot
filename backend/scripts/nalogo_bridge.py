#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
import re
import socket
import sys
import time
import warnings
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

# Keep bridge output deterministic (JSON only) and avoid noisy deprecated warnings.
warnings.filterwarnings("ignore", category=DeprecationWarning)


def emit(payload: dict[str, Any], code: int) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    raise SystemExit(code)


def extract_uuid(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    m = re.search(r"/receipt/([^/]+)/", s)
    if m:
        return m.group(1)
    m = re.search(r"/receipt/([^/]+)$", s)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{8,}", s):
        return s
    return None


def to_plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [to_plain(v) for v in value]
    if isinstance(value, tuple):
        return [to_plain(v) for v in value]
    if isinstance(value, dict):
        return {str(k): to_plain(v) for k, v in value.items()}
    if hasattr(value, "model_dump") and callable(getattr(value, "model_dump")):
        try:
            dumped = value.model_dump()  # type: ignore[attr-defined]
            return to_plain(dumped)
        except Exception:
            pass
    if hasattr(value, "dict") and callable(getattr(value, "dict")):
        try:
            dumped = value.dict()  # type: ignore[attr-defined]
            return to_plain(dumped)
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        try:
            return {str(k): to_plain(v) for k, v in vars(value).items()}
        except Exception:
            pass
    return str(value)


def find_uuid_deep(value: Any) -> str | None:
    direct = extract_uuid(value)
    if direct:
        return direct
    if isinstance(value, dict):
        for key in (
            "id",
            "approvedReceiptUuid",
            "receiptUuid",
            "uuid",
            "receiptUrl",
            "printUrl",
            "url",
            "link",
        ):
            if key in value:
                found = find_uuid_deep(value[key])
                if found:
                    return found
        for nested in value.values():
            found = find_uuid_deep(nested)
            if found:
                return found
        return None
    if isinstance(value, list):
        for item in value:
            found = find_uuid_deep(item)
            if found:
                return found
    return None


def classify_error(message: str) -> tuple[int, bool]:
    msg = message.lower()
    if (
        "невер" in msg
        or "wrong password" in msg
        or "invalid password" in msg
        or "invalid credentials" in msg
        or "unauthorized" in msg
        or "auth failed" in msg
        or "401" in msg
    ):
        return 401, False
    if "429" in msg or "too many" in msg or "rate limit" in msg:
        return 429, True
    if (
        "timeout" in msg
        or "timed out" in msg
        or "connect" in msg
        or "connection" in msg
        or "network" in msg
        or "socket" in msg
        or "proxy" in msg
    ):
        return 504, True
    return 502, True


def read_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except Exception:
        return default
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value


def read_env_timeout_seconds(name: str, default_ms: int, minimum_ms: int, maximum_ms: int) -> float:
    return read_env_int(name, default_ms, minimum_ms, maximum_ms) / 1000.0


def parse_proxy_url(raw: str) -> tuple[str, int, str | None, str | None] | None:
    value = (raw or "").strip()
    if not value:
        return None

    parsed = urlparse(value)
    if parsed.scheme == "tg" and parsed.netloc == "socks":
        qs = parse_qs(parsed.query)
        host = (qs.get("server", [""])[0] or "").strip()
        port_raw = (qs.get("port", ["1080"])[0] or "1080").strip()
        user = (qs.get("user", [""])[0] or "").strip() or None
        password = (qs.get("pass", [""])[0] or "").strip() or None
        if not host:
            raise ValueError("proxy server is required in tg://socks URL")
        try:
            port = int(port_raw)
        except Exception as exc:
            raise ValueError("invalid proxy port in tg://socks URL") from exc
        if port <= 0 or port > 65535:
            raise ValueError("proxy port out of range")
        return host, port, user, password

    if parsed.scheme not in ("socks5", "socks5h", "socks"):
        raise ValueError("only socks5/socks5h/tg://socks proxy URL is supported")

    host = (parsed.hostname or "").strip()
    if not host:
        raise ValueError("proxy host is required")
    port = int(parsed.port or 1080)
    if port <= 0 or port > 65535:
        raise ValueError("proxy port out of range")
    user = unquote(parsed.username) if parsed.username else None
    password = unquote(parsed.password) if parsed.password else None
    return host, port, user, password


def apply_socks_proxy_from_env() -> None:
    raw_proxy = (os.getenv("NALOGO_PROXY_URL") or "").strip()
    if not raw_proxy:
        return

    proxy = parse_proxy_url(raw_proxy)
    if proxy is None:
        return
    host, port, user, password = proxy

    try:
        import socks  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"PySocks import failed: {exc}") from exc

    socks.set_default_proxy(
        socks.SOCKS5,
        host,
        port,
        True,
        user,
        password,
    )
    socket.socket = socks.socksocket  # type: ignore[assignment]


def should_try_nalogovich_fallback(exc: Exception) -> bool:
    # `nalogapi` often crashes with KeyError('refreshToken') on unstable auth responses.
    # In such case we can transparently fallback to nalogovich.
    if (os.getenv("NALOGO_BRIDGE_USE_NALOGOVICH_FALLBACK") or "true").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    ):
        return False
    msg = f"{type(exc).__name__}: {exc}".lower()
    return "refreshtoken" in msg or "keyerror" in msg


def auth_via_nalogapi(inn: str, password: str) -> str:
    from nalogapi import NalogAPI

    NalogAPI.configure(inn, password)
    return "NalogAPI auth successful"


async def auth_via_nalogovich(inn: str, password: str, auth_timeout_s: float) -> str:
    from nalogovich.lknpd import NpdClient

    async with NpdClient(inn=inn, password=password) as client:
        await asyncio.wait_for(client.auth(), timeout=auth_timeout_s)
    return "Nalogovich auth successful"


def create_income_via_nalogapi(inn: str, password: str, name: str, amount_rub: float) -> Any:
    from nalogapi import NalogAPI

    NalogAPI.configure(inn, password)
    # Use timezone-aware UTC datetime.
    return NalogAPI.addIncome(datetime.now(timezone.utc), round(amount_rub, 2), name)


async def create_income_via_nalogovich(
    inn: str,
    password: str,
    name: str,
    amount_rub: float,
    auth_timeout_s: float,
    create_timeout_s: float,
) -> Any:
    from nalogovich.lknpd import NpdClient

    async with NpdClient(inn=inn, password=password) as client:
        await asyncio.wait_for(client.auth(), timeout=auth_timeout_s)
        return await asyncio.wait_for(
            client.create_check(name=name, amount=round(amount_rub, 2)),
            timeout=create_timeout_s,
        )


def run() -> None:
    try:
        apply_socks_proxy_from_env()
    except Exception as exc:
        emit(
            {
                "ok": False,
                "error": f"proxy setup failed: {exc}",
                "status": 400,
                "retryable": False,
            },
            1,
        )

    raw = sys.stdin.read()
    if not raw.strip():
        emit({"ok": False, "error": "empty input", "status": 400, "retryable": False}, 1)
    try:
        payload = json.loads(raw)
    except Exception:
        emit({"ok": False, "error": "invalid json input", "status": 400, "retryable": False}, 1)

    inn = str(payload.get("inn", "")).strip()
    password = str(payload.get("password", "")).strip()
    mode = str(payload.get("mode", "income")).strip().lower()
    if not inn or not password:
        emit({"ok": False, "error": "missing inn/password", "status": 400, "retryable": False}, 1)
    if mode not in ("income", "auth"):
        emit({"ok": False, "error": "invalid mode", "status": 400, "retryable": False}, 1)

    attempts = read_env_int("NALOGO_BRIDGE_PY_ATTEMPTS", 3, 1, 8)
    retry_base_ms = read_env_int("NALOGO_BRIDGE_PY_RETRY_BASE_MS", 1200, 100, 20_000)
    auth_timeout_s = read_env_timeout_seconds("NALOGO_BRIDGE_PY_AUTH_TIMEOUT_MS", 20_000, 3_000, 120_000)
    create_timeout_s = read_env_timeout_seconds("NALOGO_BRIDGE_PY_CREATE_TIMEOUT_MS", 35_000, 3_000, 180_000)

    name = str(payload.get("name", "")).strip()
    amount_raw = payload.get("amountRub")

    if mode == "income":
        if not name:
            emit({"ok": False, "error": "missing income name", "status": 400, "retryable": False}, 1)
        try:
            amount_value = float(amount_raw)
        except Exception:
            emit({"ok": False, "error": "invalid amount", "status": 400, "retryable": False}, 1)
        if amount_value <= 0:
            emit({"ok": False, "error": "amount must be > 0", "status": 400, "retryable": False}, 1)
    else:
        amount_value = 0.0

    last_error_payload: dict[str, Any] | None = None

    for attempt in range(1, attempts + 1):
        try:
            provider = "nalogapi"

            if mode == "auth":
                try:
                    message = auth_via_nalogapi(inn, password)
                except Exception as api_exc:
                    if not should_try_nalogovich_fallback(api_exc):
                        raise
                    provider = "nalogovich"
                    message = asyncio.run(auth_via_nalogovich(inn, password, auth_timeout_s))
                emit({"ok": True, "message": f"{message} ({provider})"}, 0)

            try:
                receipt = create_income_via_nalogapi(inn, password, name, amount_value)
            except Exception as api_exc:
                if not should_try_nalogovich_fallback(api_exc):
                    raise
                provider = "nalogovich"
                receipt = asyncio.run(
                    create_income_via_nalogovich(
                        inn,
                        password,
                        name,
                        amount_value,
                        auth_timeout_s,
                        create_timeout_s,
                    )
                )

            plain = to_plain(receipt)
            receipt_url = None
            if isinstance(plain, str) and plain.strip():
                receipt_url = plain.strip()
            elif isinstance(plain, dict):
                raw_url = (
                    plain.get("printUrl")
                    or plain.get("print_url")
                    or plain.get("receiptUrl")
                    or plain.get("url")
                    or plain.get("link")
                )
                if isinstance(raw_url, str) and raw_url.strip():
                    receipt_url = raw_url.strip()

            receipt_uuid = find_uuid_deep(plain)
            if not receipt_uuid and receipt_url:
                receipt_uuid = extract_uuid(receipt_url)

            if not receipt_uuid:
                snippet = str(plain)
                if len(snippet) > 350:
                    snippet = snippet[:350] + "..."
                emit(
                    {
                        "ok": False,
                        "error": f"{provider} did not return receipt UUID: {snippet}",
                        "status": 502,
                        "retryable": True,
                    },
                    1,
                )

            emit(
                {
                    "ok": True,
                    "receiptUuid": receipt_uuid,
                    "receiptUrl": receipt_url,
                    "provider": provider,
                },
                0,
            )

        except Exception as exc:
            exc_type = type(exc).__name__
            raw_msg = str(exc).strip()
            msg = raw_msg if raw_msg else (repr(exc).strip() or exc_type)
            status, retryable = classify_error(msg)
            last_error_payload = {
                "ok": False,
                "error": f"nalogo bridge request failed ({exc_type}): {msg}",
                "status": status,
                "retryable": retryable,
            }
            if retryable and attempt < attempts:
                delay_ms = retry_base_ms * (2 ** (attempt - 1))
                time.sleep(delay_ms / 1000)
                continue
            emit(last_error_payload, 1)

    emit(
        last_error_payload
        or {
            "ok": False,
            "error": "nalogo bridge request failed: unknown error",
            "status": 502,
            "retryable": True,
        },
        1,
    )


if __name__ == "__main__":
    run()
