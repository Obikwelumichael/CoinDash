const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

async function loadHelpers() {
  let source = read("js/ui/market-motion.js");
  source = source.replace(
    /import \{ formatChangePercent, formatPrice \} from "\.\.\/utils\/formatters\.js";/,
    `const formatChangePercent = (value) => String(value);
     const formatPrice = (value) => String(value);`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("dashboard places the market motion strip immediately after the hero", () => {
  const html = read("index.html");
  const hero = html.indexOf('class="hero workspace-hero dashboard-overview-hero"');
  const motion = html.indexOf('id="marketMotion"');
  const dominance = html.indexOf('class="market-dominance-section"');
  assert.ok(hero > -1 && motion > hero && dominance > motion);
  assert.match(html, /data-market-motion-status[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /data-market-motion-track[^>]+aria-hidden="true"/);
  assert.match(html, /data-market-motion-viewport[^>]+tabindex="0"/);
});

test("market motion selects preferred major assets before rank fallbacks", async () => {
  const { selectMarketMotionCoins, getMarketMotionDirection } = await loadHelpers();
  const markets = [
    { id: "other", symbol: "OTH", rank: 1 },
    { id: "ethereum", symbol: "ETH", rank: 2 },
    { id: "bitcoin", symbol: "BTC", rank: 3 },
    { id: "solana", symbol: "SOL", rank: 4 },
  ];
  assert.deepEqual(selectMarketMotionCoins(markets, 4).map((coin) => coin.id), ["bitcoin", "ethereum", "solana", "other"]);
  assert.equal(getMarketMotionDirection(2), "positive");
  assert.equal(getMarketMotionDirection(-2), "negative");
  assert.equal(getMarketMotionDirection(null), "neutral");
  assert.equal(getMarketMotionDirection(0), "neutral");
});

test("ticker reuses the dashboard snapshot and socket without another data connection", () => {
  const app = read("js/app.js");
  const component = read("js/ui/market-motion.js");
  assert.equal((app.match(/fetch\("\/api\/markets"\)/g) || []).length, 1);
  assert.equal((app.match(/connectMarketSocket\(/g) || []).length, 1);
  assert.match(app, /marketMotion\?\.setCoins\(coins\)/);
  assert.match(app, /marketMotion\?\.updateCoins\(data\.coins\)/);
  assert.doesNotMatch(component, /fetch\(|new WebSocket/);
  assert.match(component, /nextIds === currentIds[\s\S]*?updateCoins\(next\)/);
  assert.match(component, /track\.hidden = false;[\s\S]*?const baseWidth = Math\.max\(primary\.scrollWidth, 1\)/);
  assert.match(component, /Math\.ceil\(viewport\.clientWidth \/ baseWidth\)/);
});

test("ticker CSS provides seamless, pausable, responsive, and reduced-motion behavior", () => {
  const css = read("css/style.css");
  assert.match(css, /@keyframes marketMotionScroll[\s\S]*?translateX\(-50%\)/);
  assert.match(css, /\.market-motion:hover \.market-motion__track[\s\S]*?animation-play-state: paused/);
  assert.match(css, /--market-motion-shell-width: calc\(100vw - var\(--dashboard-sidebar\)\)/);
  assert.match(css, /margin: 0 0 clamp\(18px, 2\.5vw, 34px\) calc\(\(100% - var\(--market-motion-shell-width\)\) \/ 2\)/);
  assert.match(css, /@media \(max-width: 1000px\)[\s\S]*?\.market-motion \{ --market-motion-shell-width: 100vw; \}/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.market-motion/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.market-motion__track \{ animation: none/);
  assert.match(css, /body\[data-theme="light"\] \.market-motion/);
});
