const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

async function loadHelpers() {
  let source = read("js/ui/market-heat-map.js");
  source = source.replace(
    /import \{ formatChangePercent, formatLargeNumber, formatPrice \} from "\.\.\/utils\/formatters\.js";/,
    `const formatChangePercent = (value) => String(value);
     const formatLargeNumber = (value) => String(value);
     const formatPrice = (value) => String(value);`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("major coin selection uses the configured CoinGecko IDs and omits missing or invalid assets", async () => {
  const { MAJOR_COIN_IDS, selectMajorCoins } = await loadHelpers();
  assert.equal(MAJOR_COIN_IDS.length, 20);
  assert.deepEqual(MAJOR_COIN_IDS.slice(0, 5), ["bitcoin", "ethereum", "tether", "binancecoin", "ripple"]);

  const selected = selectMajorCoins([
    { id: "ethereum", marketCap: 400, change: 2 },
    { id: "bitcoin", marketCap: 1000, change: 1 },
    { id: "tether", marketCap: null, change: 0 },
    { id: "not-configured", marketCap: 900, change: 10 },
  ]);
  assert.deepEqual(selected.map(({ id }) => id), ["bitcoin", "ethereum"]);
});

test("treemap areas remain proportional to market capitalization and inside the container", async () => {
  const { layoutTreemap } = await loadHelpers();
  const layout = layoutTreemap([
    { id: "bitcoin", marketCap: 800 },
    { id: "ethereum", marketCap: 200 },
  ], 1000, 500);
  assert.equal(layout.length, 2);

  const bitcoin = layout.find(({ id }) => id === "bitcoin");
  const ethereum = layout.find(({ id }) => id === "ethereum");
  const bitcoinArea = bitcoin.width * bitcoin.height;
  const ethereumArea = ethereum.width * ethereum.height;
  assert.ok(Math.abs(bitcoinArea / ethereumArea - 4) < 0.001);
  layout.forEach((tile) => {
    assert.ok(tile.x >= 0 && tile.y >= 0);
    assert.ok(tile.x + tile.width <= 1000.001);
    assert.ok(tile.y + tile.height <= 500.001);
  });

  const tallLayout = layoutTreemap([
    { id: "bitcoin", marketCap: 800 },
    { id: "ethereum", marketCap: 200 },
  ], 360, 540);
  assert.ok(tallLayout[0].height < 540, "largest tile should not force every remaining coin into a thin full-height column");
});

test("display weights preserve market-cap ordering while reducing extreme area differences", async () => {
  const { getTreemapDisplayWeight } = await loadHelpers();
  const large = getTreemapDisplayWeight(800);
  const small = getTreemapDisplayWeight(200);
  assert.ok(large > small);
  assert.ok(large / small < 4);
  assert.equal(getTreemapDisplayWeight(null), 0);
});

test("the symmetric color scale is robust to an extreme outlier", async () => {
  const { getChangeBound, getHeatStrength } = await loadHelpers();
  const bound = getChangeBound([
    { change: -1.2 }, { change: -0.5 }, { change: 0.3 }, { change: 1.1 }, { change: 2.2 }, { change: 80 },
  ]);
  assert.ok(bound >= 2 && bound <= 8);
  assert.equal(getHeatStrength(80, bound), 1);
  assert.equal(getHeatStrength(-80, bound), 1);
  assert.ok(getHeatStrength(1, bound) > 0);
});

test("major-coin summary uses only measured 24-hour changes", async () => {
  const { summarizeMajorCoins } = await loadHelpers();
  assert.deepEqual(summarizeMajorCoins([
    { change: 4 }, { change: -2 }, { change: 0 }, { change: null },
  ]), { up: 1, down: 1, average: 2 / 3 });
});

test("Markets markup exposes loading, retry, tooltip, summary, and mobile inspector states", () => {
  const html = read("pages/markets.html");
  assert.match(html, /id="marketHeatMap"[^>]+aria-busy="true"/);
  assert.match(html, /id="marketHeatMapTitle">Market Heat Map/);
  assert.match(html, /data-heat-map-loading/);
  assert.match(html, /data-heat-map-empty hidden/);
  assert.match(html, /data-heat-map-retry/);
  assert.match(html, /id="marketHeatMapTooltip"[^>]+role="tooltip"/);
  assert.match(html, /data-heat-map-up/);
  assert.match(html, /data-heat-map-down/);
  assert.match(html, /data-heat-map-average/);
  assert.match(html, /data-heat-map-period="change1h"/);
  assert.match(html, /data-heat-map-period="change" aria-pressed="true"/);
  assert.match(html, /data-heat-map-period="change7d"/);
  assert.match(html, /data-heat-map-inspector hidden/);
  assert.match(html, /class="market-heat-map-panel-bar"/);
  assert.match(html, /Heatmap Crypto/);
});

test("heat map consumes the existing market snapshot and shared WebSocket without another polling path", () => {
  const app = read("js/app.js");
  const component = read("js/ui/market-heat-map.js");
  assert.match(app, /marketHeatMap\?\.setCoins\(coins\)/);
  assert.match(app, /marketHeatMap\?\.updateCoins\(pendingUiUpdates\.map/);
  assert.match(app, /connectMarketSocket\(/);
  assert.doesNotMatch(component, /fetch\(|WebSocket|setInterval|setTimeout/);
  assert.match(component, /ResizeObserver/);
  assert.match(component, /image\.src = coin\.image/);
  assert.match(component, /image\.addEventListener\("error"/);
});

test("heat map CSS includes bounded mobile layout, focus treatment, and reduced motion", () => {
  const css = read("css/style.css");
  const heatMap = css.slice(css.lastIndexOf("/* Major-coins treemap"));
  assert.match(heatMap, /\.market-heat-map-stage[^}]+height:\s*clamp\(430px, 40vw, 540px\)/s);
  assert.match(heatMap, /\.market-heat-map-tile:focus-visible/);
  assert.match(heatMap, /\.market-heat-map-tile\.is-selected/);
  assert.match(heatMap, /\.market-heat-map-panel-bar/);
  assert.match(heatMap, /\.market-heat-map-icon/);
  assert.match(heatMap, /@media \(width <= 700px\)[\s\S]+\.market-heat-map-inspector:not\(\[hidden\]\) \{ display: block; \}/);
  assert.match(heatMap, /@media \(max-width: 390px\)/);
  assert.match(heatMap, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /body\[data-theme="light"\] \.market-heat-map-tile\[data-direction="positive"\]/);
  assert.match(css, /body\[data-theme="light"\] \.market-heat-map-tile\[data-direction="negative"\]/);
});
