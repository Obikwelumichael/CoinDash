require("dotenv").config();

const { randomInt } = require("node:crypto");
const { pool } = require("../server/db/pool");

const baseUrl = process.env.VERIFY_BASE_URL || "http://127.0.0.1:3199";
const operationsToken = process.env.VERIFY_OPERATIONS_TOKEN;
const webhookSecret = process.env.VERIFY_WEBHOOK_SECRET;

async function request(path, { authorization, secret, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
      ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  if (!operationsToken || !webhookSecret) throw new Error("Verification tokens are required in the process environment.");
  const updateId = Number(`${Date.now()}${randomInt(10, 99)}`);
  try {
    const health = await request("/api/health");
    const unauthenticated = await request("/api/operations/telegram");
    const unauthorized = await request("/api/operations/telegram", { authorization: "incorrect-operator-token-value" });
    const authorized = await request("/api/operations/telegram", { authorization: operationsToken });
    const badWebhook = await request("/api/telegram/webhook", { secret: "incorrect-webhook-secret-value-000", body: { update_id: updateId } });
    const firstWebhook = await request("/api/telegram/webhook", { secret: webhookSecret, body: { update_id: updateId } });
    const duplicateWebhook = await request("/api/telegram/webhook", { secret: webhookSecret, body: { update_id: updateId } });
    const stored = await pool.query("SELECT count(*)::int AS count FROM telegram_webhook_updates WHERE update_id = $1", [updateId]);
    const serialized = JSON.stringify(authorized.body);
    const result = {
      healthStatus: health.status,
      application: health.body.application,
      postgres: health.body.postgres,
      telegramConfiguration: health.body.telegram?.configuration,
      worker: health.body.telegram?.worker,
      unauthenticatedOperations: unauthenticated.status,
      unauthorizedOperations: unauthorized.status,
      authorizedOperations: authorized.status,
      operationsHealth: authorized.body.telegram?.health,
      metricsPresent: Number.isInteger(authorized.body.telegram?.deliveries?.pending),
      secretLeak: serialized.includes(operationsToken) || serialized.includes(webhookSecret),
      unauthorizedWebhook: badWebhook.status,
      firstWebhook: firstWebhook.status,
      duplicateWebhook: duplicateWebhook.status,
      storedWebhookUpdates: stored.rows[0].count,
    };
    const expected = {
      healthStatus: 200, application: "ok", postgres: "ok", telegramConfiguration: "ready",
      worker: "disabled", unauthenticatedOperations: 401, unauthorizedOperations: 401,
      authorizedOperations: 200, metricsPresent: true, secretLeak: false,
      unauthorizedWebhook: 401, firstWebhook: 200, duplicateWebhook: 200, storedWebhookUpdates: 1,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (result[key] !== value) throw new Error(`Expected ${key}=${value}; received ${result[key]}.`);
    }
    console.log(JSON.stringify({ status: "passed", ...result }));
  } finally {
    await pool.query("DELETE FROM telegram_webhook_updates WHERE update_id = $1", [updateId]).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
