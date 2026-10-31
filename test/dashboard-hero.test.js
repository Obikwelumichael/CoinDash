const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("dashboard hero exposes real market state and existing dashboard routes", () => {
  const html = read("index.html");
  const heroStart = html.indexOf('class="hero workspace-hero dashboard-overview-hero"');
  const heroEnd = html.indexOf("</section>", heroStart);
  const hero = html.slice(heroStart, heroEnd);

  for (const id of [
    "marketConnectionStatus",
    "marketOverview",
    "marketOverviewStatus",
    "marketCapValue",
    "marketCapChange",
    "volumeValue",
    "volumeChange",
    "btcDominanceValue",
    "activeCoinsValue",
    "lastUpdated",
  ]) {
    assert.match(hero, new RegExp(`id="${id}"`), `${id} remains inside the hero`);
  }
  assert.match(hero, /href="\/markets"/);
  assert.match(hero, /href="\/trending"/);
  assert.match(hero, /aria-live="polite"/);
});

test("dashboard hero reuses the single existing market and global data flows", () => {
  const source = read("js/app.js");

  assert.equal(source.match(/fetch\("\/api\/markets"\)/g)?.length, 1);
  assert.equal(source.match(/fetch\("\/api\/global"\)/g)?.length, 1);
  assert.match(source, /connectMarketSocket\([\s\S]*?updateMarketConnectionStatus/);
  assert.match(source, /function updateGlobalMarketUI\(data\)[\s\S]*?marketCapValue\.textContent/);
  assert.match(source, /function setMarketOverviewUnavailable\(message\)[\s\S]*?activeCoinsValue\.textContent = "—"/);
});

test("dashboard hero keeps its terminal layout responsive without the decorative ring", () => {
  const css = read("css/style.css");
  const heroCss = css.slice(css.indexOf("/* Dashboard market-terminal hero"));

  assert.match(heroCss, /grid-template-columns:\s*minmax\(0, 1\.05fr\)/);
  assert.match(heroCss, /\.dashboard-overview-hero::after \{ display: none; \}/);
  assert.match(heroCss, /@media screen and \(max-width: 900px\)/);
  assert.match(heroCss, /@media screen and \(max-width: 430px\)/);
  assert.match(heroCss, /min-height:\s*44px/);
  assert.match(heroCss, /:focus-visible/);
});

test("dashboard market overview keeps a clean table header in both themes", () => {
  const css = read("css/style.css");

  assert.match(css, /body:not\(\.market-page\) \.market-table-section thead th \{[\s\S]*?background: transparent;/);
  assert.match(css, /body\[data-theme="light"\]:not\(\.market-page\) \.market-table-section thead th \{ color: var\(--muted\); background: transparent; \}/);
  assert.match(css, /body:not\(\.market-page\) \.market-table-section \.table-high,[\s\S]*?\.table-low,[\s\S]*?\.table-supply \{[\s\S]*?color: var\(--text\);[\s\S]*?font-weight: 650;/);
});
