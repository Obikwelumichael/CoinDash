const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const sharedPages = [
  "index.html",
  "pages/markets.html",
  "pages/trending.html",
  "pages/watchlist.html",
  "pages/signals.html",
  "pages/news.html",
  "pages/settings.html",
];

test("every shared page retains the accessible mobile navigation controls", () => {
  sharedPages.forEach((file) => {
    const html = read(file);
    assert.match(html, /<nav class="nav-links" id="primaryNav" aria-label="Main navigation">/, `${file} primary nav`);
    assert.match(html, /id="mobileNavToggle"[\s\S]*?aria-expanded="false"[\s\S]*?aria-controls="primaryNav"[\s\S]*?aria-label="Open navigation menu"/, `${file} toggle semantics`);
    assert.match(html, /js\/ui\/nav\.js/, `${file} shared controller`);
  });
});

test("shared navigation enhances real routes and existing authentication controls", () => {
  const source = read("js/ui/nav.js");

  for (const route of ["/", "/markets", "/trending", "/watchlist", "/signals", "/news"]) {
    assert.match(source, new RegExp(`\\["${route.replace("/", "\\/")}"`), `${route} route retained`);
  }
  assert.match(source, /updatePrimaryNavState\(\)/);
  assert.match(source, /createLink\("Dashboard", "\/", "mobile-nav-only"\)/);
  assert.match(source, /routePath\(target\.pathname\) === currentPath/);
  assert.match(source, /createAccountMenu\(user, true\)/);
  assert.match(source, /createLink\("Sign In", "\/login"/);
  assert.match(source, /createLink\("Sign Up", "\/signup"/);
  assert.match(source, /createLogoutButton\(\)/);
});

test("mobile drawer interaction covers backdrop, escape, focus, and scroll locking", () => {
  const source = read("js/ui/nav.js");

  assert.match(source, /backdrop\.className = "mobile-nav-backdrop"/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
  assert.match(source, /document\.body\.style\.overflow = bodyOverflowBeforeMenu/);
  assert.match(source, /backdrop\.addEventListener\("click", \(\) => setMenuOpen\(false, \{ returnFocus: true \}\)\)/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?returnFocus: true/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /last\.focus\(\)/);
  assert.match(source, /first\.focus\(\)/);
  assert.match(source, /if \(event\.target\.closest\("a"\)\) setMenuOpen\(false\)/);
  assert.match(source, /primaryNav\.inert = mobileMenuMedia\.matches && !shouldOpen/);
});

test("mobile drawer styling is compact, right-aligned, accessible, and motion-aware", () => {
  const css = read("css/style.css");
  const drawer = css.slice(css.indexOf("/* Shared mobile navigation drawer."));

  assert.match(drawer, /@media \(max-width: 1000px\)/);
  assert.match(css, /\.mobile-nav-only \{ display: none; \}/);
  assert.match(drawer, /\.mobile-nav-toggle,[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(drawer, /inset: 0 0 0 auto;/);
  assert.match(drawer, /width: min\(360px, calc\(100vw - 20px\)\)/);
  assert.match(drawer, /height: 100dvh;/);
  assert.match(drawer, /overflow-y: auto;/);
  assert.match(drawer, /transform: translateX\(100%\)/);
  assert.match(drawer, /\.mobile-nav-backdrop\.is-open/);
  assert.match(drawer, /\.mobile-nav-item\[aria-current="page"\]/);
  assert.match(drawer, /:focus-visible/);
  assert.match(drawer, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none;/);
});
