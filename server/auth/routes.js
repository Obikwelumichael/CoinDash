const express = require("express");
const { authenticate, register } = require("./service");
const { requireAuth } = require("../middleware/require-auth");
const { requestEmailVerification, requestPasswordReset, resetPassword, verifyEmail } = require("./account-tokens");
const { validatePassword } = require("./passwords");
const { createLoginChallenge, verifyLoginChallenge } = require("./two-factor");
const { sendLoginNotificationEmail, sendWelcomeEmail } = require("./email");
const { clearSessionCookie } = require("../middleware/require-auth");
const { revokeSessionId } = require("../session-revocation");

const router = express.Router();

function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.userId = user.id;
      return req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

function notifySuccessfulLogin(req, user) {
  const ipAddress = String(req.ip || req.socket?.remoteAddress || "Unavailable")
    .replace(/^::ffff:/, "");
  void sendLoginNotificationEmail(user, {
    signedInAt: new Date(),
    ipAddress,
    userAgent: req.get("user-agent"),
  }).catch((emailError) => {
    console.error(
      `Login notification email failed (${emailError.code || "EMAIL_ERROR"}${emailError.status ? `, provider HTTP ${emailError.status}` : ""}).`,
    );
  });
}

router.post("/register", async (req, res, next) => {
  try {
    const result = await register(req.body ?? {});
    if (result.errors) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: result.errors });
    if (result.duplicate) return res.status(409).json({ error: "An account with this email already exists." });
    await establishSession(req, result.user);
    void sendWelcomeEmail(result.user).catch((emailError) => {
      console.error(
        `Welcome email failed (${emailError.code || "EMAIL_ERROR"}${emailError.status ? `, provider HTTP ${emailError.status}` : ""}).`,
      );
    });
    const { email_verified_at, ...safeUser } = result.user;
    return res.status(201).json({ user: { ...safeUser, email_verified: Boolean(email_verified_at) } });
  } catch (error) { return next(error); }
});

router.post("/login", async (req, res, next) => {
  try {
    const user = await authenticate(req.body ?? {});
    if (!user) return res.status(401).json({ error: "Invalid email or password." });
    if (user.two_factor_enabled) {
      const challenge = await createLoginChallenge(user.id);
      return res.json({ twoFactorRequired: true, challenge });
    }
    await establishSession(req, user);
    notifySuccessfulLogin(req, user);
    const { two_factor_enabled, ...safeUser } = user;
    return res.json({ user: safeUser });
  } catch (error) { return next(error); }
});

router.post("/login/verify", async (req, res, next) => {
  try {
    const userId = await verifyLoginChallenge(req.body?.challenge, req.body?.code);
    if (!userId) return res.status(401).json({ error: "Invalid or expired verification code." });
    const { findSafeUserById } = require("./users");
    const user = await findSafeUserById(userId);
    if (!user) return res.status(401).json({ error: "Invalid or expired verification code." });
    await establishSession(req, user);
    notifySuccessfulLogin(req, user);
    return res.json({ user: { id: user.id, email: user.email, display_name: user.display_name, email_verified: Boolean(user.email_verified_at) } });
  } catch (error) { return next(error); }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254) {
      try {
        await requestPasswordReset(email);
      } catch (emailError) {
        // Keep the response indistinguishable from an unknown address, but retain safe server diagnostics.
        console.error(
          `Password reset email failed (${emailError.code || "EMAIL_ERROR"}${emailError.status ? `, provider HTTP ${emailError.status}` : ""}).`,
        );
      }
    }
    return res.status(202).json({ message: "If an account matches that email, password reset instructions will be sent." });
  } catch (error) { return next(error); }
});

router.post("/reset-password", async (req, res, next) => {
  const token = req.body?.token;
  const password = req.body?.password;
  if (typeof token !== "string" || token.length > 200 || !validatePassword(password)) {
    return res.status(400).json({ error: "Use a valid reset link and a password of 12–128 characters." });
  }
  try {
    const reset = await resetPassword(token, password);
    if (!reset) return res.status(400).json({ error: "This reset link is invalid or expired. Request a new one." });
    req.session.destroy(() => {});
    res.clearCookie("cryptodash.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return res.json({ message: "Your password has been reset. Please sign in with your new password." });
  } catch (error) { return next(error); }
});

router.post("/verification/request", requireAuth, async (req, res, next) => {
  try {
    const result = await requestEmailVerification(req.user);
    if (result.alreadyVerified) return res.json({ message: "This email address is already verified." });
    return res.json({ message: "Verification instructions have been sent if email delivery is available." });
  } catch {
    return res.status(503).json({ error: "Email delivery is temporarily unavailable. Please try again later." });
  }
});

router.post("/verification/confirm", async (req, res, next) => {
  const token = req.body?.token;
  if (typeof token !== "string" || token.length > 200) {
    return res.status(400).json({ error: "This verification link is invalid or expired." });
  }
  try {
    const verified = await verifyEmail(token);
    if (!verified) return res.status(400).json({ error: "This verification link is invalid or expired. Request a new one." });
    return res.json({ message: "Your email has been verified. You can continue using CoinDash." });
  } catch (error) { return next(error); }
});

router.get("/me", requireAuth, (req, res) => res.json({
  authenticated: true,
  user: {
    id: req.user.id,
    email: req.user.email,
    display_name: req.user.display_name,
    email_verified: Boolean(req.user.email_verified_at),
  },
}));

function logout(req, res, next) {
  const cookieExpiry = req.session?.cookie?.expires;
  revokeSessionId(req.sessionID, cookieExpiry instanceof Date ? cookieExpiry.getTime() : undefined);
  req.session.destroy((error) => {
    if (error) return next(error);
    clearSessionCookie(res);
    res.set("Cache-Control", "no-store, private");
    return res.status(204).end();
  });
}

router.post("/logout", logout);

module.exports = { authRouter: router, logout };
