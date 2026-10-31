const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("every chart entry point keeps the shared price, volume, RSI, and timeframe controls", () => {
  for (const file of ["index.html", "pages/markets.html", "pages/trending.html", "pages/watchlist.html"]) {
    const html = read(file);
    assert.match(html, /id="priceChart"/i, `${file} price chart`);
    assert.match(html, /id="volumeChart"/i, `${file} volume chart`);
    assert.match(html, /id="rsiChart"/i, `${file} RSI chart`);
    assert.match(html, /class="chart-range[^\"]*"[^>]+data-(?:days|interval)=/i, `${file} timeframe controls`);
  }
});

test("shared chart runtime delegates sizing to responsive containers", () => {
  const source = read("js/charts/market-chart.js");
  assert.match(source, /autoSize:\s*true/);
  assert.doesNotMatch(source, /chartOptions\((?:420|88|78)/);
  assert.match(source, /calculateEma\(candles\)/);
  assert.match(source, /calculateRsi\(candles\)/);
  assert.match(source, /synchronizeTimeScales/);
  assert.match(source, /entireTextOnly:\s*true/);
  assert.match(source, /document\.documentElement\.dataset\.theme === "light"/);
  assert.match(source, /cointrack:theme-change/);
});

test("compact chart CSS retains a dominant price pane and responsive mobile layout", () => {
  const css = read("css/style.css");
  const finalWorkspace = css.slice(css.lastIndexOf("/* Final responsive chart geometry"));
  assert.match(finalWorkspace, /height:\s*clamp\(460px,\s*calc\(100dvh - 200px\),\s*620px\)/);
  assert.match(finalWorkspace, /minmax\(220px,\s*4fr\)/);
  assert.match(finalWorkspace, /minmax\(54px,\s*1fr\)/);
  assert.match(finalWorkspace, /@media \(max-width: 700px\)/);
  assert.match(finalWorkspace, /overflow-x:\s*auto/);
  assert.match(finalWorkspace, /\.dashboard-main > \.coin-details[\s\S]*?margin-top:\s*clamp\(24px,\s*3vw,\s*40px\)/);
  assert.match(finalWorkspace, /margin-bottom:\s*clamp\(36px,\s*5vw,\s*72px\)/);
});

test("mobile chart controls retain touch-sized targets without widening the page", () => {
  const css = read("css/style.css");
  const finalWorkspace = css.slice(css.lastIndexOf("/* Final responsive chart geometry"));
  const mobileWorkspace = finalWorkspace.slice(finalWorkspace.lastIndexOf("@media (max-width: 700px)"));

  assert.match(mobileWorkspace, /\.chart-controls\s*{[^}]*width:\s*100%/s);
  assert.match(mobileWorkspace, /\.chart-range\s*{[^}]*min-width:\s*44px[^}]*height:\s*44px/s);
  assert.match(mobileWorkspace, /\.coin-details \.details-header button\s*{[^}]*min-height:\s*44px/s);
});

test("all close paths clear mounted chart instances", () => {
  assert.match(read("js/charts/market-chart.js"), /closeDetailsButton[\s\S]*?clearChart\(\)/);
  assert.match(read("js/pages/trending.js"), /function closeTrendingCoinChart\(\)[\s\S]*?clearChart\(\)/);
  assert.match(read("js/pages/watchlist.js"), /function closeWatchlistCoinChart\(\)[\s\S]*?clearChart\(\)/);
});

test("open charts retain WebSocket price updates on every chart page", () => {
  assert.match(read("js/app.js"), /updateLiveChart\(update\)/);
  assert.match(read("js/pages/trending.js"), /updateLiveChart\(update\)/);
  assert.match(read("js/pages/watchlist.js"), /updateLiveChart\(update\)/);
});
