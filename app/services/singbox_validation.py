from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from app.core.config import Settings, get_settings

SUPPORTED_SINGBOX_INBOUND_TYPES = {
    "direct",
    "mixed",
    "socks",
    "http",
    "shadowsocks",
    "vmess",
    "trojan",
    "naive",
    "hysteria2",
    "shadowtls",
    "tuic",
    "hysteria",
    "anytls",
    "vless",
    "tun",
    "redirect",
    "tproxy",
}


@dataclass
class SingboxValidationResult:
    singbox_present: bool
    validated_by: str


class SingboxValidationError(ValueError):
    pass


def validate_desired_config(
    desired_config: dict[str, Any],
    *,
    singbox_enabled: bool,
    require_singbox_present: bool = False,
    settings: Optional[Settings] = None,
) -> SingboxValidationResult:
    settings = settings or get_settings()

    if not singbox_enabled:
        return SingboxValidationResult(singbox_present=False, validated_by="skipped")

    singbox_cfg, is_present = extract_singbox_config(desired_config)
    if not is_present or singbox_cfg is None:
        if require_singbox_present:
            raise SingboxValidationError(
                "singbox_config_missing: expected `singbox` object or root sing-box config with `inbounds`"
            )
        return SingboxValidationResult(singbox_present=False, validated_by="skipped")

    _validate_structural(singbox_cfg)

    validated_by = _run_external_singbox_check(singbox_cfg, settings)
    return SingboxValidationResult(singbox_present=True, validated_by=validated_by)


def extract_singbox_config(payload: dict[str, Any]) -> tuple[Optional[dict[str, Any]], bool]:
    if not isinstance(payload, dict):
        return None, False

    raw_singbox = payload.get("singbox")
    if isinstance(raw_singbox, dict):
        return raw_singbox, True

    if isinstance(payload.get("inbounds"), list):
        return payload, True

    return None, False


def _validate_structural(singbox_cfg: dict[str, Any]) -> None:
    inbounds = singbox_cfg.get("inbounds")
    if not isinstance(inbounds, list):
        raise SingboxValidationError("singbox_config_invalid: `inbounds` must be an array")

    for index, inbound in enumerate(inbounds):
        if not isinstance(inbound, dict):
            raise SingboxValidationError(
                f"singbox_config_invalid: inbound[{index}] must be an object"
            )
        inbound_type = inbound.get("type")
        if not isinstance(inbound_type, str) or not inbound_type.strip():
            raise SingboxValidationError(
                f"singbox_config_invalid: inbound[{index}].type must be a non-empty string"
            )

        normalized_type = inbound_type.strip().lower()
        if normalized_type not in SUPPORTED_SINGBOX_INBOUND_TYPES:
            raise SingboxValidationError(
                f"singbox_config_invalid: inbound[{index}].type `{inbound_type}` is not supported"
            )


def _run_external_singbox_check(singbox_cfg: dict[str, Any], settings: Settings) -> str:
    command_template = settings.singbox_check_command.strip()
    if not command_template:
        return "structural"

    tmp_path = _write_temp_config(singbox_cfg)
    try:
        command = _build_check_command(command_template, tmp_path)
        try:
            completed = subprocess.run(
                ["sh", "-c", command],
                check=False,
                capture_output=True,
                text=True,
                timeout=max(1, int(settings.singbox_check_timeout_seconds)),
            )
        except FileNotFoundError as exc:
            if settings.singbox_check_strict:
                raise SingboxValidationError(
                    "singbox_check_not_available: shell not found for check command"
                ) from exc
            return "structural"
        except subprocess.TimeoutExpired as exc:
            raise SingboxValidationError(
                f"singbox_check_timeout: exceeded {settings.singbox_check_timeout_seconds}s"
            ) from exc

        if completed.returncode == 0:
            return "sing-box-check"

        output = (completed.stderr or completed.stdout or "").strip()
        output = _clip(output, 700)
        lowered = output.lower()
        command_missing = completed.returncode == 127 or "not found" in lowered

        if command_missing and not settings.singbox_check_strict:
            return "structural"

        if output:
            raise SingboxValidationError(f"singbox_check_failed: {output}")

        raise SingboxValidationError(
            f"singbox_check_failed: command exited with status {completed.returncode}"
        )
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass


def _build_check_command(command_template: str, config_path: str) -> str:
    quoted = _shell_quote(config_path)
    if "{config_path}" in command_template:
        return command_template.replace("{config_path}", quoted)
    return f"{command_template} {quoted}"


def _write_temp_config(config: dict[str, Any]) -> str:
    handle = tempfile.NamedTemporaryFile(mode="w", suffix=".json", prefix="pepoapple-singbox-", delete=False)
    try:
        json.dump(config, handle)
        handle.flush()
        return handle.name
    finally:
        handle.close()


def _shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def _clip(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return f"{value[:limit]}..."
