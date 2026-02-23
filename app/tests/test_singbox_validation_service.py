import pytest

from app.services.singbox_validation import (
    SUPPORTED_SINGBOX_INBOUND_TYPES,
    SingboxValidationError,
    validate_desired_config,
)


def test_accepts_all_supported_singbox_inbound_types() -> None:
    for inbound_type in sorted(SUPPORTED_SINGBOX_INBOUND_TYPES):
        result = validate_desired_config(
            {"inbounds": [{"type": inbound_type}]},
            singbox_enabled=True,
        )
        assert result.singbox_present is True


def test_rejects_unknown_singbox_inbound_type() -> None:
    with pytest.raises(SingboxValidationError, match="is not supported"):
        validate_desired_config(
            {"inbounds": [{"type": "unknown-inbound"}]},
            singbox_enabled=True,
        )


def test_allows_missing_singbox_when_not_required() -> None:
    result = validate_desired_config(
        {},
        singbox_enabled=True,
        require_singbox_present=False,
    )
    assert result.singbox_present is False
    assert result.validated_by == "skipped"


def test_requires_singbox_when_explicitly_requested() -> None:
    with pytest.raises(SingboxValidationError, match="singbox_config_missing"):
        validate_desired_config(
            {},
            singbox_enabled=True,
            require_singbox_present=True,
        )
