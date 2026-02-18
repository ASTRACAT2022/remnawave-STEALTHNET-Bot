#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit, urlunsplit


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


def parse_timeout_seconds(raw: Any) -> float:
    candidates: list[Any] = [raw, os.environ.get("NALOGO_TIMEOUT_SECONDS")]
    for candidate in candidates:
        if candidate is None:
            continue
        try:
            value = float(candidate)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return max(3.0, min(120.0, value))
    return 30.0


def mask_proxy_url(raw: str) -> str:
    try:
        parsed = urlsplit(raw)
    except Exception:
        return "invalid"
    if parsed.username or parsed.password:
        host = parsed.hostname or ""
        port = f":{parsed.port}" if parsed.port else ""
        netloc = f"***:***@{host}{port}"
    else:
        netloc = parsed.netloc
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def apply_proxy(raw: str | None) -> str:
    value = (raw or "").strip() or os.environ.get("NALOGO_PROXY_URL", "").strip()
    if not value:
        return "off"

    try:
        parsed = urlsplit(value)
    except Exception:
        raise ValueError("invalid proxy url")

    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https", "socks", "socks5", "socks5h"}:
        raise ValueError("unsupported proxy scheme")
    if not parsed.hostname:
        raise ValueError("proxy host is missing")

    for env_key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        os.environ[env_key] = value
    return mask_proxy_url(value)


def extract_uuid(value: Any, *, allow_plain_any: bool = False) -> str | None:
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

    # Канонический UUID.
    if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", s):
        return s

    # Из trusted-полей API допускаем короткие токены (например, не-UUID идентификаторы).
    if allow_plain_any and re.fullmatch(r"[A-Za-z0-9_-]{8,}", s):
        return s

    # Для нетrusted-полей отсекаем короткие цифровые значения (например, ИНН).
    if re.fullmatch(r"[A-Za-z0-9_-]{16,}", s):
        return s
    return None


def pick_first(data: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return None


def find_uuid_deep(value: Any) -> str | None:
    if isinstance(value, dict):
        for key in ("approvedReceiptUuid", "receiptUuid", "uuid"):
            if key in value:
                found = extract_uuid(value[key], allow_plain_any=True)
                if found:
                    return found
        for key in ("receiptUrl", "printUrl", "url", "link"):
            if key in value:
                found = extract_uuid(value[key])
                if found:
                    return found
        for nested in value.values():
            if isinstance(nested, (dict, list)):
                found = find_uuid_deep(nested)
                if found:
                    return found
        return None
    if isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                found = find_uuid_deep(item)
                if found:
                    return found
    return None


def find_receipt_url_deep(value: Any) -> str | None:
    if isinstance(value, str):
        s = value.strip()
        if "/receipt/" in s and "lknpd.nalog.ru" in s:
            return s
        return None
    if isinstance(value, dict):
        for nested in value.values():
            found = find_receipt_url_deep(nested)
            if found:
                return found
        return None
    if isinstance(value, list):
        for item in value:
            found = find_receipt_url_deep(item)
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


def ensure_python_runtime() -> None:
    """Prefer project venv python even when script is launched as plain `python`."""
    venv_python = "/opt/venv/bin/python"
    if not os.path.exists(venv_python):
        return
    current = os.path.realpath(sys.executable)
    target = os.path.realpath(venv_python)
    if current == target:
        return
    if os.environ.get("NALOGO_BRIDGE_REEXECED") == "1":
        return
    os.execve(
        venv_python,
        [venv_python, *sys.argv],
        {
            **os.environ,
            "NALOGO_BRIDGE_REEXECED": "1",
        },
    )


def ensure_nalogapi_available() -> tuple[Any | None, str | None]:
    try:
        from nalogapi import NalogAPI  # type: ignore

        return NalogAPI, None
    except Exception as first_exc:
        # Кардинальный fallback: если образ/окружение без nalogapi,
        # пробуем доустановить пакет прямо в рантайме.
        commands = [
            [sys.executable, "-m", "pip", "install", "--no-cache-dir", "nalogapi", "pysocks"],
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-cache-dir",
                "--break-system-packages",
                "nalogapi",
                "pysocks",
            ],
        ]
        last_error = ""
        for cmd in commands:
            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300,
                    env={
                        **os.environ,
                        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                    },
                )
            except Exception as install_exc:
                last_error = str(install_exc)
                continue

            if proc.returncode == 0:
                last_error = ""
                break

            tail = (proc.stderr or proc.stdout or "").strip()
            if len(tail) > 400:
                tail = tail[-400:]
            last_error = f"runtime pip install exited with code {proc.returncode}: {tail}"

        if last_error:
            return None, f"nalogapi import failed: {first_exc}; {last_error}"

        try:
            from nalogapi import NalogAPI  # type: ignore

            return NalogAPI, None
        except Exception as second_exc:
            return None, (
                f"nalogapi import failed after runtime install: {second_exc}"
            )


def main() -> None:
    ensure_python_runtime()

    NalogAPI, import_error = ensure_nalogapi_available()
    if NalogAPI is None:
        emit(
            {
                "ok": False,
                "error": str(import_error),
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
    timeout_seconds = parse_timeout_seconds(payload.get("timeoutSeconds"))

    socket.setdefaulttimeout(timeout_seconds)

    try:
        proxy_label = apply_proxy(payload.get("proxyUrl"))
    except ValueError as exc:
        emit({"ok": False, "error": f"invalid proxy config: {exc}", "status": 400, "retryable": False}, 1)

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

    attempts = 3
    result: Any = None
    for attempt in range(1, attempts + 1):
        try:
            NalogAPI.configure(inn, password)
            result = NalogAPI.addIncome(op_time, amount_value, name)
            break
        except Exception as exc:
            msg = str(exc)
            status, retryable = classify_error(msg)
            is_last = attempt >= attempts or not retryable
            if is_last:
                emit(
                    {
                        "ok": False,
                        "error": (
                            "nalogapi request failed: "
                            f"{msg}; timeout={timeout_seconds:.0f}s; proxy={proxy_label}; "
                            f"attempt={attempt}/{attempts}"
                        ),
                        "status": status,
                        "retryable": retryable,
                    },
                    1,
                )
            time.sleep(min(2.0 * attempt, 4.0))

    receipt_uuid = find_uuid_deep(result)
    receipt_url = None

    if isinstance(result, str):
        receipt_url = result.strip()
        if not receipt_uuid:
            receipt_uuid = extract_uuid(receipt_url, allow_plain_any=True)
    elif isinstance(result, dict):
        raw_url = pick_first(result, ["receiptUrl", "printUrl", "url", "link"])
        if isinstance(raw_url, str) and raw_url.strip():
            receipt_url = raw_url.strip()
        if not receipt_uuid and receipt_url:
            receipt_uuid = extract_uuid(receipt_url)
    if not receipt_url:
        receipt_url = find_receipt_url_deep(result)
    if (not receipt_uuid or receipt_uuid == inn) and receipt_url:
        maybe_uuid = extract_uuid(receipt_url, allow_plain_any=True)
        if maybe_uuid:
            receipt_uuid = maybe_uuid

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

    if receipt_uuid == inn:
        snippet = str(result)
        if len(snippet) > 200:
            snippet = snippet[:200] + "..."
        emit(
            {
                "ok": False,
                "error": f"nalogapi returned INN instead of receipt UUID: {snippet}",
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
