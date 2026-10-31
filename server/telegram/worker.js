const { randomUUID } = require("node:crypto");
const { pool } = require("../db/pool");
const { formatTelegramAlert, sendTelegramMessage } = require("./adapter");

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
const DEFAULT_MARKET_DELIVERY_WINDOW_MS = 10 * 60_000;
const DEFAULT_GLOBAL_MARKET_DELIVERY_LIMIT = 20;
const DEFAULT_USER_MARKET_DELIVERY_LIMIT = 5;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function retryDelayMs(attempt, retryAfterSeconds) {
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return Math.min(retryAfterSeconds * 1000, 3_600_000);
  return BACKOFF_MS[Math.min(Math.max(attempt - 1, 0), BACKOFF_MS.length - 1)];
}

function createTelegramWorker({
  database = pool,
  deliver = sendTelegramMessage,
  intervalMs = 10_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date(),
  marketDeliveryWindowMs = positiveInteger(process.env.MARKET_FEED_DELIVERY_RATE_WINDOW_MINUTES, 10) * 60_000,
  globalMarketDeliveryLimit = positiveInteger(process.env.MARKET_FEED_GLOBAL_DELIVERY_LIMIT, DEFAULT_GLOBAL_MARKET_DELIVERY_LIMIT),
  userMarketDeliveryLimit = positiveInteger(process.env.MARKET_FEED_USER_DELIVERY_LIMIT, DEFAULT_USER_MARKET_DELIVERY_LIMIT),
  enabled = process.env.TELEGRAM_WORKER_DISABLED !== "true",
  onError = () => console.error("Telegram delivery worker cycle failed."),
} = {}) {
  const workerId = randomUUID();
  let timer = null;
  let running = false;
  let lastCycleAt = null;
  let lastCycleStatus = "never_run";
  const idleWaiters = new Set();

  function finishCycle() {
    running = false;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  async function updateNotification(notificationId, status) {
    await database.query(
      `UPDATE notifications SET payload = jsonb_set(payload, '{delivery,telegram}', to_jsonb($2::text), TRUE)
       WHERE id = $1`,
      [notificationId, status],
    );
  }

  async function markCancelled(job) {
    await database.query(
      `UPDATE telegram_deliveries SET status = 'cancelled', locked_at = NULL, locked_by = NULL,
       last_error_code = 'link_or_preference_removed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [job.id],
    );
    await updateNotification(job.notification_id, "cancelled");
  }

  async function runOnce() {
    if (running) return { status: "skipped_overlap", processed: 0 };
    running = true;
    lastCycleAt = now();
    try {
      await database.query(
        `UPDATE telegram_deliveries SET status = 'retry', locked_at = NULL, locked_by = NULL,
           next_attempt_at = CURRENT_TIMESTAMP, last_error_code = 'worker_interrupted', updated_at = CURRENT_TIMESTAMP
         WHERE status = 'processing' AND send_started_at IS NULL
           AND locked_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'`,
      );
      await database.query(
        `UPDATE telegram_deliveries SET status = 'ambiguous', locked_at = NULL, locked_by = NULL,
           last_error_code = 'delivery_outcome_unknown', updated_at = CURRENT_TIMESTAMP
         WHERE status = 'processing' AND send_started_at IS NOT NULL
           AND locked_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'`,
      );
      await database.query(
        `UPDATE telegram_deliveries d SET status = 'cancelled', locked_at = NULL, locked_by = NULL,
           last_error_code = 'link_or_preference_removed', updated_at = CURRENT_TIMESTAMP
         FROM notifications n
         WHERE n.id = d.notification_id AND d.status IN ('queued', 'retry')
           AND n.payload ? 'preferenceKey'
           AND (NOT EXISTS (
               SELECT 1 FROM user_preferences p WHERE p.user_id = d.user_id
                 AND COALESCE((p.notification_preferences->>'telegram_alerts')::boolean, FALSE) = TRUE
                 AND COALESCE((p.notification_preferences->>(n.payload->>'preferenceKey'))::boolean, FALSE) = TRUE)
             OR NOT EXISTS (SELECT 1 FROM telegram_links l WHERE l.id = d.telegram_link_id AND l.user_id = d.user_id))`,
      );
      await database.query(
        `UPDATE notifications n SET payload = jsonb_set(n.payload, '{delivery,telegram}', to_jsonb(d.status), TRUE)
         FROM telegram_deliveries d WHERE d.notification_id = n.id
           AND d.status IN ('sent', 'failed', 'cancelled', 'ambiguous')
           AND n.payload #>> '{delivery,telegram}' IS DISTINCT FROM d.status`,
      );
      const claimed = await database.query(
        `WITH rate_lock AS (
           SELECT pg_advisory_xact_lock(hashtext('cointrack.telegram_market_rate_limit'))
         ), eligible AS (
           SELECT d.id, d.user_id, n.notification_type,
             CASE WHEN n.payload->>'severityClass' = 'major' THEN 0 ELSE 1 END AS priority
           FROM telegram_deliveries d
           JOIN telegram_links l ON l.id = d.telegram_link_id AND l.user_id = d.user_id
           JOIN user_preferences p ON p.user_id = d.user_id
           JOIN notifications n ON n.id = d.notification_id
           CROSS JOIN rate_lock
           WHERE d.status IN ('queued', 'retry') AND d.next_attempt_at <= CURRENT_TIMESTAMP
             AND COALESCE((p.notification_preferences->>'telegram_alerts')::boolean, FALSE) = TRUE
             AND (n.payload->>'preferenceKey' IS NULL
               OR COALESCE((p.notification_preferences->>(n.payload->>'preferenceKey'))::boolean, FALSE) = TRUE)
             AND (n.payload->>'expiresAt' IS NULL OR (n.payload->>'expiresAt')::timestamptz > CURRENT_TIMESTAMP)
         ), ranked AS (
           SELECT eligible.*,
             count(*) FILTER (WHERE notification_type = 'market_signal') OVER (ORDER BY priority, id) AS market_position,
             count(*) FILTER (WHERE notification_type = 'market_signal') OVER (PARTITION BY user_id ORDER BY priority, id) AS user_market_position
           FROM eligible
         ), due AS (
           SELECT d.id FROM telegram_deliveries d JOIN ranked r ON r.id = d.id
           WHERE r.notification_type <> 'market_signal' OR (
             r.market_position <= GREATEST(0, $3 - (
               SELECT count(*) FROM telegram_deliveries recent
               JOIN notifications recent_n ON recent_n.id = recent.notification_id
               WHERE recent_n.notification_type = 'market_signal'
                 AND recent.status IN ('processing', 'sent')
                 AND recent.updated_at >= CURRENT_TIMESTAMP - ($2::bigint * INTERVAL '1 millisecond')
             ))
             AND r.user_market_position <= GREATEST(0, $4 - (
               SELECT count(*) FROM telegram_deliveries recent
               JOIN notifications recent_n ON recent_n.id = recent.notification_id
               WHERE recent.user_id = r.user_id AND recent_n.notification_type = 'market_signal'
                 AND recent.status IN ('processing', 'sent')
                 AND recent.updated_at >= CURRENT_TIMESTAMP - ($2::bigint * INTERVAL '1 millisecond')
             )))
           ORDER BY r.priority, d.next_attempt_at
           FOR UPDATE OF d SKIP LOCKED LIMIT 20
         )
         UPDATE telegram_deliveries d SET status = 'processing', attempts = attempts + 1,
           locked_at = CURRENT_TIMESTAMP, locked_by = $1, send_started_at = NULL, updated_at = CURRENT_TIMESTAMP
         FROM due WHERE d.id = due.id RETURNING d.id`,
        [workerId, marketDeliveryWindowMs, globalMarketDeliveryLimit, userMarketDeliveryLimit],
      );
      if (!claimed.rowCount) {
        lastCycleStatus = "completed";
        return { status: "completed", processed: 0 };
      }
      const jobs = await database.query(
        `SELECT d.id, d.notification_id, d.attempts, n.payload
         FROM telegram_deliveries d JOIN notifications n ON n.id = d.notification_id
         WHERE d.locked_by = $1 AND d.status = 'processing'`,
        [workerId],
      );
      for (const job of jobs.rows) {
        const eligible = await database.query(
          `SELECT l.chat_id FROM telegram_deliveries d
           JOIN telegram_links l ON l.id = d.telegram_link_id AND l.user_id = d.user_id
           JOIN user_preferences p ON p.user_id = d.user_id
           JOIN notifications n ON n.id = d.notification_id
           WHERE d.id = $1 AND d.status = 'processing'
             AND COALESCE((p.notification_preferences->>'telegram_alerts')::boolean, FALSE) = TRUE
             AND (n.payload->>'preferenceKey' IS NULL
               OR COALESCE((p.notification_preferences->>(n.payload->>'preferenceKey'))::boolean, FALSE) = TRUE)
             AND (n.payload->>'expiresAt' IS NULL OR (n.payload->>'expiresAt')::timestamptz > CURRENT_TIMESTAMP)`,
          [job.id],
        );
        if (!eligible.rowCount) {
          await markCancelled(job);
          continue;
        }
        const started = await database.query(
          `UPDATE telegram_deliveries SET send_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status = 'processing' AND locked_by = $2 RETURNING id`,
          [job.id, workerId],
        );
        if (!started.rowCount) continue;

        const details = job.payload || {};
        let sent;
        try {
          sent = await deliver({
            chatId: eligible.rows[0].chat_id,
            text: formatTelegramAlert({ ...details, appBaseUrl: process.env.APP_BASE_URL }),
          });
        } catch (error) {
          const retry = error.transient === true && Number(job.attempts) < MAX_ATTEMPTS;
          const status = retry ? "retry" : "failed";
          const nextAttempt = new Date(now().getTime() + retryDelayMs(Number(job.attempts), error.retryAfterSeconds));
          try {
            await database.query(
              `UPDATE telegram_deliveries SET status = $2, next_attempt_at = $3, last_error_code = $4,
               locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [job.id, status, nextAttempt, String(error.code || "delivery_error").slice(0, 40)],
            );
            await updateNotification(job.notification_id, status);
          } catch (persistenceError) {
            onError(persistenceError);
          }
          continue;
        }

        try {
          await database.query(
            `UPDATE telegram_deliveries SET status = 'sent', telegram_message_id = $2,
             locked_at = NULL, locked_by = NULL, last_error_code = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [job.id, sent.messageId],
          );
          await updateNotification(job.notification_id, "sent");
        } catch (persistenceError) {
          // Leave a send-started job as processing. Recovery marks it ambiguous instead of resending.
          onError(persistenceError);
        }
      }
      lastCycleStatus = "completed";
      return { status: "completed", processed: jobs.rowCount };
    } catch (error) {
      lastCycleStatus = "error";
      onError(error);
      return { status: "error", processed: 0 };
    } finally {
      finishCycle();
    }
  }

  function start() {
    if (!enabled || timer) return false;
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
  function getStatus() {
    return {
      lifecycle: timer ? "running" : "stopped",
      cycleRunning: running,
      lastCycleAt,
      lastCycleStatus,
    };
  }
  return { getStatus, runOnce, start, stop, whenIdle };
}

module.exports = {
  BACKOFF_MS,
  DEFAULT_GLOBAL_MARKET_DELIVERY_LIMIT,
  DEFAULT_MARKET_DELIVERY_WINDOW_MS,
  DEFAULT_USER_MARKET_DELIVERY_LIMIT,
  MAX_ATTEMPTS,
  createTelegramWorker,
  retryDelayMs,
};
