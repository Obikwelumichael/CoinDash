const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const html = readFileSync(path.join(__dirname, "../pages/settings.html"), "utf8");
const script = readFileSync(path.join(__dirname, "../js/pages/settings.js"), "utf8");
const styles = readFileSync(path.join(__dirname, "../css/style.css"), "utf8");
const nav = readFileSync(path.join(__dirname, "../js/ui/nav.js"), "utf8");
const theme = readFileSync(path.join(__dirname, "../js/ui/theme.js"), "utf8");

test("account settings exposes only implemented sections and real form hooks", () => {
  for (const form of ["profile", "preferences", "two-factor-begin", "two-factor-confirm", "two-factor-disable", "password", "delete"]) {
    assert.match(html, new RegExp(`data-settings-form="${form}"`));
    assert.match(script, new RegExp(`data-settings-form=\\"${form}\\"`));
  }
  assert.match(html, /href="\/signals"/);
  assert.doesNotMatch(html, /data-settings-form="sessions"/);
  assert.doesNotMatch(html, /session identifier|user id/i);
});

test("settings fields retain labels, autocomplete, status regions, and destructive confirmation", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "settings markup must not contain duplicate IDs");
  for (const id of ["settingsDisplayName", "settingsEmail", "settingsTheme", "settingsEmailAlerts", "currentPassword", "newPassword", "deletePassword"]) {
    assert.match(html, new RegExp(`for="${id}"`));
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(script, /window\.confirm\("Permanently delete this account/);
});

test("settings requests use existing account endpoints and expose busy states", () => {
  for (const endpoint of [
    "/api/account/settings", "/api/account/profile", "/api/preferences",
    "/api/auth/verification/request", "/api/account/2fa/status", "/api/account/2fa/setup",
    "/api/account/2fa/confirm", "/api/account/2fa/disable", "/api/account/password",
  ]) assert.match(script, new RegExp(endpoint.replaceAll("/", "\\/")));
  assert.match(script, /credentials: "same-origin"/);
  assert.match(script, /setBusy\(form, true/);
  assert.match(script, /button\.disabled = busy/);
  assert.match(script, /setAttribute\("aria-busy", String\(busy\)\)/);
});

test("settings styles include responsive, focus, reduced-motion, and scoped light-theme rules", () => {
  assert.match(styles, /\.settings-page\[data-theme="light"\]/);
  assert.match(styles, /\.settings-section button:focus-visible/);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*?\.settings-nav/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.settings-fields-grid/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.settings-toggle-row/);
  assert.match(nav, /document\.body\.classList\.contains\("dashboard-shell-page"\)/);
});

test("password columns align from the top and settings navigation tracks sections", () => {
  assert.match(styles, /\.settings-fields-grid > label \{ align-content: start; align-self: start; \}/);
  assert.match(html, /for="deleteCode"><span class="settings-label-copy">Authenticator or recovery code/);
  assert.match(styles, /\.settings-label-copy \{ display: flex; align-items: baseline;/);
  assert.match(script, /document\.querySelector\(link\.hash\)\?\.closest\("section"\)/);
  assert.match(script, /link\.addEventListener\("click", \(\) => setActiveSection\(link\)\)/);
  assert.match(script, /window\.addEventListener\("scroll"/);
  assert.doesNotMatch(script, /new IntersectionObserver/);
});

test("settings keeps dark as the fallback while sharing dark, device, and light choices site-wide", () => {
  assert.match(html, /<option value="dark">Dark<\/option><option value="system">Use device setting<\/option><option value="light">Light<\/option>/);
  assert.match(script, /applyThemePreference/);
  assert.match(theme, /\["system", "dark", "light"\]/);
  assert.match(theme, /return "dark"/);
  assert.match(theme, /localStorage\.setItem\(THEME_STORAGE_KEY/);
  assert.match(nav, /syncThemeFromAccount/);
  assert.match(styles, /:root\[data-theme="light"\]/);
  assert.match(styles, /body\[data-theme="light"\]\.dashboard-shell-page/);
  assert.match(styles, /body\[data-theme="light"\] \.cookie-consent-card/);
  assert.match(styles, /body\[data-theme="light"\] \.signal-create-panel/);
  assert.match(styles, /body\[data-theme="light"\] \.nav-links a/);
  assert.match(styles, /body\[data-theme="light"\] \.watchlist-favorite/);
  assert.match(styles, /body\[data-theme="light"\] \.pagination button/);
  assert.match(styles, /body\[data-theme="light"\] \.market-heat-map-panel/);
  assert.match(styles, /body\[data-theme="light"\] \.news-lead-story/);
  assert.match(styles, /body\[data-theme="light"\] \.news-market-context/);
  assert.match(styles, /body\[data-theme="light"\] \.trending-momentum-summary/);
});

test("theme changes persist locally and save to the account immediately", () => {
  assert.match(script, /getElementById\("settingsTheme"\)\.addEventListener\("change", async/);
  assert.match(script, /applyThemePreference\(theme\);/);
  assert.match(script, /api\("\/api\/preferences", \{[\s\S]*?json\("PUT", \{ theme \}\)[\s\S]*?keepalive: true/);
  assert.match(script, /select\.disabled = true/);
  assert.match(script, /select\.disabled = false/);
  assert.doesNotMatch(script, /applyThemePreference\(normalizeTheme\(event\.currentTarget\.value\), \{ persist: false \}\)/);
});
