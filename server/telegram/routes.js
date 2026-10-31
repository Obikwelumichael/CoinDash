const { randomBytes, timingSafeEqual } = require("node:crypto");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { requireAuth } = require("../middleware/require-auth");
const { pool } = require("../db/pool");
const { consumeLinkToken, createLinkToken, TOKEN_PATTERN } = require("./linking");
const { sendTelegramMessage, telegramConfig } = require("./adapter");

const accountRouter = express.Router();
const webhookRouter = express.Router();
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many linking attempts. Try again later." },
});

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function ensureCsrfToken(req) {
  if (!req.session.telegramCsrfToken) req.session.telegramCsrfToken = randomBytes(24).toString("base64url");
  return req.session.telegramCsrfToken;
}

function requireTelegramCsrf(req, res, next) {
  if (!safeEqual(req.get("x-cointrack-csrf"), req.session?.telegramCsrfToken)) {
    return res.status(403).json({ error: "The security token is invalid or expired. Refresh and try again." });
  }
  return next();
}

accountRouter.use(requireAuth);
accountRouter.get("/", async (req, res, next) => {
  try {
    const [link, latest] = await Promise.all([
      pool.query(
        `SELECT username, linked_at,
           COALESCE((SELECT (notification_preferences->>'telegram_alerts')::boolean FROM user_preferences WHERE user_id = $1), FALSE) AS enabled
         FROM telegram_links WHERE user_id = $1`,
        [req.user.id],
      ),
      pool.query(
        "SELECT status, last_error_code, updated_at FROM telegram_deliveries WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
        [req.user.id],
      ),
    ]);
    const config = telegramConfig();
    return res.json({
      telegram: {
        configured: config.configured,
        botUsername: config.username,
        linked: Boolean(link.rows[0]),
        username: link.rows[0]?.username || null,
        linkedAt: link.rows[0]?.linked_at || null,
        enabled: link.rows[0]?.enabled === true,
        latestDelivery: latest.rows[0] || null,
      },
      csrfToken: ensureCsrfToken(req),
    });
  } catch (error) { return next(error); }
});

accountRouter.post("/link-token", tokenLimiter, requireTelegramCsrf, async (req, res, next) => {
  try {
    const created = await createLinkToken(req.user.id);
    if (!created) return res.status(409).json({ error: "Telegram is already linked. Unlink it before connecting another account." });
    const config = telegramConfig();
    const startUrl = config.username ? `https://t.me/${config.username}?start=${created.token}` : null;
    return res.status(201).json({
      token: created.token,
      expiresAt: created.expiresAt,
      startUrl,
      instructions: startUrl
        ? "Open the bot and press Start before this token expires."
        : "Telegram bot configuration is incomplete. An administrator must configure the public bot username.",
    });
  } catch (error) { return next(error); }
});

accountRouter.put("/preferences", requireTelegramCsrf, async (req, res, next) => {
  if (typeof req.body?.enabled !== "boolean" || Object.keys(req.body).some((key) => key !== "enabled")) {
    return res.status(400).json({ error: "enabled must be a boolean." });
  }
  try {
    if (req.body.enabled) {
      const linked = await pool.query("SELECT 1 FROM telegram_links WHERE user_id = $1", [req.user.id]);
      if (!linked.rowCount) return res.status(409).json({ error: "Link Telegram before enabling Telegram alerts." });
    }
    await pool.query(
      `INSERT INTO user_preferences (user_id, notification_preferences)
       VALUES ($1, jsonb_build_object('telegram_alerts', $2::boolean))
       ON CONFLICT (user_id) DO UPDATE SET
         notification_preferences = jsonb_set(user_preferences.notification_preferences, '{telegram_alerts}', to_jsonb($2::boolean), TRUE),
         updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, req.body.enabled],
    );
    if (!req.body.enabled) {
      await pool.query(
        "UPDATE telegram_deliveries SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND status IN ('queued', 'retry')",
        [req.user.id],
      );
      await pool.query(
        `UPDATE notifications n SET payload = jsonb_set(n.payload, '{delivery,telegram}', '"cancelled"'::jsonb, TRUE)
         FROM telegram_deliveries d WHERE d.notification_id = n.id AND d.user_id = $1 AND d.status = 'cancelled'`,
        [req.user.id],
      );
    }
    return res.json({ enabled: req.body.enabled });
  } catch (error) { return next(error); }
});

accountRouter.delete("/link", requireTelegramCsrf, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE telegram_link_tokens SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP) WHERE user_id = $1", [req.user.id]);
    await client.query("UPDATE telegram_deliveries SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND status IN ('queued', 'retry')", [req.user.id]);
    await client.query(
      `UPDATE notifications n SET payload = jsonb_set(n.payload, '{delivery,telegram}', '"cancelled"'::jsonb, TRUE)
       FROM telegram_deliveries d WHERE d.notification_id = n.id AND d.user_id = $1 AND d.status = 'cancelled'`,
      [req.user.id],
    );
    await client.query("DELETE FROM telegram_links WHERE user_id = $1", [req.user.id]);
    await client.query(
      "UPDATE user_preferences SET notification_preferences = jsonb_set(notification_preferences, '{telegram_alerts}', 'false'::jsonb, TRUE), updated_at = CURRENT_TIMESTAMP WHERE user_id = $1",
      [req.user.id],
    );
    await client.query("COMMIT");
    return res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client.release(); }
});

const START_MESSAGE = "Welcome to CoinDash! To connect your account, open Signals in CoinDash, select Connect Telegram, then open the generated linking link. Linking requires a fresh, unexpired link.";

function createTelegramWebhookHandler({
  database = pool,
  consumeToken = consumeLinkToken,
  sendMessage = sendTelegramMessage,
  getConfig = telegramConfig,
} = {}) {
  return async (req, res) => {
  const configuredSecret = getConfig().webhookSecret;
  if (!configuredSecret || !safeEqual(req.get("x-telegram-bot-api-secret-token"), configuredSecret)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  const updateId = req.body?.update_id;
  if (Number.isSafeInteger(updateId) && updateId >= 0) {
    try {
      const accepted = await database.query(
        "INSERT INTO telegram_webhook_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id",
        [updateId],
      );
      if (!accepted.rowCount) return res.status(200).json({ ok: true });
      void database.query("DELETE FROM telegram_webhook_updates WHERE received_at < CURRENT_TIMESTAMP - INTERVAL '30 days'").catch(() => {});
    } catch {
      return res.status(503).json({ error: "Webhook processing is temporarily unavailable." });
    }
  }
  const message = req.body?.message;
  const privateChat = message?.chat?.type === "private";
  if (!privateChat || typeof message?.text !== "string") return res.status(200).json({ ok: true });
  const command = message.text.trim().match(/^\/(start|link)(?:@\w+)?(?:\s+([A-Za-z0-9_-]{43}))?$/);
  if (!command) return res.status(200).json({ ok: true });
  if (command[1] === "start" && !command[2]) {
    void sendMessage({ chatId: message.chat.id, text: START_MESSAGE }).catch(() => {});
    return res.json({ ok: true });
  }
  if (!command[2]) return res.status(200).json({ ok: true });
  let responseText = "This link is invalid or expired. Request a new link from CoinDash.";
  try {
    const result = await consumeToken({
      token: command[2],
      chatId: message.chat.id,
      telegramUserId: message.from?.id,
      username: message.from?.username,
    });
    if (result.status === "linked") responseText = "Telegram is now linked to your CoinDash account. You can return to CoinDash and enable Telegram alerts.";
    else if (result.status === "rate_limited") responseText = "Too many attempts. Please wait before trying again.";
    else if (result.status === "unavailable") responseText = "This Telegram account cannot be linked. Return to CoinDash and try again.";
  } catch {
    responseText = "CoinDash could not complete linking right now. Please try again later.";
  }
  void sendMessage({ chatId: message.chat.id, text: responseText }).catch(() => {});
  return res.json({ ok: true });
  };
}

webhookRouter.post("/", createTelegramWebhookHandler());

module.exports = {
  START_MESSAGE,
  accountTelegramRouter: accountRouter,
  createTelegramWebhookHandler,
  requireTelegramCsrf,
  telegramWebhookRouter: webhookRouter,
};
