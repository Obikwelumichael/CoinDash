const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

async function loadViewHelpers() {
  const source = read("js/utils/watchlist-view.js");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function loadWatchlistStore(fetchImpl) {
  global.fetch = fetchImpl;
  global.__watchlistAuthListener = null;
  let source = read("js/services/watchlist-store.js");
  source = source.replace(
    /import \{ handleUnauthorized, subscribeAuth \} from "\.\/auth-store\.js";/,
    `const handleUnauthorized = async () => {};
     const subscribeAuth = (listener) => { globalThis.__watchlistAuthListener = listener; };`,
  );
  source += `\n// isolated test module ${Date.now()}-${Math.random()}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const coins = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC", price: 70000, change: 2.4, marketCap: 1400, volume: 38 },
  { id: "ethereum", name: "Ethereum", symbol: "ETH", price: 3500, change: -1.2, marketCap: 420, volume: 21 },
  { id: "cardano", name: "Cardano", symbol: "ADA", price: 0.45, change: 0, marketCap: 16, volume: 0.7 },
  { id: "missing-market", name: "Missing market", symbol: "", price: null, change: null, marketCap: null, volume: null },
];

test("watchlist view helpers filter, search, sort, and summarize controlled market data", async () => {
  const { selectWatchlistCoins, summarizeWatchlist } = await loadViewHelpers();

  assert.deepEqual(selectWatchlistCoins(coins, { query: "eth" }).map(({ id }) => id), ["ethereum"]);
  assert.deepEqual(selectWatchlistCoins(coins, { filter: "gainers" }).map(({ id }) => id), ["bitcoin"]);
  assert.deepEqual(selectWatchlistCoins(coins, { filter: "losers" }).map(({ id }) => id), ["ethereum"]);
  assert.deepEqual(selectWatchlistCoins(coins, { sort: "price-desc" }).map(({ id }) => id), [
    "bitcoin", "ethereum", "cardano", "missing-market",
  ]);
  assert.deepEqual(selectWatchlistCoins(coins, { sort: "change-desc" }).map(({ id }) => id), [
    "bitcoin", "cardano", "ethereum", "missing-market",
  ]);
  assert.deepEqual(summarizeWatchlist(coins), { count: 4, gainers: 1, losers: 1 });
});

test("watchlist markup provides a semantic table, compact controls, and distinct states", () => {
  const html = read("pages/watchlist.html");

  assert.match(html, /<table class="watchlist-table">[\s\S]*?<caption class="visually-hidden">/);
  assert.match(html, /<th scope="col">Asset<\/th>/);
  assert.match(html, /<th scope="col">7d trend<\/th>/);
  assert.match(html, /<tbody id="watchlistCoins">/);
  assert.match(html, /id="watchlistSearch"[^>]+type="search"/);
  assert.match(html, /id="watchlistSort"/);
  assert.match(html, /data-watchlist-filter="gainers"[^>]+aria-pressed="false"/);
  assert.match(html, /id="emptyWatchlist"[^>]+hidden/);
  assert.match(html, /id="watchlistNoResults"[^>]+hidden/);
  assert.match(html, /id="watchlistStatus"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="watchlistCoinDetails"/);
});

test("watchlist page retains shared persistence, market stream, and chart integrations", () => {
  const page = read("js/pages/watchlist.js");
  const store = read("js/services/watchlist-store.js");

  assert.match(page, /fetch\("\/api\/markets"\)/);
  assert.match(page, /sparkline:\s*item\.sparkline_in_7d\?\.price/);
  assert.match(page, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "polyline"\)/);
  assert.match(page, /connectMarketSocket\(/);
  assert.match(page, /updateLiveChart\(update\)/);
  assert.match(page, /loadChart\(coin, selectedWatchlistTimeframe\)/);
  assert.match(page, /createFavoriteButton\(coin\)/);
  assert.doesNotMatch(page, /setInterval|setTimeout/);
  assert.match(store, /const API_URL = "\/api\/watchlist"/);
  assert.match(store, /if \(shouldWatch\) coinIds\.add\(coinId\);[\s\S]*?else coinIds\.delete\(coinId\);[\s\S]*?notify\(\)/);
  assert.match(store, /\.catch\(\(error\) => \{[\s\S]*?if \(wasWatched\) coinIds\.add\(coinId\);[\s\S]*?else coinIds\.delete\(coinId\)/);
  assert.match(store, /if \(pendingRequests\.has\(coinId\)\) return pendingRequests\.get\(coinId\)/);
});

test("watchlist store performs add/remove requests and rolls failed optimistic removal back", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => {
    global.fetch = originalFetch;
    delete global.__watchlistAuthListener;
  });
  const requests = [];
  let failNextDelete = false;
  const store = await loadWatchlistStore(async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET", body: options.body });
    if (options.method === "DELETE" && failNextDelete) throw new Error("database unavailable");
    if (!options.method) return { ok: true, json: async () => ({ watchlist: ["bitcoin"] }) };
    return { ok: true, json: async () => ({}) };
  });

  assert.equal((await store.loadWatchlist()).ok, true);
  assert.equal(store.isInWatchlist("bitcoin"), true);

  assert.equal((await store.removeFromWatchlist("bitcoin")).ok, true);
  assert.equal(store.isInWatchlist("bitcoin"), false);
  assert.equal(requests.at(-1).method, "DELETE");
  assert.equal(requests.at(-1).url, "/api/watchlist/bitcoin");

  assert.equal((await store.addToWatchlist("ethereum")).ok, true);
  assert.equal(store.isInWatchlist("ethereum"), true);
  assert.equal(requests.at(-1).method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).body), { coinId: "ethereum" });

  failNextDelete = true;
  const failed = await store.removeFromWatchlist("ethereum");
  assert.equal(failed.ok, false);
  assert.equal(store.isInWatchlist("ethereum"), true);
});

test("watchlist store blocks mutations after an unauthenticated session update", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => {
    global.fetch = originalFetch;
    delete global.__watchlistAuthListener;
  });
  let requestCount = 0;
  const store = await loadWatchlistStore(async () => {
    requestCount += 1;
    return { ok: true, json: async () => ({ watchlist: ["bitcoin"] }) };
  });
  await store.loadWatchlist();
  const requestsBeforeAuthChange = requestCount;

  global.__watchlistAuthListener({ authenticated: false, initialized: true, error: null });
  const result = await store.removeFromWatchlist("bitcoin");
  assert.equal(result.ok, false);
  assert.equal(result.signInRequired, true);
  assert.equal(requestCount, requestsBeforeAuthChange);
  assert.deepEqual(store.getWatchlist(), []);
});

test("server watchlist routes remain authenticated and scoped to the current PostgreSQL user", () => {
  const server = read("server.js");
  const db = read("server/db/watchlist.js");

  assert.match(server, /app\.get\("\/api\/watchlist", requireAuth/);
  assert.match(server, /app\.post\("\/api\/watchlist", requireAuth/);
  assert.match(server, /app\.delete\("\/api\/watchlist\/:coinId", requireAuth/);
  assert.match(server, /listWatchlistCoinIds\(req\.user\.id\)/);
  assert.match(server, /addWatchlistCoinId\(req\.user\.id, coinId\)/);
  assert.match(server, /removeWatchlistCoinId\(req\.user\.id, coinId\)/);
  assert.match(db, /WHERE user_id = \$1/);
  assert.match(db, /ON CONFLICT \(user_id, coin_id\) DO NOTHING/);
  assert.match(db, /DELETE FROM watchlist WHERE user_id = \$1 AND coin_id = \$2/);
});

test("watchlist rows expose non-color direction, accessible actions, and mobile stacking", () => {
  const page = read("js/pages/watchlist.js");
  const controls = read("js/ui/watchlist-control.js");
  const css = read("css/style.css");
  const workspace = css.slice(css.lastIndexOf("/* Watchlist monitoring workspace"));

  assert.match(page, /number > 0 \? "↑" : number < 0 \? "↓" : "•"/);
  assert.match(page, /chartButton\.setAttribute\("aria-expanded"/);
  assert.match(page, /chartButton\.setAttribute\("aria-controls", "watchlistCoinDetails"\)/);
  assert.match(controls, /button\.classList\.contains\("watchlist-remove-button"\)[\s\S]*?active \? "Remove" : "Add"/);
  assert.match(workspace, /@media \(max-width: 760px\)/);
  assert.match(workspace, /\.watchlist-table thead \{ display: none; \}/);
  assert.match(workspace, /\.watchlist-row \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(workspace, /min-height: 44px/);
  assert.match(workspace, /@media \(prefers-reduced-motion: reduce\)/);
});
