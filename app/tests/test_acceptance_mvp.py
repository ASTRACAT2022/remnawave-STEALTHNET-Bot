def create_user(client, headers, squad_id=None, token="token-1", user_uuid="11111111-1111-1111-1111-111111111111"):
    unique = user_uuid.split("-")[0]
    payload = {
        "uuid": user_uuid,
        "vless_id": f"{unique:0<8}-2222-2222-2222-222222222222",
        "short_id": f"sid-{unique}",
        "squad_id": squad_id,
        "traffic_limit_bytes": 0,
        "max_devices": 1,
        "hwid_policy": "none",
        "subscription_token": token,
        "external_identities": {"remnawave_id": "old-1"},
    }
    response = client.post("/api/v1/users", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_user_buys_plan_and_subscription_activates(client, admin_headers):
    user = create_user(client, admin_headers)

    plan_payload = {
        "name": "PRO 30",
        "price": 9.99,
        "currency": "USD",
        "duration_days": 30,
        "traffic_limit_bytes": 10_000,
        "max_devices": 3,
    }
    plan_resp = client.post("/api/v1/plans", json=plan_payload, headers=admin_headers)
    assert plan_resp.status_code == 200, plan_resp.text
    plan_id = plan_resp.json()["id"]

    order_resp = client.post(
        "/api/v1/orders",
        json={"user_id": user["id"], "plan_id": plan_id},
        headers={**admin_headers, "Idempotency-Key": "order-1"},
    )
    assert order_resp.status_code == 200, order_resp.text

    payment_resp = client.post(
        "/api/v1/payments/confirm",
        json={"order_id": order_resp.json()["id"], "external_payment_id": "pay-1", "provider": "test"},
        headers=admin_headers,
    )
    assert payment_resp.status_code == 200, payment_resp.text

    user_resp = client.get(f"/api/v1/users/{user['id']}", headers=admin_headers)
    body = user_resp.json()
    assert body["status"] == "active"
    assert body["traffic_limit_bytes"] == 10_000
    assert body["expires_at"] is not None


def test_node_apply_config_success(client, admin_headers):
    squad_resp = client.post(
        "/api/v1/squads",
        json={"name": "SQUAD-1", "description": "", "selection_policy": "round-robin", "fallback_policy": "none", "allowed_protocols": ["AWG2", "Sing-box"]},
        headers=admin_headers,
    )
    squad_id = squad_resp.json()["id"]

    server_resp = client.post(
        "/api/v1/servers",
        json={"host": "node1.example.com", "ip": "10.0.0.1", "provider": "hetzner", "region": "de", "squad_id": squad_id, "price": 4.0, "currency": "EUR"},
        headers=admin_headers,
    )
    server_id = server_resp.json()["id"]

    node_resp = client.post(
        "/api/v1/nodes",
        json={"server_id": server_id, "node_token": "node-token-1", "engine_awg2_enabled": True, "engine_singbox_enabled": True, "desired_config": {"inbounds": []}},
        headers=admin_headers,
    )
    assert node_resp.status_code == 200

    apply_resp = client.post(
        "/agent/apply-result",
        json={"node_token": "node-token-1", "applied_config_revision": 1, "status": "success", "details": {}},
    )
    assert apply_resp.status_code == 200

    list_resp = client.get("/api/v1/nodes", headers=admin_headers)
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["last_apply_status"] == "success"


def test_block_when_traffic_limit_reached(client, admin_headers):
    squad_resp = client.post(
        "/api/v1/squads",
        json={"name": "SQUAD-2", "description": "", "selection_policy": "round-robin", "fallback_policy": "none", "allowed_protocols": ["AWG2"]},
        headers=admin_headers,
    )
    squad_id = squad_resp.json()["id"]

    user = create_user(
        client,
        admin_headers,
        squad_id=squad_id,
        token="token-2",
        user_uuid="33333333-3333-3333-3333-333333333333",
    )
    client.patch(f"/api/v1/users/{user['id']}/limits", json={"traffic_limit_bytes": 100, "max_devices": 1}, headers=admin_headers)

    server_resp = client.post(
        "/api/v1/servers",
        json={"host": "node2.example.com", "ip": "10.0.0.2", "provider": "do", "region": "nl", "squad_id": squad_id, "price": 5.0, "currency": "USD"},
        headers=admin_headers,
    )

    client.post(
        "/api/v1/nodes",
        json={"server_id": server_resp.json()["id"], "node_token": "node-token-2", "desired_config": {}},
        headers=admin_headers,
    )

    usage_resp = client.post(
        "/agent/report-usage",
        json={"node_token": "node-token-2", "user_uuid": "33333333-3333-3333-3333-333333333333", "bytes_used": 120},
    )
    assert usage_resp.status_code == 200

    user_resp = client.get(f"/api/v1/users/{user['id']}", headers=admin_headers)
    assert user_resp.json()["status"] == "blocked"


def test_legacy_links_work_after_migration(client, admin_headers):
    user = create_user(client, admin_headers, token="new-token", user_uuid="44444444-4444-4444-4444-444444444444")

    map_resp = client.post(
        "/api/v1/migration/legacy-token-map",
        json={"user_id": user["id"], "legacy_token": "old-token", "subscription_token": "new-token"},
        headers=admin_headers,
    )
    assert map_resp.status_code == 200

    sub_resp = client.get("/api/v1/subscriptions/old-token")
    assert sub_resp.status_code == 200
    assert sub_resp.json()["user_uuid"] == "44444444-4444-4444-4444-444444444444"


def test_orion_squad_returns_90_endpoints(client, admin_headers):
    squad_resp = client.post(
        "/api/v1/squads",
        json={"name": "ORION", "description": "large squad", "selection_policy": "round-robin", "fallback_policy": "none", "allowed_protocols": ["AWG2", "Sing-box"]},
        headers=admin_headers,
    )
    squad_id = squad_resp.json()["id"]

    user = create_user(
        client,
        admin_headers,
        squad_id=squad_id,
        token="orion-token",
        user_uuid="55555555-5555-5555-5555-555555555555",
    )

    for idx in range(90):
        host = f"orion-{idx}.example.com"
        create_server_resp = client.post(
            "/api/v1/servers",
            json={
                "host": host,
                "ip": f"10.20.0.{idx % 255}",
                "provider": "mix",
                "region": "global",
                "squad_id": squad_id,
                "price": 3.0,
                "currency": "USD",
            },
            headers=admin_headers,
        )
        assert create_server_resp.status_code == 200

    sub_resp = client.get(f"/api/v1/subscriptions/{user['subscription_token']}")
    assert sub_resp.status_code == 200
    assert len(sub_resp.json()["endpoints"]) == 90


def test_payment_assigns_squad_from_plan_mapping(client, admin_headers):
    base_squad_resp = client.post(
        "/api/v1/squads",
        json={"name": "BASE-SQUAD", "description": "", "selection_policy": "round-robin", "fallback_policy": "none", "allowed_protocols": ["AWG2"]},
        headers=admin_headers,
    )
    assert base_squad_resp.status_code == 200, base_squad_resp.text
    base_squad_id = base_squad_resp.json()["id"]

    premium_squad_resp = client.post(
        "/api/v1/squads",
        json={"name": "PREMIUM-SQUAD", "description": "", "selection_policy": "round-robin", "fallback_policy": "none", "allowed_protocols": ["AWG2", "Sing-box"]},
        headers=admin_headers,
    )
    assert premium_squad_resp.status_code == 200, premium_squad_resp.text
    premium_squad_id = premium_squad_resp.json()["id"]

    user = create_user(
        client,
        admin_headers,
        squad_id=premium_squad_id,
        token="token-plan-squad",
        user_uuid="66666666-6666-6666-6666-666666666666",
    )

    plan_resp = client.post(
        "/api/v1/plans",
        json={
            "name": "BASE 30",
            "price": 5.0,
            "currency": "USD",
            "duration_days": 30,
            "traffic_limit_bytes": 10_000,
            "max_devices": 2,
            "squad_id": base_squad_id,
        },
        headers=admin_headers,
    )
    assert plan_resp.status_code == 200, plan_resp.text
    assert plan_resp.json()["squad_id"] == base_squad_id

    order_resp = client.post(
        "/api/v1/orders",
        json={"user_id": user["id"], "plan_id": plan_resp.json()["id"]},
        headers=admin_headers,
    )
    assert order_resp.status_code == 200, order_resp.text

    payment_resp = client.post(
        "/api/v1/payments/confirm",
        json={"order_id": order_resp.json()["id"], "external_payment_id": "pay-plan-squad-1", "provider": "test"},
        headers=admin_headers,
    )
    assert payment_resp.status_code == 200, payment_resp.text

    user_after = client.get(f"/api/v1/users/{user['id']}", headers=admin_headers)
    assert user_after.status_code == 200, user_after.text
    assert user_after.json()["squad_id"] == base_squad_id


def test_reconcile_user_squads_updates_by_latest_paid_plan(client, admin_headers):
    base_squad_resp = client.post(
        "/api/v1/squads",
        json={"name": "BASE-SQUAD-2", "description": "", "selection_policy": "round-robin", "fallback_policy": "none", "allowed_protocols": ["AWG2"]},
        headers=admin_headers,
    )
    assert base_squad_resp.status_code == 200, base_squad_resp.text
    base_squad_id = base_squad_resp.json()["id"]

    premium_squad_resp = client.post(
        "/api/v1/squads",
        json={"name": "PREMIUM-SQUAD-2", "description": "", "selection_policy": "round-robin", "fallback_policy": "none", "allowed_protocols": ["AWG2", "Sing-box"]},
        headers=admin_headers,
    )
    assert premium_squad_resp.status_code == 200, premium_squad_resp.text
    premium_squad_id = premium_squad_resp.json()["id"]

    user = create_user(
        client,
        admin_headers,
        squad_id=base_squad_id,
        token="token-reconcile-1",
        user_uuid="77777777-7777-7777-7777-777777777777",
    )

    plan_resp = client.post(
        "/api/v1/plans",
        json={
            "name": "BASE 60",
            "price": 7.0,
            "currency": "USD",
            "duration_days": 60,
            "traffic_limit_bytes": 20_000,
            "max_devices": 2,
            "squad_id": base_squad_id,
        },
        headers=admin_headers,
    )
    assert plan_resp.status_code == 200, plan_resp.text

    order_resp = client.post(
        "/api/v1/orders",
        json={"user_id": user["id"], "plan_id": plan_resp.json()["id"]},
        headers=admin_headers,
    )
    assert order_resp.status_code == 200, order_resp.text

    payment_resp = client.post(
        "/api/v1/payments/confirm",
        json={"order_id": order_resp.json()["id"], "external_payment_id": "pay-reconcile-1", "provider": "test"},
        headers=admin_headers,
    )
    assert payment_resp.status_code == 200, payment_resp.text

    # Emulate broken state where user ended up in premium despite having paid for base.
    assign_resp = client.post(
        f"/api/v1/users/{user['id']}/assign-squad?squad_id={premium_squad_id}",
        headers=admin_headers,
    )
    assert assign_resp.status_code == 200, assign_resp.text
    assert assign_resp.json()["squad_id"] == premium_squad_id

    dry_run_resp = client.post(
        "/api/v1/plans/reconcile-user-squads",
        json={"dry_run": True},
        headers=admin_headers,
    )
    assert dry_run_resp.status_code == 200, dry_run_resp.text
    assert dry_run_resp.json()["users_to_update"] >= 1
    assert dry_run_resp.json()["users_updated"] == 0

    apply_resp = client.post(
        "/api/v1/plans/reconcile-user-squads",
        json={"dry_run": False},
        headers=admin_headers,
    )
    assert apply_resp.status_code == 200, apply_resp.text
    assert apply_resp.json()["users_updated"] >= 1

    user_after = client.get(f"/api/v1/users/{user['id']}", headers=admin_headers)
    assert user_after.status_code == 200, user_after.text
    assert user_after.json()["squad_id"] == base_squad_id
