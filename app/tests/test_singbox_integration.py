def create_user(client, headers, token="sg-token-1", user_uuid="aaaaaaaa-1111-1111-1111-111111111111"):
    payload = {
        "uuid": user_uuid,
        "vless_id": "aaaaaaaa-2222-2222-2222-222222222222",
        "short_id": "sid-singbox",
        "traffic_limit_bytes": 0,
        "max_devices": 1,
        "hwid_policy": "none",
        "subscription_token": token,
        "external_identities": {"source": "test"},
    }
    response = client.post("/api/v1/users", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_singbox_end_to_end_purchase_and_subscription(client, admin_headers):
    user = create_user(client, admin_headers)

    create_node = client.post(
        "/api/v1/singbox/nodes",
        json={
            "name": "EU-HY2-1",
            "protocol": "HYSTERIA2",
            "port": 444,
            "tls_enabled": True,
            "public_host": "138.124.73.7",
        },
        headers=admin_headers,
    )
    assert create_node.status_code == 200, create_node.text
    node = create_node.json()["node"]
    node_token = node["token"]
    assert "docker_compose_yml" in create_node.json()

    register_resp = client.post(
        "/api/singbox-nodes/register",
        json={
            "name": "EU-HY2-1",
            "protocol": "HYSTERIA2",
            "port": 444,
            "tls_enabled": True,
            "public_host": "138.124.73.7",
            "metadata": {},
        },
        headers={"X-Singbox-Node-Token": node_token},
    )
    assert register_resp.status_code == 200, register_resp.text

    category_resp = client.post(
        "/api/v1/singbox/categories",
        json={"name": "Sing-box HY2", "sort_order": 1},
        headers=admin_headers,
    )
    assert category_resp.status_code == 200, category_resp.text

    tariff_resp = client.post(
        "/api/v1/singbox/tariffs",
        json={
            "category_id": category_resp.json()["id"],
            "name": "2 доступа 30 дней",
            "slot_count": 2,
            "duration_days": 30,
            "traffic_limit_bytes": 1024,
            "price": 12.5,
            "currency": "USD",
            "sort_order": 1,
            "enabled": True,
        },
        headers=admin_headers,
    )
    assert tariff_resp.status_code == 200, tariff_resp.text

    payment_resp = client.post(
        "/api/v1/singbox/payments/confirm",
        json={
            "client_id": user["id"],
            "singbox_tariff_id": tariff_resp.json()["id"],
            "external_payment_id": "sg-pay-1",
            "provider": "test",
        },
        headers=admin_headers,
    )
    assert payment_resp.status_code == 200, payment_resp.text
    payment_body = payment_resp.json()
    assert len(payment_body["created_slots"]) == 2
    assert payment_body["subscription_url"].endswith(f"/{user['subscription_token']}")

    subscription_resp = client.get(f"/api/v1/singbox/subscription/{user['id']}/{user['subscription_token']}")
    assert subscription_resp.status_code == 200, subscription_resp.text
    assert "hysteria2://" in subscription_resp.text

    agent_slots_resp = client.get(
        f"/api/singbox-nodes/{node['id']}/slots",
        headers={"X-Singbox-Node-Token": node_token},
    )
    assert agent_slots_resp.status_code == 200, agent_slots_resp.text
    assert len(agent_slots_resp.json()["slots"]) == 2
    assert "stealthnet-in" in agent_slots_resp.json()["custom_config_json"]
