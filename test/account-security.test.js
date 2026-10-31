const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, validatePassword, verifyPassword } = require("../server/auth/passwords");
const {
  buildEmailHtml,
  sendEmail,
  sendLoginNotificationEmail,
  sendWelcomeEmail,
} = require("../server/auth/email");
const { createRecoveryCodes, decryptSecret, encryptSecret, hashRecoveryCode } = require("../server/auth/two-factor");
const { generate, generateSecret, verify } = require("otplib");
const { alertTransition, isConditionMet } = require("../server/alerts/evaluator");

test("password helpers enforce length and verify only the matching Argon2id password", async () => {
  assert.equal(validatePassword("short"), false);
  assert.equal(validatePassword("long-enough-passphrase"), true);
  assert.equal(validatePassword("x".repeat(129)), false);
  const hash = await hashPassword("correct horse battery staple");
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(hash, "incorrect password"), false);
});

test("TOTP encryption and recovery-code generation are safe for setup flows", async (t) => {
  const originalKey = process.env.TOTP_ENCRYPTION_KEY;
  t.after(() => {
    if (originalKey === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = originalKey;
  });
  process.env.TOTP_ENCRYPTION_KEY = require("node:crypto").randomBytes(32).toString("base64");
  const secret = generateSecret();
  const encrypted = encryptSecret(secret);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptSecret(encrypted), secret);
  const token = await generate({ secret });
  assert.equal((await verify({ secret, token })).valid, true);
  const codes = createRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.ok(codes.every((code) => /^[A-F\d]{4}(?:-[A-F\d]{4}){7}$/.test(code)));
  assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].replaceAll("-", "")));
  assert.notEqual(hashRecoveryCode(codes[0]), codes[0]);
});

test("market alert evaluator detects thresholds and suppresses repeat firing until rearmed", () => {
  assert.equal(isConditionMet({ direction: "above", threshold: 100 }, 101), true);
  assert.equal(isConditionMet({ direction: "below", threshold: -5 }, -6), true);
  assert.equal(isConditionMet({ direction: "above", threshold: 100 }, null), false);
  assert.equal(alertTransition(false, true), "trigger");
  assert.equal(alertTransition(true, true), "unchanged");
  assert.equal(alertTransition(true, false), "rearm");
  assert.equal(alertTransition(false, false), "unchanged");
});

test("Brevo email adapter sends through the provider and surfaces provider failures", async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BREVO_API_KEY;
  const originalFromName = process.env.EMAIL_FROM_NAME;
  const originalFromEmail = process.env.EMAIL_FROM_EMAIL;
  const originalBaseUrl = process.env.APP_BASE_URL;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalKey;
    if (originalFromName === undefined) delete process.env.EMAIL_FROM_NAME;
    else process.env.EMAIL_FROM_NAME = originalFromName;
    if (originalFromEmail === undefined) delete process.env.EMAIL_FROM_EMAIL;
    else process.env.EMAIL_FROM_EMAIL = originalFromEmail;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });
  process.env.BREVO_API_KEY = "xkeysib-test-only";
  process.env.EMAIL_FROM_NAME = "CoinDash";
  process.env.EMAIL_FROM_EMAIL = "test@example.com";
  process.env.APP_BASE_URL = "https://coindash.example";
  let sent;
  global.fetch = async (url, options) => {
    sent = { url, options };
    return { ok: true, status: 201 };
  };
  await sendEmail({ to: "user@example.com", subject: "Test", text: "body", html: "<p>body</p>" });
  assert.equal(sent.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(sent.options.headers["api-key"], "xkeysib-test-only");
  const message = JSON.parse(sent.options.body);
  assert.deepEqual(message.sender, { name: "CoinDash", email: "test@example.com" });
  assert.deepEqual(message.to, [{ email: "user@example.com" }]);
  assert.equal(message.textContent, "body");
  assert.equal(message.htmlContent, "<p>body</p>");

  await sendWelcomeEmail({ email: "new@example.com", display_name: "Ada" });
  const welcomeMessage = JSON.parse(sent.options.body);
  assert.deepEqual(welcomeMessage.to, [{ email: "new@example.com" }]);
  assert.equal(welcomeMessage.subject, "Welcome to CoinDash");
  assert.match(welcomeMessage.textContent, /thank you for creating your CoinDash account/i);
  assert.match(welcomeMessage.htmlContent, /Market intelligence/);
  assert.match(welcomeMessage.htmlContent, /Hi Ada, your account is ready/);
  assert.match(welcomeMessage.htmlContent, /Watchlists/);

  await sendLoginNotificationEmail(
    { email: "new@example.com", display_name: "Ada" },
    {
      signedInAt: new Date("2026-10-22T12:30:00.000Z"),
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
    },
  );
  const loginMessage = JSON.parse(sent.options.body);
  assert.equal(loginMessage.subject, "New sign-in to your CoinDash account");
  assert.match(loginMessage.textContent, /successful sign-in/i);
  assert.match(loginMessage.htmlContent, /New sign-in detected/);
  assert.match(loginMessage.htmlContent, /Chrome on Linux device/);
  assert.match(loginMessage.htmlContent, /203\.0\.113\.10/);
  assert.match(loginMessage.htmlContent, /https:\/\/coindash\.example\/forgot-password/);

  global.fetch = async () => ({ ok: false, status: 422 });
  await assert.rejects(sendEmail({ to: "user@example.com", subject: "Test", text: "body", html: "<p>body</p>" }), { code: "EMAIL_DELIVERY_FAILED" });
});

test("branded email template escapes personalized content and renders a clear action", () => {
  const html = buildEmailHtml({
    preheader: "Preview <safe>",
    eyebrow: "Account security",
    title: "Hi <script>alert(1)</script>",
    intro: "A request was received.",
    action: { label: "Review & continue", href: "https://example.com/reset?token=a&b=c" },
    details: [{ label: "Expires", value: "30 minutes" }],
    note: "Ignore this if it wasn't you.",
  });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Review &amp; continue/);
  assert.match(html, /https:\/\/example\.com\/reset\?token=a&amp;b=c/);
  assert.match(html, /Hi &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
