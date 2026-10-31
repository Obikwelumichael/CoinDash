const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("Markets hero presents existing live market context without adding a data path", () => {
  const html = read("pages/markets.html");
  const app = read("js/app.js");

  assert.match(html, /class="hero workspace-hero market-workspace-hero"/);
  assert.match(html, /id="marketConnectionStatus"/);
  assert.match(html, /id="lastUpdated"/);
  assert.match(html, /id="marketPageRefresh"/);
  assert.match(html, /href="#market-table"/);
  assert.match(html, /href="#marketMovers"/);

  for (const id of [
    "marketBreadthContent",
    "marketBreadthSummary",
    "marketBreadthAdvancing",
    "marketBreadthDeclining",
    "marketCapValue",
    "marketCapChange",
    "volumeValue",
    "volumeChange",
    "btcDominanceValue",
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} remains unique`);
  }

  assert.equal((app.match(/fetch\("\/api\/markets"/g) || []).length, 1, "one market fetch path");
  assert.equal((app.match(/fetch\("\/api\/global"/g) || []).length, 1, "one global fetch path");
  assert.match(app, /calculateMarketBreadth\(coins\)/);
  assert.match(app, /connectMarketSocket\(\(data\) =>/);
  assert.match(app, /heroSection\.insertAdjacentElement\("afterend", marketTableSection\)/);
});

test("Markets hero keeps a fluid, accessible layout at compact widths", () => {
  const css = read("css/style.css");

  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(440px, \.95fr\)/);
  assert.match(css, /@media screen and \(max-width: 1180px\)/);
  assert.match(css, /@media screen and \(max-width: 700px\)/);
  assert.match(css, /@media screen and \(max-width: 430px\)/);
  assert.match(css, /\.market-page \.market-workspace-hero #marketPageRefresh \{ min-height: 44px; \}/);
  assert.match(css, /\.market-hero-actions a:focus-visible/);
  assert.match(css, /\.market-hero-terminal \{[^}]*min-width: 0;/s);
});

test("Markets toolbar selects suppress the duplicate native dropdown marker", () => {
  const css = read("css/style.css");
  const toolbarSelect = css.match(/\.market-table-toolbar select \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(toolbarSelect, /appearance: none;/);
  assert.match(toolbarSelect, /-webkit-appearance: none;/);
  assert.match(toolbarSelect, /linear-gradient\(45deg, transparent 50%, var\(--cyan\) 50%\)/);
});

test("Markets table keeps high, low, and supply values legible in both themes", () => {
  const css = read("css/style.css");

  assert.match(css, /\.market-page \.table-high,[\s\S]*?\.market-page \.table-low,[\s\S]*?\.market-page \.table-supply \{ color: var\(--text\); font: 600 11px "DM Mono", monospace; \}/);
});

test("Markets mobile table search remains in flow without the navbar flyout surface", () => {
  const css = read("css/style.css");
  const mobile = css.slice(css.indexOf("@media (max-width: 700px)", css.indexOf("@keyframes marketRefreshSpin")));

  assert.match(mobile, /\.market-page \.market-table-search\.nav-search\.is-open \{[\s\S]*?position: relative;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.match(mobile, /\.market-page \.market-table-search\.nav-search\.is-open \.nav-search-input \{ margin: 0; background: transparent; \}/);
  assert.match(mobile, /\.market-page \.market-table-search \.search-suggestions \{ right: auto; left: 0; width: 100%; \}/);
});

test("Expanded mobile search uses light surfaces in light mode", () => {
  const css = read("css/style.css");

  assert.match(css, /body\[data-theme="light"\] \.nav-search\.is-open:not\(\.market-table-search\) \.nav-search-input \{[\s\S]*?color: var\(--text\);[\s\S]*?background: #fff;/);
  assert.match(css, /body\[data-theme="light"\] \.search-suggestions \{[\s\S]*?background: rgba\(255, 255, 255, \.98\);/);
  assert.match(css, /@media \(max-width: 600px\) \{[\s\S]*?body\[data-theme="light"\] \.nav-search\.is-open:not\(\.market-table-search\) \{[\s\S]*?background: rgba\(255, 255, 255, \.98\);/);
});
