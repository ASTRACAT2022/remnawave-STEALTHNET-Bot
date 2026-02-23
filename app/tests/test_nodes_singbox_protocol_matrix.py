from app.services.singbox_validation import SUPPORTED_SINGBOX_INBOUND_TYPES


def test_validate_config_endpoint_accepts_all_supported_inbound_types(client, admin_headers):
    for inbound_type in sorted(SUPPORTED_SINGBOX_INBOUND_TYPES):
        response = client.post(
            "/api/v1/nodes/validate-config",
            json={
                "desired_config": {"inbounds": [{"type": inbound_type}]},
                "engine_singbox_enabled": True,
            },
            headers=admin_headers,
        )
        assert response.status_code == 200, f"inbound={inbound_type} body={response.text}"
        body = response.json()
        assert body["ok"] is True
        assert body["singbox_present"] is True


def test_validate_config_endpoint_rejects_unknown_inbound_type(client, admin_headers):
    response = client.post(
        "/api/v1/nodes/validate-config",
        json={
            "desired_config": {"inbounds": [{"type": "not-a-real-inbound"}]},
            "engine_singbox_enabled": True,
        },
        headers=admin_headers,
    )

    assert response.status_code == 400
    assert "not supported" in response.text
