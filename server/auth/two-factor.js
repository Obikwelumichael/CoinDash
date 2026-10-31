const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");
const { generateSecret, generateURI, verify } = require("otplib");
const QRCode = require("qrcode");
const { pool } = require("../db/pool");
const { verifyPassword } = require("./passwords");

function encryptionKey() {
  const encoded = process.env.TOTP_ENCRYPTION_KEY;
  if (!encoded) throw new Error("TOTP_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new Error("TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function encryptSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptSecret(value) {
  const [ivText, tagText, ciphertextText] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

function hashRecoveryCode(code) {
  return createHash("sha256").update(code.replaceAll("-", "").toUpperCase()).digest("hex");
}

function createRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const raw = randomBytes(16).toString("hex").toUpperCase();
    return raw.match(/.{1,4}/g).join("-");
  });
}

async function beginEnrollment(user) {
  const secret = generateSecret();
  const uri = generateURI({ issuer: "CoinDash", label: user.email, secret });
  const qrCode = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 240 });
  await pool.query(
    `INSERT INTO user_two_factor (user_id, secret_ciphertext, enabled_at, pending_expires_at)
     VALUES ($1, $2, NULL, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
     ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = EXCLUDED.secret_ciphertext,
       enabled_at = NULL, pending_expires_at = EXCLUDED.pending_expires_at, last_totp_step = NULL`,
    [user.id, encryptSecret(secret)],
  );
  return { qrCode, expiresInSeconds: 600 };
}

async function verifyTotp(secret, code) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  try { return (await verify({ secret, token: code, epochTolerance: 30 })).valid; }
  catch { return false; }
}

async function confirmEnrollment(userId, code) {
  const result = await pool.query(
    `SELECT secret_ciphertext FROM user_two_factor
     WHERE user_id = $1 AND enabled_at IS NULL AND pending_expires_at > CURRENT_TIMESTAMP`,
    [userId],
  );
  if (!result.rows[0]) return null;
  const secret = decryptSecret(result.rows[0].secret_ciphertext);
  if (!(await verifyTotp(secret, code))) return null;
  const codes = createRecoveryCodes();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE user_two_factor SET enabled_at = CURRENT_TIMESTAMP, pending_expires_at = NULL,
        last_totp_step = floor(extract(epoch from CURRENT_TIMESTAMP) / 30)::bigint
       WHERE user_id = $1 AND enabled_at IS NULL AND pending_expires_at > CURRENT_TIMESTAMP RETURNING user_id`,
      [userId],
    );
    if (!updated.rowCount) { await client.query("ROLLBACK"); return null; }
    await client.query("DELETE FROM two_factor_recovery_codes WHERE user_id = $1", [userId]);
    for (const recoveryCode of codes) {
      await client.query("INSERT INTO two_factor_recovery_codes (user_id, code_hash) VALUES ($1, $2)", [userId, hashRecoveryCode(recoveryCode)]);
    }
    await client.query("COMMIT");
    return codes;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function consumeRecoveryCode(userId, code, client = pool) {
  if (typeof code !== "string" || !/^[a-f\d]{4}(?:-[a-f\d]{4}){7}$/i.test(code)) return false;
  const result = await client.query(
    `DELETE FROM two_factor_recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
    [userId, hashRecoveryCode(code.replaceAll("-", ""))],
  );
  return Boolean(result.rowCount);
}

async function verifyAccountFactor(userId, code, client = pool) {
  const result = await client.query(
    "SELECT secret_ciphertext, last_totp_step FROM user_two_factor WHERE user_id = $1 AND enabled_at IS NOT NULL",
    [userId],
  );
  const record = result.rows[0];
  if (!record) return false;
  if (await consumeRecoveryCode(userId, code, client)) return true;
  const secret = decryptSecret(record.secret_ciphertext);
  if (!(await verifyTotp(secret, code))) return false;
  const step = Math.floor(Date.now() / 30000);
  if (record.last_totp_step !== null && Number(record.last_totp_step) >= step) return false;
  const updated = await client.query(
    "UPDATE user_two_factor SET last_totp_step = $2 WHERE user_id = $1 AND last_totp_step IS NOT DISTINCT FROM $3",
    [userId, step, record.last_totp_step],
  );
  return Boolean(updated.rowCount);
}

async function disableTwoFactor(userId, client = pool) {
  await client.query("DELETE FROM user_two_factor WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM two_factor_recovery_codes WHERE user_id = $1", [userId]);
}

async function createLoginChallenge(userId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await pool.query("DELETE FROM two_factor_login_challenges WHERE user_id = $1 OR expires_at <= CURRENT_TIMESTAMP", [userId]);
  await pool.query(
    "INSERT INTO two_factor_login_challenges (user_id, token_hash, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '5 minutes')",
    [userId, tokenHash],
  );
  return token;
}

async function verifyLoginChallenge(token, code) {
  if (typeof token !== "string" || token.length > 100) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, user_id FROM two_factor_login_challenges
       WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP AND attempts < 5 FOR UPDATE`,
      [tokenHash],
    );
    const challenge = found.rows[0];
    if (!challenge) { await client.query("ROLLBACK"); return null; }
    const valid = await verifyAccountFactor(challenge.user_id, code, client);
    if (valid) {
      await client.query("DELETE FROM two_factor_login_challenges WHERE id = $1", [challenge.id]);
    } else {
      const failed = await client.query("UPDATE two_factor_login_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts", [challenge.id]);
      if (Number(failed.rows[0]?.attempts) >= 5) await client.query("DELETE FROM two_factor_login_challenges WHERE id = $1", [challenge.id]);
    }
    await client.query("COMMIT");
    return valid ? challenge.user_id : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function verifyCurrentPassword(userId, password, client = pool, lock = false) {
  const result = await client.query(`SELECT password_hash FROM users WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [userId]);
  return result.rows[0] ? verifyPassword(result.rows[0].password_hash, password) : false;
}

module.exports = {
  beginEnrollment,
  confirmEnrollment,
  createLoginChallenge,
  createRecoveryCodes,
  decryptSecret,
  disableTwoFactor,
  encryptSecret,
  hashRecoveryCode,
  verifyAccountFactor,
  verifyCurrentPassword,
  verifyLoginChallenge,
};
