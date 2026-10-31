const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_MARKET_FEED_CONFIG,
  createAutomaticMarketScanner,
  evaluateCoinSignals,
  marketFeedConfig,
  selectEligibleMarkets,
  signalStateDecision,
} = require("../server/alerts/market-feed");
const { formatTelegramAlert } = require("../server/telegram/adapter");

const baseTime = Date.parse("2026-10-22T12:00:00.000Z");
const coin = { id: "bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, marketCap: 1_000_000, price: 102, volume: 2000 };
const history = (prices, volumes = prices.map(() => 1000), spacingMs = 5 * 60_000) => prices.map((price, index) => ({
  observed_at: new Date(baseTime - (prices.length - index) * spacingMs),
  current_price: price,
  total_volume: volumes[index],
}));

test("top-100 market selection is deterministic and rejects duplicate or malformed observations", () => {
  const markets = Array.from({ length: 105 }, (_, index) => ({
    id: `coin-${index + 1}`, name: `Coin ${index + 1}`, symbol: `c${index + 1}`,
    market_cap_rank: 105 - index, current_price: index + 1, total_volume: 1000, market_cap: 10_000 - index,
  }));
  markets.push({ ...markets[0], market_cap_rank: 1 });
  markets.push({ id: "../bad", name: "Bad", symbol: "BAD", market_cap_rank: 1, current_price: 1, market_cap: 1 });
  markets.push({ id: "nan", name: "NaN", symbol: "NAN", market_cap_rank: 1, current_price: NaN, market_cap: 1 });
  const selected = selectEligibleMarkets(markets);
  assert.equal(selected.length, 100);
  assert.deepEqual(selected.map((item) => item.rank), Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(new Set(selected.map((item) => item.id)).size, 100);
});

test("price movement detects both directions and stays quiet below threshold", () => {
  const up = evaluateCoinSignals(coin, history([100, 100, 100]), baseTime)
    .find((signal) => signal.signalType === "price_movement" && signal.direction === "up");
  assert.equal(up.active, true);
  assert.equal(up.details.changePercent, 2);
  assert.equal(up.major, false);
  const down = evaluateCoinSignals({ ...coin, price: 97 }, history([100, 100, 100]), baseTime)
    .find((signal) => signal.signalType === "price_movement" && signal.direction === "down");
  assert.equal(down.active, true);
  const quiet = evaluateCoinSignals({ ...coin, price: 101 }, history([100, 100, 100]), baseTime)
    .filter((signal) => signal.signalType === "price_movement");
  assert.equal(quiet.some((signal) => signal.active), false);
});

test("volume requires sufficient history and uses a robust median baseline", () => {
  const insufficient = evaluateCoinSignals(coin, history([100, 100, 100, 100, 100]), baseTime);
  assert.equal(insufficient.some((signal) => signal.signalType === "unusual_volume"), false);
  const enough = evaluateCoinSignals(coin, history([100, 100, 100, 100, 100, 100], [1000, 1000, 1000, 1000, 1000, 9000]), baseTime)
    .find((signal) => signal.signalType === "unusual_volume");
  assert.equal(enough.active, true);
  assert.equal(enough.details.baselineVolume, 1000);
  assert.equal(enough.details.volumeMultiple, 2);
});

test("breakouts require a valid prior range and configured buffer", () => {
  const insufficient = evaluateCoinSignals(coin, history([100, 100, 100, 100, 100]), baseTime);
  assert.equal(insufficient.some((signal) => signal.signalType === "breakout"), false);
  const breakout = evaluateCoinSignals({ ...coin, price: 101 }, history([99, 99.5, 100, 99.8, 100, 99.7]), baseTime)
    .find((signal) => signal.signalType === "breakout" && signal.direction === "up");
  assert.equal(breakout.active, true);
  assert.equal(breakout.details.priorHigh, 100);
});

test("startup and large observation gaps do not fabricate price signals", () => {
  assert.deepEqual(evaluateCoinSignals(coin, [], baseTime), []);
  const old = history([100], [1000], 60 * 60_000);
  assert.equal(evaluateCoinSignals(coin, old, baseTime, DEFAULT_MARKET_FEED_CONFIG)
    .some((signal) => signal.signalType === "price_movement"), false);
});

test("active conditions deduplicate, reset conditions re-arm, and cooldowns remain bounded", () => {
  const candidate = { valid: true, active: true, major: false, majorReason: "major_price_acceleration" };
  assert.equal(signalStateDecision(candidate, { condition_active: true }, baseTime).normalTrigger, false);
  assert.equal(signalStateDecision({ ...candidate, active: false }, { condition_active: true }, baseTime).nextNormalActive, false);
  assert.equal(signalStateDecision(candidate, {
    condition_active: false, last_triggered_at: new Date(baseTime - 5 * 60_000),
  }, baseTime).normalTrigger, false);
  assert.equal(signalStateDecision(candidate, {
    condition_active: false, last_triggered_at: new Date(baseTime - 11 * 60_000),
  }, baseTime).normalTrigger, true);
});

test("major escalation bypasses normal cooldown exactly once", () => {
  const major = { valid: true, active: true, major: true, majorReason: "major_price_acceleration" };
  const escalating = signalStateDecision(major, {
    condition_active: true,
    major_condition_active: false,
    last_triggered_at: new Date(baseTime - 60_000),
  }, baseTime);
  assert.equal(escalating.normalTrigger, false);
  assert.equal(escalating.majorTrigger, true);
  assert.equal(escalating.overrideReason.code, "normal_to_major_escalation");
  const repeated = signalStateDecision(major, {
    condition_active: true,
    major_condition_active: true,
    last_triggered_at: new Date(baseTime - 60_000),
    last_major_triggered_at: new Date(baseTime),
  }, baseTime);
  assert.equal(repeated.majorTrigger, false);
});

test("emergency cooldown suppresses equivalent major events but releases a reset event", () => {
  const major = { valid: true, active: true, major: true, majorReason: "major_volume_acceleration" };
  const duringCooldown = signalStateDecision(major, {
    condition_active: false,
    major_condition_active: false,
    last_major_triggered_at: new Date(baseTime - 60_000),
  }, baseTime);
  assert.equal(duringCooldown.majorTrigger, false);
  assert.equal(duringCooldown.nextMajorActive, false);
  const afterCooldown = signalStateDecision(major, {
    condition_active: false,
    major_condition_active: false,
    last_major_triggered_at: new Date(baseTime - 3 * 60_000),
  }, baseTime);
  assert.equal(afterCooldown.majorTrigger, true);
  const reset = signalStateDecision({ ...major, active: false, major: false }, {
    condition_active: true, major_condition_active: true,
  }, baseTime);
  assert.equal(reset.nextMajorActive, false);
});

test("scanner records one logical event and queues only independently eligible recipients", async () => {
  let duplicate = false;
  let eventNumber = 0;
  const queued = [];
  const prior = history([100, 100, 100, 100, 100, 100]);
  const client = {
    async query(sql, params = []) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO market_signal_observations")) {
        if (duplicate) return { rows: [], rowCount: 0 };
        duplicate = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM market_signal_observations WHERE")) {
        return { rows: prior.map((row) => ({ coin_id: "bitcoin", ...row })), rowCount: prior.length };
      }
      if (sql.startsWith("SELECT coin_id, signal_type")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("INSERT INTO market_signal_states")) return { rows: [], rowCount: 5 };
      if (sql.startsWith("INSERT INTO market_signal_events")) {
        eventNumber += 1;
        return { rows: [{ id: `event-${eventNumber}` }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT p.user_id")) {
        return params[0] === "market_price_movements"
          ? { rows: [{ user_id: "enabled-user", telegram_link_id: "link-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("INSERT INTO notifications")) return { rows: [{ id: `notification-${eventNumber}` }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO telegram_deliveries")) { queued.push(params); return { rows: [], rowCount: 1 }; }
      if (sql.startsWith("DELETE FROM market_signal_observations")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected scanner query: ${sql}`);
    },
    release() {},
  };
  const scanner = createAutomaticMarketScanner({ database: { connect: async () => client }, now: () => baseTime });
  const snapshot = {
    markets: [{ id: "bitcoin", name: "Bitcoin", symbol: "btc", market_cap_rank: 1, current_price: 103, total_volume: 2500, market_cap: 1_000_000 }],
    observedAt: baseTime,
  };
  const first = await scanner(snapshot);
  assert.equal(first.status, "completed");
  assert.equal(first.detected, 3);
  assert.equal(first.major, 2);
  assert.equal(first.queued, 1);
  assert.equal(queued.length, 1);
  assert.deepEqual(await scanner(snapshot), { status: "skipped_duplicate", observed: 0, detected: 0, major: 0, queued: 0 });
});

test("database advisory locking prevents concurrent scanners from enqueueing the same market event", async () => {
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: false }], rowCount: 1 };
      throw new Error(`Unexpected query after lock rejection: ${sql}`);
    },
    release() {},
  };
  const scanner = createAutomaticMarketScanner({ database: { connect: async () => client }, now: () => baseTime });
  const result = await scanner({
    markets: [{ id: "bitcoin", name: "Bitcoin", symbol: "btc", market_cap_rank: 1, current_price: 100, total_volume: 1000, market_cap: 1_000_000 }],
    observedAt: baseTime,
  });
  assert.deepEqual(result, { status: "skipped_concurrent", observed: 0, detected: 0, major: 0, queued: 0 });
});

test("automatic feed Telegram messages are concise plain text with attribution", () => {
  const text = formatTelegramAlert({
    source: "automatic_market_feed", coinSymbol: "BTC", coinId: "bitcoin",
    alertType: "price_movement", direction: "down", currentPrice: 84_180.9,
    observedValue: 84_180.9, changePercent: -2.4, windowMinutes: 5,
    appBaseUrl: "https://coindash.example",
  });
  assert.match(text, /BTC — Price moved down 2\.40% in 5 minutes/);
  assert.match(text, /CoinDash Market Feed/);
  assert.match(text, /not financial advice/);
  assert.ok(text.length <= 4096);
});

test("major Telegram messages expose measured severity, timestamp, and override reason", () => {
  const text = formatTelegramAlert({
    source: "automatic_market_feed", severityClass: "major",
    overrideReason: { code: "normal_to_major_escalation", priorClass: "normal" },
    coinSymbol: "BTC", coinId: "bitcoin", alertType: "price_movement", direction: "up",
    currentPrice: 84_180.9, observedValue: 84_180.9, changePercent: 3.2, windowMinutes: 5,
    observedAt: "2026-10-22T12:00:00.000Z",
  });
  assert.match(text, /🚨 CoinDash MAJOR MOVE/);
  assert.match(text, /BTC moved 3\.20% up in 5 minutes/);
  assert.match(text, /2026-10-22T12:00:00\.000Z/);
  assert.match(text, /ordinary signal escalated to major severity/);
});

test("adaptive defaults match the supported five-minute observation policy", () => {
  assert.equal(DEFAULT_MARKET_FEED_CONFIG.priceWindowMs, 5 * 60_000);
  assert.equal(DEFAULT_MARKET_FEED_CONFIG.priceThresholdPercent, 1.5);
  assert.equal(DEFAULT_MARKET_FEED_CONFIG.majorPriceThresholdPercent, 3);
  assert.equal(DEFAULT_MARKET_FEED_CONFIG.volumeMultiplier, 2);
  assert.equal(DEFAULT_MARKET_FEED_CONFIG.majorVolumeMultiplier, 4);
  assert.equal(DEFAULT_MARKET_FEED_CONFIG.normalCooldownMs, 10 * 60_000);
  assert.equal(DEFAULT_MARKET_FEED_CONFIG.emergencyCooldownMs, 2 * 60_000);
});

test("configuration rejects an unsupported sub-five-minute window and keeps major thresholds above normal", () => {
  const config = marketFeedConfig({
    MARKET_FEED_PRICE_WINDOW_MINUTES: "1",
    MARKET_FEED_PRICE_THRESHOLD_PERCENT: "5",
    MARKET_FEED_MAJOR_PRICE_THRESHOLD_PERCENT: "3",
    MARKET_FEED_VOLUME_MULTIPLIER: "5",
    MARKET_FEED_MAJOR_VOLUME_MULTIPLIER: "4",
  });
  assert.equal(config.priceWindowMs, 5 * 60_000);
  assert.equal(config.majorPriceThresholdPercent, 5);
  assert.equal(config.majorVolumeMultiplier, 5);
});

test("Signals exposes three distinct opt-in controls wired to the preferences API", () => {
  const root = path.join(__dirname, "..");
  const html = readFileSync(path.join(root, "pages/signals.html"), "utf8");
  const script = readFileSync(path.join(root, "js/pages/signals.js"), "utf8");
  for (const name of ["marketPriceMovements", "marketUnusualVolume", "marketBreakouts"]) {
    assert.match(html, new RegExp(`name="${name}"`));
    assert.match(script, new RegExp(`${name}: marketFeedForm\\.elements\\.${name}\\.checked`));
  }
  assert.match(script, /api\("\/api\/preferences", json\("PUT"/);
});

test("fresh cache updates trigger evaluation and retain the scheduler fallback without a new poller", () => {
  const source = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const refreshBody = source.slice(source.indexOf("async function refreshMarketData"), source.indexOf('app.get("/api/markets"'));
  const schedulerBody = source.slice(source.indexOf("const alertScheduler"), source.indexOf("const currentTelegramConfig"));
  assert.match(refreshBody, /evaluateFreshMarketSnapshot/);
  assert.match(schedulerBody, /evaluateFreshMarketSnapshot/);
  assert.match(source, /let marketRefreshPromise = null/);
  assert.equal((source.match(/setInterval\(/g) || []).length, 1); // Existing WebSocket broadcast; scheduler owns the bounded fallback timer.
});
