const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");
const pages = {
  login: read("pages/login.html"),
  signup: read("pages/signup.html"),
  forgot: read("pages/forgot-password.html"),
  reset: read("pages/reset-password.html"),
  verify: read("pages/verify-email.html"),
};
const authScript = read("js/pages/auth.js");
const accountActions = read("js/pages/account-actions.js");
const styles = read("css/style.css");
const routes = read("server/auth/routes.js");

test("all implemented authentication pages use the shared scoped layout", () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.match(html, /<body class="auth-page [^"]+">/, `${name} must retain the auth-page scope`);
    assert.match(html, /class="auth-brand"/);
    assert.match(html, /class="auth-layout"/);
    assert.match(html, /class="auth-card/);
    assert.match(html, /aria-labelledby="authTitle"/);
  }
  assert.match(styles, /\.auth-layout \{ display: grid;/);
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*?\.auth-layout \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.auth-shell/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.auth-status-icon/);
});

test("login and signup retain supported fields, endpoints, and accessible controls", () => {
  assert.match(pages.login, /data-auth-form="login"/);
  assert.match(pages.login, /name="email"[^>]*autocomplete="email"/);
  assert.match(pages.login, /name="password"[^>]*autocomplete="current-password"/);
  assert.match(pages.login, /href="\/forgot-password"/);

  assert.match(pages.signup, /data-auth-form="register"/);
  for (const name of ["displayName", "email", "password", "confirmPassword"]) {
    assert.match(pages.signup, new RegExp(`name="${name}"`));
  }
  assert.match(pages.signup, /href="\/terms"/);
  assert.match(pages.signup, /href="\/privacy"/);
  assert.match(authScript, /loginUser\(\{ email: values\.email\.trim\(\), password: values\.password \}\)/);
  assert.match(authScript, /registerUser\(\{ email: values\.email\.trim\(\), password: values\.password, displayName: values\.displayName\.trim\(\) \}\)/);
  assert.match(authScript, /completeTwoFactorLogin\(twoFactorChallenge, values\.code\.trim\(\)\)/);
});

test("password controls target real inputs and preserve accessible state", () => {
  const passwordPages = [pages.login, pages.signup, pages.reset].join("\n");
  for (const target of ["loginPassword", "signupPassword", "confirmPassword", "newPassword", "confirmNewPassword"]) {
    assert.match(passwordPages, new RegExp(`id="${target}"`));
    assert.match(passwordPages, new RegExp(`data-password-toggle="${target}"`));
  }
  assert.match(passwordPages, /aria-pressed="false"/);
  assert.match(authScript, /button\.setAttribute\("aria-pressed", String\(!visible\)\)/);
  assert.match(accountActions, /button\.setAttribute\("aria-pressed", String\(!visible\)\)/);
});

test("recovery and verification retain token handling and anti-enumerating server behavior", () => {
  assert.match(pages.forgot, /data-account-action="forgot"/);
  assert.match(pages.reset, /data-account-action="reset"/);
  assert.match(pages.verify, /data-account-action="verify"/);
  assert.match(accountActions, /post\("\/api\/auth\/forgot-password"/);
  assert.match(accountActions, /post\("\/api\/auth\/reset-password", \{ token, password: values\.password \}\)/);
  assert.match(accountActions, /post\("\/api\/auth\/verification\/confirm", \{ token \}\)/);
  assert.match(accountActions, /new URLSearchParams\(window\.location\.search\)\.get\("token"\)/);
  assert.match(routes, /If an account matches that email, password reset instructions will be sent\./);
});

test("auth forms expose labels, status announcements, busy states, and valid autocompletes", () => {
  const combined = Object.values(pages).join("\n");
  for (const autocomplete of ["email", "name", "current-password", "new-password"]) {
    assert.match(combined, new RegExp(`autocomplete="${autocomplete}"`));
  }
  assert.match(combined, /role="status" aria-live="polite"/);
  assert.match(authScript, /form\.setAttribute\("aria-busy", "true"\)/);
  assert.match(accountActions, /form\.setAttribute\("aria-busy", "true"\)/);
  assert.match(styles, /\.auth-card input:focus-visible/);
  assert.match(styles, /\.auth-feedback\.is-error::before/);
  assert.match(styles, /\.auth-feedback\.is-success::before/);

  for (const [name, html] of Object.entries(pages)) {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${name} must not contain duplicate IDs`);
  }
});
