const { createHash, randomBytes } = require("node:crypto");
const { pool } = require("../db/pool");
const { buildEmailHtml, sendEmail } = require("./email");
const { hashPassword } = require("./passwords");

const RESET_TTL_MS = 30 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

function getBaseUrl() {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("APP_BASE_URL is not configured.");
  const parsed = new URL(baseUrl);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }
  return parsed.origin;
}

async function createTokenForUser(table, userId, ttlMs) {
  const { token, tokenHash } = createToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query(`UPDATE ${table} SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP) WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  await pool.query(
    `INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
  return token;
}

async function requestPasswordReset(email) {
  const result = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
  const user = result.rows[0];
  if (!user) return;
  const token = await createTokenForUser("password_reset_tokens", user.id, RESET_TTL_MS);
  const link = new URL("/reset-password", getBaseUrl());
  link.searchParams.set("token", token);
  await sendEmail({
    to: user.email,
    subject: "Reset your CoinDash password",
    text: `Reset your CoinDash password using this one-time link within 30 minutes: ${link.href}\n\nIf you did not request this, you can safely ignore this email.`,
    html: buildEmailHtml({
      preheader: "Your CoinDash password reset link expires in 30 minutes.",
      eyebrow: "Account security",
      title: "Reset your password",
      intro: "We received a request to reset the password for your CoinDash account. Use the secure, one-time link below to choose a new password.",
      action: { label: "Reset password", href: link.href },
      details: [{ label: "Link expires", value: "In 30 minutes" }],
      note: "If you did not request a password reset, you can safely ignore this email. Your password will not change.",
    }),
  });
}

async function resetPassword(token, newPassword) {
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(newPassword);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [tokenHash],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [passwordHash, row.user_id]);
    await client.query("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1", [row.id]);
    await client.query("UPDATE password_reset_tokens SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP) WHERE user_id = $1", [row.user_id]);
    await client.query("DELETE FROM session WHERE sess->>'userId' = $1", [row.user_id]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function requestEmailVerification(user) {
  if (user.email_verified_at) return { alreadyVerified: true };
  const token = await createTokenForUser("email_verification_tokens", user.id, VERIFY_TTL_MS);
  const link = new URL("/verify-email", getBaseUrl());
  link.searchParams.set("token", token);
  await sendEmail({
    to: user.email,
    subject: "Verify your CoinDash email",
    text: `Verify your CoinDash email using this one-time link within 24 hours: ${link.href}\n\nIf you did not create or use a CoinDash account, you can safely ignore this email.`,
    html: buildEmailHtml({
      preheader: "Confirm your email address to secure your CoinDash account.",
      eyebrow: "Email verification",
      title: "Confirm your email address",
      intro: "One quick step confirms that this email belongs to you and helps keep your CoinDash account secure.",
      action: { label: "Verify email", href: link.href },
      details: [{ label: "Link expires", value: "In 24 hours" }],
      note: "If you did not create or use a CoinDash account, you can safely ignore this email.",
    }),
  });
  return { alreadyVerified: false };
}

async function verifyEmail(token) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, user_id FROM email_verification_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [hashToken(token)],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE id = $1", [row.user_id]);
    await client.query("UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1", [row.id]);
    await client.query("UPDATE email_verification_tokens SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP) WHERE user_id = $1", [row.user_id]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { requestEmailVerification, requestPasswordReset, resetPassword, verifyEmail };
