const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS,
  MIN_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS,
  cancelExpiredTelegramDeliveries,
  configuredIntervalMs,
  createTelegramExpiryMaintenance,
  reconcileTelegramNotificationStatuses,
} = require("../server/telegram/maintenance");
const { createTelegramWorker } = require("../server/telegram/worker");

test("expiry cleanup cancels only expired queued or retry deliveries and synchronizes notifications", async () => {
  let statement = "";
  const result = await cancelExpiredTelegramDeliveries({
    async query(sql) {
      statement = sql;
      return { rowCount: 2, rows: [{ id: "notification-1" }, { id: "notification-2" }] };
    },
  });

  assert.equal(result.rowCount, 2);
  assert.match(statement, /pg_try_advisory_xact_lock\(hashtext\('cointrack\.telegram_expiry_cleanup'\)\)/);
  assert.match(statement, /maintenance_lock\.acquired/);
  assert.match(statement, /expired AS \(/);
  assert.match(statement, /UPDATE telegram_deliveries d SET status = 'cancelled'/);
  assert.match(statement, /d\.status IN \('queued', 'retry'\)/);
  assert.match(statement, /payload \? 'expiresAt'/);
  assert.match(statement, /payload->>'expiresAt'\)::timestamptz <= CURRENT_TIMESTAMP/);
  assert.match(statement, /locked_at = NULL, locked_by = NULL/);
  assert.match(statement, /last_error_code = 'expired_market_signal'/);
  assert.match(statement, /updated_at = CURRENT_TIMESTAMP/);
  assert.match(statement, /jsonb_set\(notification\.payload, '\{delivery,telegram\}', to_jsonb\(expired\.status\), TRUE\)/);
  assert.doesNotMatch(statement, /status = 'processing'|next_attempt_at|locked_by = \$|send_started_at|chat_id/);
});

test("expiry cleanup SQL leaves unexpired and non-queued deliveries unchanged", async () => {
  const state = [
    { status: "queued", expiresAt: "2026-01-01T00:00:00Z" },
    { status: "retry", expiresAt: "2026-01-01T00:00:00Z" },
    { status: "queued", expiresAt: "2027-01-01T00:00:00Z" },
    { status: "processing", expiresAt: "2026-01-01T00:00:00Z" },
    { status: "sent", expiresAt: "2026-01-01T00:00:00Z" },
    { status: "retry" },
  ];
  const now = new Date("2026-10-25T00:00:00Z");
  const database = {
    async query() {
      let cancelled = 0;
      for (const delivery of state) {
        if (!["queued", "retry"].includes(delivery.status) || !delivery.expiresAt
            || new Date(delivery.expiresAt) > now) continue;
        delivery.status = "cancelled";
        delivery.locked_at = null;
        delivery.locked_by = null;
        delivery.last_error_code = "expired_market_signal";
        delivery.notificationStatus = delivery.status;
        cancelled += 1;
      }
      return { rowCount: cancelled, rows: [] };
    },
  };

  const maintenance = createTelegramExpiryMaintenance({ database });
  assert.deepEqual(await maintenance.runOnce(), { status: "completed", cancelled: 2 });
  assert.deepEqual(state.map(({ status }) => status), ["cancelled", "cancelled", "queued", "processing", "sent", "retry"]);
  assert.equal(state[0].notificationStatus, "cancelled");
  assert.equal(state[1].notificationStatus, "cancelled");
});

test("notification reconciliation repairs terminal status mismatches only", async () => {
  let statement = "";
  const result = await reconcileTelegramNotificationStatuses({
    async query(sql) {
      statement = sql;
      return { rowCount: 3, rows: [] };
    },
  });

  assert.equal(result.rowCount, 3);
  assert.match(statement, /UPDATE notifications n SET/);
  assert.match(statement, /jsonb_set\(n\.payload, '\{delivery,telegram\}', to_jsonb\(d\.status\), TRUE\)/);
  assert.match(statement, /d\.status IN \('sent', 'failed', 'cancelled', 'ambiguous'\)/);
  assert.match(statement, /n\.payload #>> '\{delivery,telegram\}' IS DISTINCT FROM d\.status/);
  assert.doesNotMatch(statement, /UPDATE telegram_deliveries|WITH rate_lock AS|send_started_at|chat_id/);
});

test("maintenance remains active while delivery is disabled and cannot claim or send", async (t) => {
  const previous = process.env.TELEGRAM_WORKER_DISABLED;
  t.after(() => {
    if (previous === undefined) delete process.env.TELEGRAM_WORKER_DISABLED;
    else process.env.TELEGRAM_WORKER_DISABLED = previous;
  });
  process.env.TELEGRAM_WORKER_DISABLED = "true";

  let scheduledMaintenance;
  let queries = 0;
  const maintenance = createTelegramExpiryMaintenance({
    database: { async query(sql) {
      queries += 1;
      assert.doesNotMatch(sql, /WITH rate_lock AS|status = 'processing'|send_started_at|chat_id/);
      return { rowCount: 0, rows: [] };
    } },
    setIntervalFn(callback) { scheduledMaintenance = callback; return { unref() {} }; },
  });
  const worker = createTelegramWorker({ enabled: process.env.TELEGRAM_WORKER_DISABLED !== "true", setIntervalFn: assert.fail });

  assert.equal(worker.start(), false);
  assert.equal(maintenance.start(), true);
  assert.equal(typeof scheduledMaintenance, "function");
  scheduledMaintenance();
  await maintenance.whenIdle();
  assert.equal(queries, 2);
});

test("maintenance prevents overlapping cleanup runs", async () => {
  let release;
  let queries = 0;

  const maintenance = createTelegramExpiryMaintenance({
    database: {
      query: async () => {
        queries += 1;

        if (queries === 1) {
          return new Promise((resolve) => {
            release = () => resolve({ rowCount: 1, rows: [] });
          });
        }

        return { rowCount: 0, rows: [] };
      },
    },
  });

  const first = maintenance.runOnce();
  assert.deepEqual(await maintenance.runOnce(), {
    status: "skipped_overlap",
    cancelled: 0,
  });

  assert.equal(typeof release, "function");
  release();

  assert.deepEqual(await first, { status: "completed", cancelled: 1 });
  assert.equal(queries, 2);
});

test("maintenance timer stops cleanly and database errors are contained", async () => {
  let scheduled;
  let cleared = 0;
  let errors = 0;
  const timer = { unref() {} };
  const maintenance = createTelegramExpiryMaintenance({
    database: { async query() { throw new Error("controlled database outage"); } },
    setIntervalFn(callback, intervalMs) {
      scheduled = callback;
      assert.equal(intervalMs, DEFAULT_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS);
      return timer;
    },
    clearIntervalFn(value) { assert.equal(value, timer); cleared += 1; },
    onError(error) { assert.equal(error.message, "controlled database outage"); errors += 1; },
  });

  assert.equal(maintenance.start(), true);
  assert.equal(maintenance.start(), false);
  assert.equal(scheduled(), undefined);
  await maintenance.whenIdle();
  assert.equal(errors, 1);
  assert.equal(maintenance.stop(), true);
  assert.equal(maintenance.stop(), false);
  assert.equal(cleared, 1);
});

test("maintenance recovers after a database error", async () => {
  let queries = 0;
  const errors = [];
  const maintenance = createTelegramExpiryMaintenance({
    database: {
      async query() {
        queries += 1;
        if (queries === 1) throw new Error("temporary database outage");
        return { rowCount: 0, rows: [] };
      },
    },
    onError(error) {
      errors.push(error.message);
    },
  });

  assert.deepEqual(await maintenance.runOnce(), {
    status: "error",
    cancelled: 0,
  });
  assert.deepEqual(errors, ["temporary database outage"]);

  assert.deepEqual(await maintenance.runOnce(), {
    status: "completed",
    cancelled: 0,
  });
  assert.equal(queries, 3);
  assert.deepEqual(errors, ["temporary database outage"]);
});

test("maintenance interval configuration is bounded and server lifecycle is independent", () => {
  assert.equal(configuredIntervalMs("10000"), MIN_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS);
  assert.equal(configuredIntervalMs("9999"), DEFAULT_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS);
  assert.equal(configuredIntervalMs("invalid"), DEFAULT_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS);

  const server = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /telegramExpiryMaintenance\.start\(\);/);
  assert.doesNotMatch(server, /if \([^\n]*workerDisabled[^\n]*\) telegramExpiryMaintenance\.start/);
  assert.match(server, /telegramExpiryMaintenance\.stop\(\);/);
  assert.match(server, /telegramExpiryMaintenance\.whenIdle\(\)/);
});
