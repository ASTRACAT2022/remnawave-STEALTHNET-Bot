# Prometheus метрики STEALTHNET API

## Endpoint

`GET /metrics` — стандартный Prometheus exposition format (text/plain v0.0.4).

- **Без авторизации** — endpoint отдаёт только агрегаты, никаких PII (нет email,
  username, telegramId, IP клиентов, сумм платежей, балансов). Безопасный дефолт.
- **Не проксируется через nginx** по умолчанию. Доступен внутри docker-network
  на `api:5000/metrics`. Чтобы открыть снаружи — раскомментируйте location в
  `nginx/nginx.conf` и обязательно ограничьте IP через `allow/deny`.
- **Исключён из `http_requests_total`** — scrape'ы Prometheus (каждые 15-30s)
  не засоряют счётчик.

## Собираемые метрики

### HTTP (autoinstrumentation)
- `stealthnet_http_request_duration_seconds` (histogram, labels: method, route, status_code)
- `stealthnet_http_requests_total` (counter, labels: method, route, status_code)
- `stealthnet_http_requests_in_flight` (gauge)

### Платежи (counters, без финансовых сумм)
- `stealthnet_payment_webhook_total` (counter, labels: provider, outcome)
  - providers: `freekassa`, `heleket`, `telegram_stars`, `yoomoney`, `yookassa`,
    `platega`, `cryptopay`, `lava`, `lavatop`, `overpay`, `remna`
  - outcomes: `received`, `signature_invalid`, `rejected_payload`,
    `rejected_signature`, `payment_not_found`, `payment_already_paid`, `error`,
    `ignored`
- `stealthnet_payment_processed_total` (counter, labels: provider, product)
  - products: `topup`, `tariff`, `proxy`, `singbox`, `wdtt`, `extra_option`
- `stealthnet_payment_failed_total` (counter, labels: provider, reason)
- `stealthnet_payment_processing_duration_seconds` (histogram, labels: provider, product)

### Remnawave (gauges, обновляются каждые 30s через setInterval)
- `stealthnet_remna_api_up` (0/1)
- `stealthnet_remna_api_request_duration_seconds` (histogram, labels: endpoint, status)
- `stealthnet_remna_nodes` (gauge, labels: status)
  - status: `connected`, `disconnected`, `disabled`, `connecting`, `unknown`
- `stealthnet_remna_node_users_online` (gauge, labels: node_uuid, node_name, country)
- `stealthnet_remna_node_bandwidth_bytes` (gauge, labels: node_uuid, node_name, direction)
  - direction: `upload`, `download`
- `stealthnet_remna_node_bandwidth_bps` (gauge, realtime)
- `stealthnet_remna_users` (gauge, labels: status)
- `stealthnet_remna_subscriptions` (gauge, labels: status)
- `stealthnet_remna_system_stat` (gauge, labels: metric)

### Бизнес-операции
- `stealthnet_tariff_activations_total` (counter, labels: tariff_type, outcome)
  - tariff_type: `vpn`, `proxy`, `singbox`, `wdtt`
- `stealthnet_referral_rewards_total` (counter, labels: outcome)
- `stealthnet_gift_activations_total` (counter, labels: outcome)
- `stealthnet_client_registrations_total` (counter, labels: source)

### Database / Cron
- `stealthnet_prisma_connection_up` (gauge, 0/1)
- `stealthnet_cron_job_duration_seconds` (histogram, labels: job, outcome)
- `stealthnet_cron_job_last_success_timestamp` (gauge, labels: job)

### Node.js default metrics (с префиксом `stealthnet_`)
- event loop lag, GC, RSS/heap, CPU, file descriptors

## Сборщик (collector)

Файл `src/lib/metrics-collector.ts` запускается из `index.ts` (`startMetricsCollector()`):

- **Интервал**: 30 секунд (баланс свежести и нагрузки на Remna API)
- **Graceful degradation**: если `REMNA_API_URL`/`REMNA_ADMIN_TOKEN` не заданы —
  метрики нод остаются нулями, остальные метрики работают
- **Не роняет процесс**: все ошибки Remna попадают в `remna_api_up=0` +
  `console.error`, не пробрасываются наружу
- **Не дублируется**: защита от перекрытия долгих циклов (isRunning flag)

## Где инструментировано

| Файл | Что считает |
|---|---|
| `src/app.ts` | HTTP middleware + endpoint `/metrics` |
| `src/index.ts` | Запуск/остановка collector'а, регистрация в cron-registry |
| `src/lib/metrics.ts` | Все определения метрик |
| `src/lib/metrics-collector.ts` | Периодический сбор данных Remna |
| `src/lib/payment-metrics.ts` | Хелперы для webhook'ов |
| `src/modules/payment/mark-paid.service.ts` | Бизнес-счётчики (tariff/referral) |
| `src/modules/webhooks/*.webhooks.routes.ts` | Все 10 платёжных webhook'ов |
| `src/modules/telegram-stars/telegram-stars.service.ts` | Invoice creation errors |

## Примеры PromQL запросов

```promql
# Все успешные платежи FreeKassa за последний час
sum by (product) (
  increase(stealthnet_payment_processed_total{provider="freekassa"}[1h])
)

# Процент отказов YooKassa
sum(rate(stealthnet_payment_webhook_total{provider="yookassa",outcome="signature_invalid"}[5m]))
  /
sum(rate(stealthnet_payment_webhook_total{provider="yookassa"}[5m]))

# Текущее количество online-пользователей на нодах
sum(stealthnet_remna_node_users_online) by (node_name)

# 95-й перцентиль времени обработки платежей
histogram_quantile(0.95,
  sum by (provider, le) (
    rate(stealthnet_payment_processing_duration_seconds_bucket[5m])
  )
)

# Состояние Remnawave API (алерт если 0)
stealthnet_remna_api_up == 0

# Подключённые ноды (алерт если 0)
stealthnet_remna_nodes{status="connected"} == 0
```

## Конфигурация Prometheus (scrape)

```yaml
scrape_configs:
  - job_name: stealthnet
    scrape_interval: 30s
    static_configs:
      - targets: ['stealthnet-api:5000']
    metrics_path: /metrics
```

Если Prometheus на другой машине и nginx проксирует `/metrics` — замените
target на `https://your-domain.com`.

## Защита endpoint'а

По умолчанию endpoint открыт (но не публикуется через nginx). Если решите
публиковать — обязательно:

1. В `nginx/nginx.conf` раскомментируйте блок `location ^~ /metrics`
2. Добавьте `allow <prometheus-ip>; deny all;` внутри блока
3. Либо навесьте basic auth + secret header

Endpoint отдаёт ТОЛЬКО агрегаты (счётчики, гистограммы), без PII. Случайное
открытие в интернет не приведёт к утечке пользовательских данных, но даст
злоумышленнику информацию о нагрузке/структуре системы.
