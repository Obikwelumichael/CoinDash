const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("Trending hero retains live status controls and explanatory context", () => {
  const html = read("pages/trending.html");
  assert.match(html, /class="trending-hero-copy"/);
  assert.match(html, /id="trendingDataStatus"/);
  assert.match(html, /id="trendingLastUpdated"/);
  assert.match(html, /id="refreshTrending"/);
  assert.match(html, /class="trending-hero-guide"/);
  assert.match(html, /Interest is a signal not a buy rating\./);
});

test("Trending hero has final desktop and mobile layout rules", () => {
  const css = read("css/style.css");
  const finalHero = css.slice(css.lastIndexOf("/* Final Trending hero composition"));
  assert.match(finalHero, /grid-template-columns:\s*minmax\(0, 1\.35fr\)/);
  assert.match(finalHero, /background:\s*transparent/);
  assert.match(finalHero, /@media \(max-width: 700px\)/);
  assert.match(finalHero, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(finalHero, /#refreshTrending \{ width: 100%/);
  assert.match(finalHero, /Keep the Trending hero dimensions after all legacy hero breakpoints/);
});
