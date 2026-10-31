const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMarketAlertEvaluator,
  evaluateAlertState,
  isMarketSnapshotFresh,
  marketValueForAlert,
} = require("../server/alerts/evaluator");
const { createAlertScheduler } = require("../server/alerts/scheduler");
const {
  isValidAlertId,
  isValidThreshold,
  validateAlertPatch,
  validateNewAlert,
} = require("../server/alerts/validation");

function makeDatabase(alerts) {
  const notifications = [];
  const deliveryUpdates = [];
  const database = {
    notifications,
    deliveryUpdates,
    async query(sql, params) {
      if (sql.includes("FROM market_alerts a")) return { rows: alerts.map((alert) => ({ ...alert })) };
      if (sql.startsWith("UPDATE notifications")) {
        deliveryUpdates.push({ id: params[0], status: params[1], userId: params[2] });
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          if (sql.includes("FOR UPDATE")) {
            const alert = alerts.find((candidate) => candidate.id === params[0] && candidate.enabled !== false);
            return { rows: alert ? [{ condition_active: alert.condition_active, last_evaluated_at: alert.last_evaluated_at }] : [] };
          }
          if (sql.includes("UPDATE market_alerts SET condition_active = TRUE")) {
            const alert = alerts.find((candidate) => candidate.id === params[0]);
            Object.assign(alert, {
              condition_active: true,
              last_triggered_at: params[1],
              last_observed_value: params[2],
              last_evaluated_at: params[1],
            });
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("UPDATE market_alerts SET condition_active = $2")) {
            const alert = alerts.find((candidate) => candidate.id === params[0]);
            Object.assign(alert, {
              condition_active: params[1],
              last_observed_value: params[2],
              last_evaluated_at: params[3],
            });
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("INSERT INTO notifications")) {
            const notification = { id: `notification-${notifications.length + 1}`, params };
            notifications.push(notification);
            return { rows: [{ id: notification.id }] };
          }
          throw new Error(`Unexpected client query: ${sql}`);
        },
        release() {},
      };
    },
  };
  return database;
}

function alert(overrides = {}) {
  return {
    id: "alert-1",
    user_id: "user-1",
    coin_id: "bitcoin",
    alert_type: "price",
    direction: "above",
    threshold: "100",
    enabled: true,
    condition_active: false,
    last_evaluated_at: null,
    email: "safe@example.test",
    notification_preferences: { email_alerts: false },
    ...overrides,
  };
}

test("new rules establish a baseline before threshold crossings can trigger", () => {
  assert.deepEqual(
    evaluateAlertState(alert(), 150),
    { isMet: true, transition: "initialize" },
  );
  assert.deepEqual(
    evaluateAlertState(alert({ last_evaluated_at: new Date(), condition_active: false }), 150),
    { isMet: true, transition: "trigger" },
  );
});

test("market snapshots enforce a two-minute freshness boundary and limited future skew", () => {
  const now = Date.parse("2026-10-22T12:00:00.000Z");
  assert.equal(isMarketSnapshotFresh(now - 120_000, now), true);
  assert.equal(isMarketSnapshotFresh(now - 120_001, now), false);
  assert.equal(isMarketSnapshotFresh(now + 30_001, now), false);
  assert.equal(isMarketSnapshotFresh("invalid", now), false);
});

test("price and 24-hour percentage values reject missing or malformed provider data", () => {
  assert.equal(marketValueForAlert(alert(), { current_price: 102.5 }), 102.5);
  assert.equal(marketValueForAlert(alert(), { current_price: null }), null);
  assert.equal(marketValueForAlert(alert(), { current_price: "bad" }), null);
  assert.equal(
    marketValueForAlert(alert({ alert_type: "percentage" }), { price_change_percentage_24h: -4.2 }),
    -4.2,
  );
});

test("evaluator persists baseline, triggers once, rearms, and can trigger again", async () => {
  const rule = alert();
  const database = makeDatabase([rule]);
  let now = Date.parse("2026-10-22T12:00:00.000Z");
  const evaluate = createMarketAlertEvaluator({ database, now: () => now });
  const snapshot = (price) => ({ markets: [{ id: "bitcoin", name: "Bitcoin", current_price: price }], observedAt: now });

  assert.equal((await evaluate(snapshot(90))).triggered, 0);
  now += 60_000;
  assert.equal((await evaluate(snapshot(110))).triggered, 1);
  now += 60_000;
  assert.equal((await evaluate(snapshot(120))).triggered, 0);
  now += 60_000;
  assert.equal((await evaluate(snapshot(95))).rearmed, 1);
  now += 60_000;
  assert.equal((await evaluate(snapshot(105))).triggered, 1);
  assert.equal(database.notifications.length, 2);
});

test("stale data and missing coins do not change alert state", async () => {
  const rule = alert();
  const database = makeDatabase([rule]);
  const now = Date.parse("2026-10-22T12:00:00.000Z");
  const evaluate = createMarketAlertEvaluator({ database, now: () => now });
  const stale = await evaluate({
    markets: [{ id: "bitcoin", name: "Bitcoin", current_price: 120 }],
    observedAt: now - 120_001,
  });
  assert.equal(stale.status, "skipped_stale");
  assert.equal(rule.last_evaluated_at, null);
  const missing = await evaluate({ markets: [{ id: "ethereum", current_price: 50 }], observedAt: now });
  assert.equal(missing.skipped, 1);
  assert.equal(rule.last_evaluated_at, null);
});

test("email failures retain the in-app event and record failed delivery", async () => {
  const rule = alert({
    condition_active: false,
    last_evaluated_at: new Date("2026-10-22T11:59:00.000Z"),
    notification_preferences: { email_alerts: true },
  });
  const database = makeDatabase([rule]);
  const now = Date.parse("2026-10-22T12:00:00.000Z");
  const evaluate = createMarketAlertEvaluator({
    database,
    now: () => now,
    deliverEmail: async () => { throw new Error("mock delivery failure"); },
  });
  const result = await evaluate({
    markets: [{ id: "bitcoin", name: "Bitcoin", current_price: 120 }],
    observedAt: now,
  });
  assert.equal(result.triggered, 1);
  assert.equal(database.notifications.length, 1);
  assert.equal(database.deliveryUpdates[0].status, "failed");
});

test("malformed alert requests and IDs are rejected before database access", () => {
  assert.equal(validateNewAlert({ coinId: "bitcoin", alertType: "price", direction: "above", threshold: 10 }), true);
  assert.equal(validateNewAlert({ coinId: "../bitcoin", alertType: "price", direction: "above", threshold: 10 }), false);
  assert.equal(isValidThreshold("price", 0), false);
  assert.equal(isValidThreshold("percentage", -101), false);
  assert.equal(validateAlertPatch({ enabled: false }), true);
  assert.equal(validateAlertPatch({ userId: "another-user" }), false);
  assert.equal(isValidAlertId("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isValidAlertId("------------------------------------"), false);
});

test("scheduler prevents overlap, survives errors, and releases its lock", async () => {
  let resolveFirst;
  let calls = 0;
  const scheduler = createAlertScheduler({
    runCycle: async () => {
      calls += 1;
      if (calls === 1) await new Promise((resolve) => { resolveFirst = resolve; });
      if (calls === 2) throw new Error("controlled provider failure");
      return { status: "completed" };
    },
  });

  const first = scheduler.runOnce();
  assert.equal((await scheduler.runOnce()).status, "skipped_overlap");
  resolveFirst();
  assert.equal((await first).status, "completed");
  assert.equal((await scheduler.runOnce()).status, "error");
  assert.equal((await scheduler.runOnce()).status, "completed");
});

test("scheduler start and stop are idempotent and clean up its timer", () => {
  let created = 0;
  let cleared = 0;
  const timer = { unref() {} };
  const scheduler = createAlertScheduler({
    runCycle: async () => {},
    setIntervalFn: () => { created += 1; return timer; },
    clearIntervalFn: (value) => { assert.equal(value, timer); cleared += 1; },
  });
  assert.equal(scheduler.start(), true);
  assert.equal(scheduler.start(), false);
  assert.equal(created, 1);
  assert.equal(scheduler.stop(), true);
  assert.equal(scheduler.stop(), false);
  assert.equal(cleared, 1);
});
