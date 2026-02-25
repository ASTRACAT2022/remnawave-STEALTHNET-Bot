#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import re
import sys
from typing import Any


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
        for key in ("id", "approvedReceiptUuid", "receiptUuid", "uuid", "receiptUrl", "printUrl", "url", "link"):
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
    ):
        return 504, True
    return 502, True


async def run() -> None:
    try:
        from nalogovich.lknpd import NpdClient
    except Exception as exc:
        emit(
            {
                "ok": False,
                "error": f"nalogovich import failed: {exc}",
                "status": 502,
                "retryable": True,
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

    try:
        async with NpdClient(inn=inn, password=password) as client:
            await client.auth()

            if mode == "auth":
                emit({"ok": True, "message": "Nalogovich auth successful"}, 0)

            name = str(payload.get("name", "")).strip()
            amount_raw = payload.get("amountRub")
            if not name:
                emit({"ok": False, "error": "missing income name", "status": 400, "retryable": False}, 1)
            try:
                amount_value = float(amount_raw)
            except Exception:
                emit({"ok": False, "error": "invalid amount", "status": 400, "retryable": False}, 1)
            if amount_value <= 0:
                emit({"ok": False, "error": "amount must be > 0", "status": 400, "retryable": False}, 1)

            receipt = await client.create_check(
                name=name,
                amount=round(amount_value, 2),
            )
            plain = to_plain(receipt)
            receipt_uuid = find_uuid_deep(plain)
            if not receipt_uuid:
                snippet = str(plain)
                if len(snippet) > 350:
                    snippet = snippet[:350] + "..."
                emit(
                    {
                        "ok": False,
                        "error": f"nalogovich did not return receipt UUID: {snippet}",
                        "status": 502,
                        "retryable": True,
                    },
                    1,
                )

            receipt_url = None
            if isinstance(plain, dict):
                raw_url = (
                    plain.get("printUrl")
                    or plain.get("print_url")
                    or plain.get("receiptUrl")
                    or plain.get("url")
                )
                if isinstance(raw_url, str) and raw_url.strip():
                    receipt_url = raw_url.strip()

            emit({"ok": True, "receiptUuid": receipt_uuid, "receiptUrl": receipt_url}, 0)
    except Exception as exc:
        msg = str(exc)
        status, retryable = classify_error(msg)
        emit(
            {
                "ok": False,
                "error": f"nalogovich request failed: {msg}",
                "status": status,
                "retryable": retryable,
            },
            1,
        )


if __name__ == "__main__":
    asyncio.run(run())
