const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { normalizeTrendingPayload } = require("../server/trending-data");

const clientModule = import(pathToFileURL(path.join(__dirname, "../js/pages/trending-data.mjs")));

test("trending API normalization preserves provider rank order and zero values", () => {
  const payload = {
    coins: [
      { item: { id: "second", name: "Second", symbol: "S", score: 1, data: { price: 2, price_change_percentage_24h: { usd: 0 }, market_cap: "$2,000", total_volume: "$0" } } },
      { item: { id: "first", name: "First", symbol: "F", score: 0, data: { price: 1, price_change_percentage_24h: { usd: 5 }, market_cap: "$1,000", total_volume: "$100" } } },
      { item: { id: "unranked", name: "Unranked", symbol: "U", score: null, data: {} } },
    ],
    categories: [{ id: 4, name: "Layer 1", coins_count: "25", market_cap_1h_change: 0 }],
  };
  const normalized = normalizeTrendingPayload(payload);
  assert.deepEqual(normalized.coins.map((coin) => coin.id), ["first", "second", "unranked"]);
  assert.deepEqual(normalized.coins.map((coin) => coin.trendingRank), [1, 2, null]);
  assert.equal(normalized.coins[1].change24h, 0);
  assert.equal(normalized.coins[1].volume24h, 0);
  assert.equal(normalized.categories[0].coinCount, 25);
  assert.equal(normalized.categories[0].marketCapChange1h, 0);
});

test("trending normalization rejects malformed entries and preserves missing market fields", () => {
  const normalized = normalizeTrendingPayload({
    coins: [null, {}, { item: { id: "valid", name: "Valid", score: "bad", data: { price: "n/a" } } }],
    categories: [null, { name: "" }, { name: "AI", coins_count: "unknown" }],
  });
  assert.equal(normalized.coins.length, 1);
  assert.equal(normalized.coins[0].trendingRank, null);
  assert.equal(normalized.coins[0].price, null);
  assert.equal(normalized.coins[0].change24h, null);
  assert.equal(normalized.categories.length, 1);
  assert.equal(normalized.categories[0].coinCount, null);
});

test("client payload normalization sorts ranked coins and keeps missing values distinct from zero", async () => {
  const { normalizeTrendingApiPayload } = await clientModule;
  const normalized = normalizeTrendingApiPayload({
    coins: [
      { id: "missing", trendingRank: null, price: null, change24h: null, providerOrder: 1 },
      { id: "ranked", trendingRank: 1, price: 0, change24h: 0, providerOrder: 2 },
    ],
    meta: { status: "cached", fetchedAt: "2026-10-22T10:00:00.000Z", ageMs: 1000 },
  });
  assert.deepEqual(normalized.coins.map((coin) => coin.id), ["ranked", "missing"]);
  assert.equal(normalized.coins[0].price, 0);
  assert.equal(normalized.coins[0].change24h, 0);
  assert.equal(normalized.coins[1].price, null);
  assert.equal(normalized.meta.status, "cached");
});

test("rank changes use explicit observations and distinguish improvement, decline, new, and exited coins", async () => {
  const { calculateRankChanges, createTrendingSnapshot, isTrendingSnapshotUsable } = await clientModule;
  const previous = createTrendingSnapshot(
    [{ id: "a", trendingRank: 3 }, { id: "b", trendingRank: 1 }, { id: "gone", trendingRank: 2 }],
    "2026-10-22T09:00:00.000Z",
    new Date("2026-10-22T09:01:00.000Z"),
  );
  assert.equal(isTrendingSnapshotUsable(previous, "2026-10-22T10:00:00.000Z", new Date("2026-10-22T10:01:00.000Z")), true);
  assert.equal(isTrendingSnapshotUsable(previous, "2026-10-22T09:00:00.000Z", new Date("2026-10-22T10:01:00.000Z")), false);
  const result = calculateRankChanges(
    [{ id: "a", trendingRank: 1 }, { id: "b", trendingRank: 3 }, { id: "new", trendingRank: 2 }],
    previous,
  );
  assert.deepEqual(result.counts, { rising: 1, stable: 0, cooling: 1 });
  assert.equal(result.newCount, 1);
  assert.equal(result.exitedCount, 1);
  assert.equal(result.movements.find((coin) => coin.id === "a").rankMovement, 2);
  assert.equal(result.movements.find((coin) => coin.id === "b").rankMovement, -2);
});

test("category filtering handles all, exact, unknown, and malformed category inputs", async () => {
  const { filterTrendingCategories } = await clientModule;
  const categories = [{ id: "l1", name: "Layer 1" }, { id: "ai", name: "AI" }];
  assert.equal(filterTrendingCategories(categories, "all").length, 2);
  assert.deepEqual(filterTrendingCategories(categories, "ai"), [{ id: "ai", name: "AI" }]);
  assert.deepEqual(filterTrendingCategories(categories, "unknown"), []);
  assert.deepEqual(filterTrendingCategories(null, "all"), []);
});

test("stale response guard accepts only the active trending request", async () => {
  const { shouldApplyTrendingResponse } = await clientModule;
  assert.equal(shouldApplyTrendingResponse(4, 4), true);
  assert.equal(shouldApplyTrendingResponse(3, 4), false);
});

test("trending rows retain the shared authenticated watchlist integration", () => {
  const source = readFileSync(path.join(__dirname, "../js/pages/trending.js"), "utf8");
  assert.match(source, /createFavoriteButton\(coin\)/);
  assert.match(source, /watchlist-favorite/);
});
