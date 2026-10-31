const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const nav = read("js/ui/nav.js");
const auth = read("js/services/auth-store.js");
const css = read("css/style.css");
const accountStyles = css.slice(css.indexOf("/* Shared authenticated account control."));

test("account menu uses real identity data and existing destinations", () => {
  assert.match(nav, /user\.display_name/);
  assert.match(nav, /identityEmail\.textContent = user\.email/);
  assert.match(nav, /user\.email_verified \? "Email verified" : "Verification needed"/);
  assert.match(nav, /accountInitials\(user\.display_name\)/);
  assert.doesNotMatch(nav, /gravatar|ui-avatars|randomuser/i);
  for (const route of ["/watchlist", "/settings", "/settings#securityTitle", "/signals#deliverySettingsTitle"]) {
    assert.match(nav, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("account trigger and dropdown synchronize accessible interaction state", () => {
  assert.match(nav, /trigger\.setAttribute\("aria-haspopup", "menu"\)/);
  assert.match(nav, /trigger\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(nav, /panel\.setAttribute\("role", "menu"\)/);
  assert.match(nav, /panel\.inert = !shouldOpen/);
  assert.match(nav, /document\.addEventListener\("pointerdown"/);
  assert.match(nav, /event\.key !== "Escape" \|\| !openAccountMenu/);
  assert.match(nav, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(nav, /if \(event\.target\.closest\("a"\)\) setAccountMenuOpen\(menu, false\)/);
  assert.match(nav, /restoreFocus: true/);
});

test("sign out retains the secure server-backed flow and failure state", () => {
  assert.match(auth, /request\("\/api\/auth\/logout", \{ method: "POST" \}\)/);
  assert.match(nav, /await logoutUser\(\)/);
  assert.match(nav, /Unable to sign out\. Try again\./);
  assert.match(nav, /data-account-menu-feedback/);
});

test("account menu styling supports professional desktop, mobile, light, and reduced-motion states", () => {
  assert.match(accountStyles, /\.account-menu-avatar \{[\s\S]*?width: 34px;[\s\S]*?height: 34px;/);
  assert.match(accountStyles, /width: min\(318px, calc\(100vw - 24px\)\)/);
  assert.match(accountStyles, /\.account-menu-trigger:focus-visible/);
  assert.match(accountStyles, /\.account-menu-chevron \{[\s\S]*?margin: -3px 2px 0 1px;[\s\S]*?transform: rotate\(45deg\);/);
  assert.match(accountStyles, /\.account-menu\.is-open \.account-menu-chevron \{ transform: rotate\(225deg\); \}/);
  assert.match(accountStyles, /body\[data-theme="light"\] \.account-menu-panel/);
  assert.match(accountStyles, /@media \(max-width: 1000px\)[\s\S]*?min-height: 44px;/);
  assert.match(accountStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none;/);
});
