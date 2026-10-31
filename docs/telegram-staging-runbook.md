# Telegram staging runbook

CoinDash uses one Telegram webhook for account linking and a PostgreSQL outbox worker for alert delivery. It does not use long polling. Never paste bot tokens, webhook secrets, operations tokens, session secrets, link tokens, authorization headers, cookies, or Telegram chat identifiers into tickets, chat, logs, shell history, screenshots, or source control.

## Preparation safety boundary

Preparation and live delivery are separate changes. During preparation:

- keep `TELEGRAM_WORKER_DISABLED=true` and restart the application after changing configuration;
- do not call the worker's `runOnce()` method or otherwise process the outbox;
- do not fabricate market events or insert observations into the normal market tables;
- do not change authentication, CSRF, webhook validation, delivery limits, or preferences in SQL; and
- do not retry, requeue, or edit an expired delivery.

The market scheduler may continue collecting provider-backed observations and creating legitimate events while the delivery worker is disabled. This can produce a queue backlog, so the queue must be isolated before approval for a live cycle.

## Prepare the staging configuration

1. Create a dedicated staging bot through Telegram's official BotFather account.
2. Store `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in the deployment secret manager.
3. Use a stable public HTTPS staging deployment.
4. Configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WORKER_DISABLED`, `OPERATIONS_TOKEN`, and `APP_BASE_URL`.

`TELEGRAM_WEBHOOK_SECRET` and `OPERATIONS_TOKEN` must each be at least 32 characters. `OPERATIONS_TOKEN` protects server-to-server diagnostics and is compared with a timing-safe check. It must never be exposed to browser JavaScript.

For local development, `.env` and `.env.*` are ignored by the project while `.env.example` is deliberately tracked. Generate and write a strong local operations token without printing it or placing it in shell history:

```sh
umask 077
node <<'NODE'
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const path = ".env";
const current = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
const line = `OPERATIONS_TOKEN=${randomBytes(48).toString("base64url")}`;
const next = /^OPERATIONS_TOKEN=.*$/m.test(current)
  ? current.replace(/^OPERATIONS_TOKEN=.*$/m, line)
  : `${current.trimEnd()}${current.trim() ? "\n" : ""}${line}\n`;
fs.writeFileSync(path, next, { mode: 0o600 });
fs.chmodSync(path, 0o600);
console.log("OPERATIONS_TOKEN written to ignored .env; value not printed.");
NODE
```

Check only readiness, never the value:

```sh
node -e 'require("dotenv").config({ quiet: true }); console.log({ operationsTokenReady: (process.env.OPERATIONS_TOKEN || "").length >= 32 })'
```

On hosted staging, put the generated value in the platform's encrypted secret manager instead of uploading the local `.env`. Keep `TELEGRAM_WORKER_DISABLED=true` in both places until the controlled-cycle approval.

## Use a stable HTTPS staging origin

Use a durable staging deployment or an operator-owned staging hostname behind a reverse proxy with managed TLS. A temporary tunnel URL can be used only for a short, attended diagnostic; it must not be recorded as the permanent webhook or `APP_BASE_URL`.

Set `APP_BASE_URL` to the exact externally reachable origin, for example `https://staging.example`, with no path or trailing slash. In production mode CoinDash rejects a non-HTTPS base URL. Configure DNS and TLS first, then set:

```text
NODE_ENV=production
APP_BASE_URL=https://staging.example
TELEGRAM_WORKER_DISABLED=true
```

After restarting, verify `GET https://staging.example/api/health` and check that its Telegram configuration is ready while its worker lifecycle remains disabled. A correct `APP_BASE_URL` is also required for links rendered in Telegram alerts.

The webhook URL is derived from the same stable origin:

```text
https://staging.example/api/telegram/webhook
```

Register it deliberately through Telegram's official Bot API, passing `TELEGRAM_WEBHOOK_SECRET` as `secret_token`. Use a protected operator shell so neither secret appears in shell history or process output. Use `getWebhookInfo` to compare the configured URL, pending update count, and latest error with the intended origin. CoinDash never registers or deletes the webhook automatically.

## Apply migrations and inspect health

```sh
npm run migrate:up
node --test --test-isolation=none test/automatic-market-feed.test.js test/telegram-alerts.test.js test/market-alert-engine.test.js
npm start
```

`GET /api/health` checks the application process, PostgreSQL, Telegram configuration state, and worker lifecycle without contacting Telegram.

Detailed metrics require the server-to-server operations token. Run this only in a protected shell where the variable is already loaded; do not enable command tracing:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $OPERATIONS_TOKEN" \
  https://staging.example/api/operations/telegram
```

Investigate ambiguous deliveries, exhausted failures, eligible retries, or an oldest pending age above five minutes. An expired market delivery may still appear as queued while the worker is disabled; this is expected until the next approved worker cycle runs the expiry guard.

## Confirm the operator-controlled account and chat

1. Sign in to the operator-controlled staging CoinDash account in a private browser session.
2. Open **Signals**, choose **Connect Telegram**, and use only the one-time link generated for that signed-in account.
3. Complete linking in a private conversation with the dedicated staging bot.
4. Confirm the bot's link-success response appeared in that same operator-controlled chat.
5. Refresh **Signals** and confirm that the displayed Telegram username and link time correspond to the action just completed.

Do not reveal or compare raw chat IDs. CoinDash binds the one-time link to the signed-in user and records the Telegram identity supplied by the validated webhook. If ownership is uncertain, unlink and repeat the account-bound linking flow while the delivery worker remains disabled.

## Enable exactly one automatic category

Use the authenticated **Signals → Alert delivery settings** form; do not update preferences directly in SQL.

1. Keep account-wide Telegram alerts enabled.
2. Select exactly one of **Price movements**, **Unusual volume**, or **Breakouts** for the controlled test.
3. Disable the other two categories and save.
4. Refresh the page and visually verify that the retained category is on and the other two are off.

Saving through the existing preferences route also cancels queued/retry deliveries for categories that were turned off and updates their in-app delivery status. This is part of backlog isolation, not a reason to bypass the outbox.

The following read-only aggregate verifies the account state without returning a user ID, username, or Telegram identifier. It is suitable only when the database contains one designated linked staging account; otherwise scope it using an internal account parameter without selecting or printing that parameter:

```sql
SELECT
  count(*) FILTER (WHERE l.id IS NOT NULL
    AND COALESCE((p.notification_preferences->>'telegram_alerts')::boolean, false)) AS linked_and_enabled,
  count(*) FILTER (WHERE l.id IS NOT NULL
    AND COALESCE((p.notification_preferences->>'telegram_alerts')::boolean, false)
    AND (COALESCE((p.notification_preferences->>'market_price_movements')::boolean, false)::int
       + COALESCE((p.notification_preferences->>'market_unusual_volume')::boolean, false)::int
       + COALESCE((p.notification_preferences->>'market_breakouts')::boolean, false)::int) = 1) AS exactly_one_category
FROM user_preferences p
LEFT JOIN telegram_links l ON l.user_id = p.user_id;
```

## Treat expired deliveries safely

Do not retry or resurrect an expired market delivery. With the worker disabled, an expired row can remain in `queued` or `retry`; expiry alone does not mutate it.

At the start of the next explicitly approved worker cycle, the existing expiry guard changes such rows to `cancelled`, clears their locks, and records `expired_market_signal`. This happens before the claim query. The claim and final eligibility queries also require `expiresAt` to be in the future, so an expired market signal cannot be sent even if its cancellation update has not yet been observed.

Use this redacted diagnostic to count states without exposing recipient information:

```sql
SELECT
  count(*) FILTER (WHERE d.status IN ('queued','retry')
    AND (n.payload->>'expiresAt')::timestamptz <= CURRENT_TIMESTAMP) AS expired_pending_cancellation,
  count(*) FILTER (WHERE d.status IN ('queued','retry')
    AND (n.payload->>'expiresAt')::timestamptz > CURRENT_TIMESTAMP) AS unexpired_pending
FROM telegram_deliveries d
JOIN notifications n ON n.id = d.notification_id
WHERE n.notification_type = 'market_signal' AND n.payload ? 'expiresAt';
```

## Isolate one fresh legitimate delivery

Keep the worker disabled. Do not increase provider request frequency, alter prices, insert fixtures, or create a public injection endpoint.

1. After the category preference is saved and verified, record a staging-window timestamp in the operator notes.
2. Leave the normal market scheduler and provider-backed cache running.
3. Wait for one genuine detector transition in the retained category. If none occurs before its TTL would leave a safe operating margin, stop and wait for another event.
4. Inspect the new event, notification, and outbox row using read-only queries and non-secret IDs.
5. Do not request worker approval until there is exactly one unexpired, currently eligible queued delivery and no additional unexpired eligible delivery for the staging account.

Use the recorded timestamp as `$1` and the internal staging user ID as `$2` in a parameterized protected-shell query. Bind the ID without printing it. This aggregate does not return personal data:

```sql
WITH eligible AS (
  SELECT e.id AS event_id, n.id AS notification_id, d.id AS delivery_id,
         d.status, d.attempts, d.send_started_at, e.expires_at,
         e.created_at, n.payload->>'preferenceKey' AS preference_key
  FROM market_signal_events e
  JOIN notifications n ON n.market_signal_event_id = e.id
  JOIN telegram_deliveries d ON d.notification_id = n.id
  JOIN telegram_links l ON l.id = d.telegram_link_id AND l.user_id = d.user_id
  JOIN user_preferences p ON p.user_id = d.user_id
  WHERE d.user_id = $2::uuid
    AND e.expires_at > CURRENT_TIMESTAMP
    AND d.status = 'queued'
    AND d.next_attempt_at <= CURRENT_TIMESTAMP
    AND COALESCE((p.notification_preferences->>'telegram_alerts')::boolean, false)
    AND COALESCE((p.notification_preferences->>(n.payload->>'preferenceKey'))::boolean, false)
), candidate AS (
  SELECT * FROM eligible WHERE created_at >= $1::timestamptz
)
SELECT count(DISTINCT event_id) AS logical_events,
       count(DISTINCT notification_id) AS notifications,
       count(DISTINCT delivery_id) AS deliveries,
       count(*) FILTER (WHERE attempts = 0 AND send_started_at IS NULL) AS untouched_deliveries,
       min(preference_key) AS retained_category,
       min(expires_at) AS earliest_expiry,
       (SELECT count(*) FROM eligible) AS all_unexpired_eligible
FROM candidate;
```

Before approval, the four candidate counts and `all_unexpired_eligible` must all be `1`, `retained_category` must match the one enabled category, and the expiry must leave enough time for the controlled cycle and visual receipt check. This proves there is no second unexpired eligible delivery for that staging account. Record only timestamps and non-secret event, notification, and delivery IDs.

## Approval gate for one controlled live cycle

Request explicit operator approval only after collecting all of the following evidence:

- migration 008 is applied;
- `APP_BASE_URL` is the intended stable HTTPS origin and webhook configuration matches it;
- the operations token readiness check passes without revealing its value;
- `/api/health` reports the Telegram worker disabled;
- the operator has confirmed the account-bound link in the actual staging chat;
- account-wide delivery is enabled, exactly one automatic category is enabled, and the other two are disabled;
- expired deliveries are identified and left untouched for the expiry guard;
- exactly one fresh logical event, notification, and unexpired queued delivery is eligible;
- that delivery has zero attempts, no send start, and sufficient TTL remaining; and
- the operator has the linked Telegram chat open for a receipt check.

Approval is for one controlled worker cycle only. API acceptance and visible receipt in the linked chat are separate pieces of evidence. A worker run, an outbox row, or a `processing` status alone does not prove delivery.

## Deterministic verification only

Major-event escalation, emergency cooldowns, deduplication, opt-outs, delivery rate limits, concurrent scans, retries, and ambiguous outcomes must be verified with fake clocks, controlled observations, and a fake Telegram adapter:

```sh
node --test --test-isolation=none test/automatic-market-feed.test.js test/telegram-alerts.test.js test/market-alert-engine.test.js
```

These tests cannot prove Telegram API acceptance or message receipt. Do not fabricate a major live-market event.

## Failure interpretation

- `retry`: a transient failure is waiting for its bounded retry.
- `failed`: retries were exhausted or Telegram returned a permanent failure.
- `ambiguous`: Telegram was contacted, but CoinDash could not safely persist the result. It is intentionally not resent automatically because Telegram may already have accepted it.
- `worker_interrupted`: a job was claimed but sending had not started; it is safe for the worker to retry.
- `link_or_preference_removed`: delivery was cancelled before sending.
- `expired_market_signal`: the expiry guard cancelled a stale delivery before claim.
- `preference_disabled`: saving preferences cancelled a delivery for a category that was turned off.

For an ambiguous delivery, compare the notification time with the authorized staging chat before deciding on any manual action. CoinDash does not claim exactly-once delivery.

## Rollback

1. Set `TELEGRAM_WORKER_DISABLED=true` and restart.
2. Remove the webhook deliberately through Telegram's `deleteWebhook` method.
3. Leave in-app notification history intact.
4. Do not roll back database migrations while records are needed for investigation.
