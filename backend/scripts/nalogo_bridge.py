#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from typing import Any


def emit(payload: dict[str, Any], code: int) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    raise SystemExit(code)


def parse_dt(raw: Any) -> datetime:
    if isinstance(raw, str) and raw.strip():
        s = raw.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(s)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
        except ValueError:
            pass
    return datetime.utcnow()


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


def pick_first(data: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return None


def find_uuid_deep(value: Any) -> str | None:
    direct = extract_uuid(value)
    if direct:
        return direct
    if isinstance(value, dict):
        for key in ("approvedReceiptUuid", "receiptUuid", "uuid", "receiptUrl", "printUrl", "url", "link"):
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


def main() -> None:
    try:
        from nalogapi import NalogAPI
    except Exception as exc:
        emit(
            {
                "ok": False,
                "error": f"nalogapi import failed: {exc}",
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
    name = str(payload.get("name", "")).strip()
    amount = payload.get("amountRub")
    op_time = parse_dt(payload.get("operationTimeIso"))

    if not inn or not password:
        emit({"ok": False, "error": "missing inn/password", "status": 400, "retryable": False}, 1)
    if not name:
        emit({"ok": False, "error": "missing income name", "status": 400, "retryable": False}, 1)
    try:
        amount_value = float(amount)
    except Exception:
        emit({"ok": False, "error": "invalid amount", "status": 400, "retryable": False}, 1)
    if amount_value <= 0:
        emit({"ok": False, "error": "amount must be > 0", "status": 400, "retryable": False}, 1)


    try:
        NalogAPI.configure(inn, password)
        result = NalogAPI.addIncome(op_time, amount_value, name)
    except Exception as exc:
        msg = str(exc)
        status, retryable = classify_error(msg)
        emit(
            {
                "ok": False,
                "error": f"nalogapi request failed: {msg}",
                "status": status,
                "retryable": retryable,
            },
            1,
        )

    receipt_uuid = find_uuid_deep(result)
    receipt_url = None

    if isinstance(result, str):
        receipt_url = result.strip()
        if not receipt_uuid:
            receipt_uuid = extract_uuid(receipt_url)
    elif isinstance(result, dict):
        raw_url = pick_first(result, ["receiptUrl", "printUrl", "url", "link"])
        if isinstance(raw_url, str) and raw_url.strip():
            receipt_url = raw_url.strip()
        if not receipt_uuid and receipt_url:
            receipt_uuid = extract_uuid(receipt_url)

    if not receipt_uuid:
        snippet = str(result)
        if len(snippet) > 300:
            snippet = snippet[:300] + "..."
        emit(
            {
                "ok": False,
                "error": f"nalogapi did not return receipt UUID: {snippet}",
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
        },
        0,
    )


if __name__ == "__main__":
    main()
