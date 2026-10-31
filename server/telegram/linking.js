const { createHash, randomBytes } = require("node:crypto");
const { pool } = require("../db/pool");

const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashLinkToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function generateLinkToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLinkToken(token), expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MS) };
}

async function createLinkToken(userId, database = pool) {
  const generated = generateLinkToken();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const existing = await client.query("SELECT 1 FROM telegram_links WHERE user_id = $1", [userId]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("UPDATE telegram_link_tokens SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP) WHERE user_id = $1 AND used_at IS NULL", [userId]);
    await client.query(
      "INSERT INTO telegram_link_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [userId, generated.tokenHash, generated.expiresAt],
    );
    await client.query("COMMIT");
    return { token: generated.token, expiresAt: generated.expiresAt };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function consumeLinkToken({ token, chatId, telegramUserId, username }, database = pool) {
  if (!TOKEN_PATTERN.test(token) || !/^-?\d+$/.test(String(chatId)) || !/^\d+$/.test(String(telegramUserId))) return { status: "invalid" };
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const attempt = await client.query(
      `INSERT INTO telegram_link_attempts (chat_id, attempts) VALUES ($1, 1)
       ON CONFLICT (chat_id) DO UPDATE SET
         attempts = CASE WHEN telegram_link_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 1 ELSE telegram_link_attempts.attempts + 1 END,
         window_started_at = CASE WHEN telegram_link_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN CURRENT_TIMESTAMP ELSE telegram_link_attempts.window_started_at END
       RETURNING attempts`,
      [chatId],
    );
    if (Number(attempt.rows[0].attempts) > 10) {
      await client.query("COMMIT");
      return { status: "rate_limited" };
    }
    const found = await client.query(
      `SELECT id, user_id FROM telegram_link_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [hashLinkToken(token)],
    );
    if (!found.rows[0]) {
      await client.query("COMMIT");
      return { status: "invalid" };
    }
    const link = await client.query(
      `INSERT INTO telegram_links (user_id, chat_id, telegram_user_id, username)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [found.rows[0].user_id, chatId, telegramUserId, username?.slice(0, 64) || null],
    ).catch((error) => {
      if (error.code === "23505") return null;
      throw error;
    });
    if (!link) {
      await client.query("ROLLBACK");
      return { status: "unavailable" };
    }
    await client.query("UPDATE telegram_link_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1", [found.rows[0].id]);
    await client.query("DELETE FROM telegram_link_attempts WHERE chat_id = $1", [chatId]);
    await client.query("COMMIT");
    return { status: "linked", userId: found.rows[0].user_id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { LINK_TOKEN_TTL_MS, TOKEN_PATTERN, consumeLinkToken, createLinkToken, generateLinkToken, hashLinkToken };
