const { pool } = require("../db/pool");

const DEFAULT_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS = 60_000;
const MIN_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS = 10_000;

function configuredIntervalMs(value = process.env.TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= MIN_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS
    ? parsed
    : DEFAULT_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS;
}

async function cancelExpiredTelegramDeliveries(database = pool) {
  return database.query(
    `WITH maintenance_lock AS (
       SELECT pg_try_advisory_xact_lock(hashtext('cointrack.telegram_expiry_cleanup')) AS acquired
     ), expired AS (
       UPDATE telegram_deliveries d SET status = 'cancelled', locked_at = NULL, locked_by = NULL,
         last_error_code = 'expired_market_signal', updated_at = CURRENT_TIMESTAMP
       FROM notifications source_notification, maintenance_lock
       WHERE source_notification.id = d.notification_id
         AND maintenance_lock.acquired
         AND d.status IN ('queued', 'retry')
         AND source_notification.payload ? 'expiresAt'
         AND (source_notification.payload->>'expiresAt')::timestamptz <= CURRENT_TIMESTAMP
       RETURNING d.notification_id, d.status
     )
     UPDATE notifications notification SET
       payload = jsonb_set(notification.payload, '{delivery,telegram}', to_jsonb(expired.status), TRUE)
     FROM expired WHERE notification.id = expired.notification_id
     RETURNING notification.id`,
  );
}

async function reconcileTelegramNotificationStatuses(database = pool) {
  return database.query(
    `UPDATE notifications n SET
       payload = jsonb_set(n.payload, '{delivery,telegram}', to_jsonb(d.status), TRUE)
     FROM telegram_deliveries d
     WHERE d.notification_id = n.id
       AND d.status IN ('sent', 'failed', 'cancelled', 'ambiguous')
       AND n.payload #>> '{delivery,telegram}' IS DISTINCT FROM d.status`,
  );
}

function createTelegramExpiryMaintenance({
  database = pool,
  intervalMs = configuredIntervalMs(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = (error) => {
    const message = String(error?.message || "Unknown error")
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 300);
    console.error("Telegram expiry maintenance cycle failed:", message);
  },
} = {}) {
  let timer = null;
  let running = false;
  const idleWaiters = new Set();

  function finishRun() {
    running = false;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  async function runOnce() {
    if (running) return { status: "skipped_overlap", cancelled: 0 };
    running = true;
    try {
      const result = await cancelExpiredTelegramDeliveries(database);
      await reconcileTelegramNotificationStatuses(database);
      return { status: "completed", cancelled: result.rowCount };
    } catch (error) {
      onError(error);
      return { status: "error", cancelled: 0 };
    } finally {
      finishRun();
    }
  }

  function start() {
    if (timer) return false;
    timer = setIntervalFn(() => { void runOnce(); }, intervalMs);
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearIntervalFn(timer);
    timer = null;
    return true;
  }

  function whenIdle() {
    if (!running) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  }

  return { runOnce, start, stop, whenIdle };
}

module.exports = {
  DEFAULT_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS,
  MIN_TELEGRAM_EXPIRY_CLEANUP_INTERVAL_MS,
  cancelExpiredTelegramDeliveries,
  configuredIntervalMs,
  createTelegramExpiryMaintenance,
  reconcileTelegramNotificationStatuses,
};
