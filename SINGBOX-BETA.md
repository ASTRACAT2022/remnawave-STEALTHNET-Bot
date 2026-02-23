# Sing-box Beta (Phase 1 + Core Purchase Flow)

## Что реализовано

- Новые сущности БД:
  - `singbox_nodes`
  - `singbox_categories`
  - `singbox_tariffs`
  - `singbox_slots`
- Расширение биллинга:
  - `orders.singbox_tariff_id`
  - `payments.singbox_tariff_id`
- Админ API:
  - `POST /api/v1/singbox/nodes`
  - `GET /api/v1/singbox/nodes`
  - `GET /api/v1/singbox/nodes/{nodeId}`
  - `PATCH /api/v1/singbox/nodes/{nodeId}`
  - `GET /api/v1/singbox/nodes/{nodeId}/slots`
  - `POST /api/v1/singbox/categories`
  - `GET /api/v1/singbox/categories`
  - `POST /api/v1/singbox/tariffs`
  - `GET /api/v1/singbox/tariffs`
  - `PATCH /api/v1/singbox/tariffs/{tariffId}`
  - `POST /api/v1/singbox/payments/confirm`
  - `GET /api/v1/singbox/clients/{clientId}/slots`
- Клиент subscription API:
  - `GET /api/v1/singbox/subscription/{clientId}/{token}`
- Agent API:
  - `POST /api/singbox-nodes/register`
  - `POST /api/singbox-nodes/{nodeId}/heartbeat`
  - `GET /api/singbox-nodes/{nodeId}/slots`

## Примечания по custom config

- `customConfigJson` должен быть валидным JSON.
- В `inbounds` обязателен тег `stealthnet-in` для managed inbound.
- Если `customConfigJson` не задан, API отдаёт дефолтный шаблон по протоколу ноды.

## Быстрый запуск ноды

Используйте шаблон `/docker-compose.singbox-node.yml` и подставьте:

- `STEALTHNET_API_URL`
- `SINGBOX_NODE_TOKEN`
- нужные `SINGBOX_PROTOCOL`, `SINGBOX_PORT`, `SINGBOX_TLS_ENABLED`
