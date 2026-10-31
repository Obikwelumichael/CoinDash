const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const shellPages = [
  "index.html",
  "pages/markets.html",
  "pages/trending.html",
  "pages/watchlist.html",
  "pages/signals.html",
  "pages/news.html",
];

test("redesigned shell classes exist in initial HTML before navigation JavaScript runs", () => {
  for (const file of shellPages) {
    const html = read(file);
    const bodyTag = html.match(/<body\b[^>]*>/i)?.[0] ?? "";
    const mainTag = html.match(/<main\b[^>]*>/i)?.[0] ?? "";
    const initializer = html.indexOf("cointrack.dashboard-sidebar-collapsed.v1");
    const navbar = html.indexOf('<header class="navbar">');

    assert.match(bodyTag, /class="[^"]*\bdashboard-shell-page\b[^"]*"/i, `${file} body shell class`);
    assert.match(mainTag, /class="[^"]*\bdashboard-main\b[^"]*"/i, `${file} main shell class`);
    assert.ok(initializer > -1 && initializer < navbar, `${file} restores the saved shell state before visible markup`);
  }
});

test("the redesigned stylesheet remains render-blocking on every shell page", () => {
  for (const file of shellPages) {
    const html = read(file);
    const stylesheet = html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/i)?.[0] ?? "";
    assert.match(stylesheet, /href="(?:\.\.\/|\/)?css\/style\.css"/i, `${file} stylesheet path`);
    assert.doesNotMatch(stylesheet, /\b(?:media|disabled)=/i, `${file} stylesheet must not be deferred`);
    assert.ok(html.indexOf(stylesheet) < html.indexOf("<body"), `${file} stylesheet precedes body content`);
  }
});

test("dashboard and Markets ship their responsive workspace hero markup", () => {
  const dashboard = read("index.html");
  const markets = read("pages/markets.html");
  const css = read("css/style.css");

  assert.match(dashboard, /class="hero workspace-hero dashboard-overview-hero"/);
  assert.match(markets, /class="hero workspace-hero market-workspace-hero"/);
  assert.match(markets, /<h1>Crypto<span>markets\.<\/span><\/h1>/);
  assert.match(css, /\.dashboard-shell-page \.dashboard-main > \.workspace-hero/);
  assert.match(css, /\.workspace-hero \.hero-label::before/);
  assert.doesNotMatch(dashboard, /trending-hero-guide/);
  assert.match(markets, /class="market-hero-copy"/);
  assert.match(markets, /class="market-hero-terminal"/);
  assert.match(css, /\.market-page \.dashboard-main > \.market-workspace-hero/);
  assert.match(css, /\.market-hero-terminal/);
});

