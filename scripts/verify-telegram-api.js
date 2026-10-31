require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { pool } = require("../server/db/pool");
const { consumeLinkToken } = require("../server/telegram/linking");

const baseUrl = process.env.VERIFY_BASE_URL || "http://127.0.0.1:3199";

async function request(path, { cookie, method = "GET", body, csrf, webhookSecret } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-cointrack-csrf": csrf } : {}),
      ...(webhookSecret ? { "x-telegram-bot-api-secret-token": webhookSecret } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json();
  return { status: response.status, payload, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function main() {
  const marker = randomUUID();
  const emails = [`phase42-api-a-${marker}@example.test`, `phase42-api-b-${marker}@example.test`];
  const users = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const registered = await request("/api/auth/register", {
        method: "POST",
        body: { email: emails[index], password: `Phase42-safe-password-${index}!`, displayName: `Telegram API User ${index + 1}` },
      });
      if (registered.status !== 201) throw new Error(`Registration ${index} failed.`);
      users.push({ id: registered.payload.user.id, cookie: registered.cookie });
    }
    const unauthenticated = await request("/api/telegram");
    const statusA = await request("/api/telegram", { cookie: users[0].cookie });
    const missingCsrf = await request("/api/telegram/link-token", { cookie: users[0].cookie, method: "POST", body: {} });
    const token = await request("/api/telegram/link-token", {
      cookie: users[0].cookie,
      method: "POST",
      body: {},
      csrf: statusA.payload.csrfToken,
    });
    const linked = await consumeLinkToken({
      token: token.payload.token,
      chatId: "930000001",
      telegramUserId: "940000001",
      username: "phase42api",
    });
    const refreshedA = await request("/api/telegram", { cookie: users[0].cookie });
    const statusB = await request("/api/telegram", { cookie: users[1].cookie });
    const enabled = await request("/api/telegram/preferences", {
      cookie: users[0].cookie,
      method: "PUT",
      body: { enabled: true },
      csrf: refreshedA.payload.csrfToken,
    });
    const crossUserUnlink = await request("/api/telegram/link", {
      cookie: users[1].cookie,
      method: "DELETE",
      csrf: statusB.payload.csrfToken,
    });
    const stillLinked = await request("/api/telegram", { cookie: users[0].cookie });
    const badWebhook = await request("/api/telegram/webhook", { method: "POST", body: {} });
    const acceptedWebhook = await request("/api/telegram/webhook", {
      method: "POST",
      body: { update_id: 1 },
      webhookSecret: "test-webhook-secret",
    });
    const wrongCsrf = await request("/api/telegram/link", {
      cookie: users[0].cookie,
      method: "DELETE",
      csrf: "wrong-token",
    });
    const unlinked = await request("/api/telegram/link", {
      cookie: users[0].cookie,
      method: "DELETE",
      csrf: stillLinked.payload.csrfToken,
    });
    const finalA = await request("/api/telegram", { cookie: users[0].cookie });
    const result = {
      unauthenticated: unauthenticated.status,
      missingCsrf: missingCsrf.status,
      tokenCreated: token.status,
      linked: linked.status,
      ownerLinkedState: refreshedA.payload.telegram.linked,
      otherUserLinkedState: statusB.payload.telegram.linked,
      preferenceEnabled: enabled.status,
      otherUserUnlink: crossUserUnlink.status,
      ownerStillLinked: stillLinked.payload.telegram.linked,
      unauthorizedWebhook: badWebhook.status,
      authorizedWebhook: acceptedWebhook.status,
      wrongCsrf: wrongCsrf.status,
      ownerUnlink: unlinked.status,
      finalLinkedState: finalA.payload.telegram.linked,
      finalEnabledState: finalA.payload.telegram.enabled,
    };
    const expected = {
      unauthenticated: 401, missingCsrf: 403, tokenCreated: 201, linked: "linked",
      ownerLinkedState: true, otherUserLinkedState: false, preferenceEnabled: 200,
      otherUserUnlink: 204, ownerStillLinked: true, unauthorizedWebhook: 401,
      authorizedWebhook: 200, wrongCsrf: 403, ownerUnlink: 204,
      finalLinkedState: false, finalEnabledState: false,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (result[key] !== value) throw new Error(`Expected ${key}=${value}; got ${result[key]}.`);
    }
    console.log(JSON.stringify({ status: "passed", ...result }));
  } finally {
    await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
