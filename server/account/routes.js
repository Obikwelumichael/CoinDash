const express = require("express");
const { pool } = require("../db/pool");
const { requireAuth } = require("../middleware/require-auth");
const { hashPassword, validatePassword } = require("../auth/passwords");
const {
  beginEnrollment,
  confirmEnrollment,
  disableTwoFactor,
  verifyAccountFactor,
  verifyCurrentPassword,
} = require("../auth/two-factor");

const router = express.Router();
router.use(requireAuth);

async function isTwoFactorEnabled(userId) {
  const result = await pool.query("SELECT enabled_at IS NOT NULL AS enabled FROM user_two_factor WHERE user_id = $1", [userId]);
  return Boolean(result.rows[0]?.enabled);
}

function clearSessionCookie(res) {
  res.clearCookie("cryptodash.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
}

router.get("/settings", async (req, res, next) => {
  try {
    const [factorEnabled, preferences, recoveryCount] = await Promise.all([
      isTwoFactorEnabled(req.user.id),
      pool.query("SELECT theme, notification_preferences FROM user_preferences WHERE user_id = $1", [req.user.id]),
      pool.query("SELECT count(*)::int AS count FROM two_factor_recovery_codes WHERE user_id = $1 AND used_at IS NULL", [req.user.id]),
    ]);
    const prefs = preferences.rows[0];
    return res.json({
      account: { id: req.user.id, email: req.user.email, displayName: req.user.display_name, emailVerified: Boolean(req.user.email_verified_at) },
      security: { twoFactorEnabled: factorEnabled, remainingRecoveryCodes: recoveryCount.rows[0].count },
      preferences: { theme: ["system", "dark", "light"].includes(prefs?.theme) ? prefs.theme : "dark", emailAlerts: prefs?.notification_preferences?.email_alerts === true },
    });
  } catch (error) { return next(error); }
});

router.patch("/profile", async (req, res, next) => {
  const displayName = req.body?.displayName;
  if (typeof displayName !== "string" || displayName.trim().length < 2 || displayName.trim().length > 80) {
    return res.status(400).json({ error: "Display name must be 2–80 characters." });
  }
  try {
    await pool.query("UPDATE users SET display_name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [displayName.trim(), req.user.id]);
    return res.json({ account: { id: req.user.id, email: req.user.email, displayName: displayName.trim() } });
  } catch (error) { return next(error); }
});

router.put("/password", async (req, res, next) => {
  const { currentPassword, newPassword, code } = req.body ?? {};
  if (typeof currentPassword !== "string" || !validatePassword(newPassword)) {
    return res.status(400).json({ error: "Enter your current password and a new password of 12–128 characters." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await verifyCurrentPassword(req.user.id, currentPassword, client, true))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    const factor = await client.query("SELECT enabled_at IS NOT NULL AS enabled FROM user_two_factor WHERE user_id = $1", [req.user.id]);
    if (factor.rows[0]?.enabled && !(await verifyAccountFactor(req.user.id, code, client))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "A valid authenticator or recovery code is required." });
    }
    await client.query("UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [await hashPassword(newPassword), req.user.id]);
    await client.query("DELETE FROM session WHERE sess->>'userId' = $1", [req.user.id]);
    await client.query("COMMIT");
    req.session.destroy(() => {});
    clearSessionCookie(res);
    return res.json({ message: "Password changed. Sign in again with your new password." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client.release(); }
});

router.get("/2fa/status", async (req, res, next) => {
  try {
    const enabled = await isTwoFactorEnabled(req.user.id);
    const result = await pool.query("SELECT count(*)::int AS count FROM two_factor_recovery_codes WHERE user_id = $1 AND used_at IS NULL", [req.user.id]);
    return res.json({ enabled, remainingRecoveryCodes: result.rows[0].count });
  } catch (error) { return next(error); }
});

router.post("/2fa/setup", async (req, res, next) => {
  try {
    if (typeof req.body?.currentPassword !== "string"
        || !(await verifyCurrentPassword(req.user.id, req.body.currentPassword))) {
      return res.status(401).json({ error: "Enter your current password to start two-factor setup." });
    }
    if (await isTwoFactorEnabled(req.user.id)) return res.status(409).json({ error: "Two-factor authentication is already enabled." });
    return res.json(await beginEnrollment(req.user));
  } catch (error) { return next(error); }
});

router.post("/2fa/confirm", async (req, res, next) => {
  const code = req.body?.code;
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the six-digit code from your authenticator app." });
  try {
    const recoveryCodes = await confirmEnrollment(req.user.id, code);
    if (!recoveryCodes) return res.status(400).json({ error: "The code is invalid or setup has expired. Start setup again." });
    return res.json({ enabled: true, recoveryCodes });
  } catch (error) { return next(error); }
});

router.post("/2fa/disable", async (req, res, next) => {
  const { currentPassword, code } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof code !== "string") return res.status(400).json({ error: "Current password and authenticator or recovery code are required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await verifyCurrentPassword(req.user.id, currentPassword, client, true))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    if (!(await verifyAccountFactor(req.user.id, code, client))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "The authenticator or recovery code is invalid." });
    }
    await disableTwoFactor(req.user.id, client);
    await client.query("COMMIT");
    return res.json({ enabled: false, message: "Two-factor authentication has been disabled." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client.release(); }
});

router.delete("/settings", async (req, res, next) => {
  const { currentPassword, code } = req.body ?? {};
  if (typeof currentPassword !== "string") return res.status(400).json({ error: "Confirm account deletion with your current password." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await verifyCurrentPassword(req.user.id, currentPassword, client, true))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    const factor = await client.query("SELECT enabled_at IS NOT NULL AS enabled FROM user_two_factor WHERE user_id = $1", [req.user.id]);
    if (factor.rows[0]?.enabled && !(await verifyAccountFactor(req.user.id, code, client))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "A valid authenticator or recovery code is required." });
    }
    await client.query("DELETE FROM session WHERE sess->>'userId' = $1", [req.user.id]);
    await client.query("DELETE FROM users WHERE id = $1", [req.user.id]);
    await client.query("COMMIT");
    req.session.destroy(() => {});
    clearSessionCookie(res);
    return res.json({ message: "Your account and associated watchlist, preferences, alerts, notifications, and security data have been permanently deleted." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client.release(); }
});

module.exports = { accountRouter: router };
