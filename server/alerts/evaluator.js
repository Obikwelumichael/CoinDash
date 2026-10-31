const { pool } = require("../db/pool");
const { buildEmailHtml, sendEmail } = require("../auth/email");

const DEFAULT_MAX_DATA_AGE_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const MAX_EMAILS_PER_CYCLE = 50;

async function hasEnabledMarketAlerts() {
  const result = await pool.query("SELECT EXISTS(SELECT 1 FROM market_alerts WHERE enabled = TRUE) AS found");
  return result.rows[0].found;
}

function isConditionMet(alert, currentValue) {
  if (currentValue === null || currentValue === undefined || currentValue === "") return false;
  const value = Number(currentValue);
  const threshold = Number(alert.threshold);
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  return alert.direction === "above" ? value >= threshold : value <= threshold;
}

function alertTransition(wasMet, isMet) {
  if (isMet && !wasMet) return "trigger";
  if (!isMet && wasMet) return "rearm";
  return "unchanged";
}

function evaluateAlertState(alert, currentValue) {
  const isMet = isConditionMet(alert, currentValue);
  if (!alert.last_evaluated_at) return { isMet, transition: "initialize" };
  return { isMet, transition: alertTransition(Boolean(alert.condition_active), isMet) };
}

function isMarketSnapshotFresh(observedAt, now = Date.now(), maxAgeMs = DEFAULT_MAX_DATA_AGE_MS) {
  const timestamp = new Date(observedAt).getTime();
  return Number.isFinite(timestamp)
    && timestamp <= now + MAX_FUTURE_SKEW_MS
    && now - timestamp <= maxAgeMs;
}

function marketValueForAlert(alert, coin) {
  const raw = alert.alert_type === "price"
    ? coin?.current_price
    : coin?.price_change_percentage_24h;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildAlertMessage(alert, coin, value) {
  const message = alert.alert_type === "price"
    ? `${coin.name} crossed ${alert.direction} your price threshold.`
    : `${coin.name} crossed ${alert.direction} your 24-hour change threshold.`;
  const alertType = alert.alert_type === "price" ? "Price" : "24-hour change";
  return {
    message,
    email: {
      to: alert.email,
      subject: `CoinDash alert: ${coin.name}`,
      text: `${message} Observed value: ${value}. Your alert threshold: ${alert.direction} ${alert.threshold}.`,
      html: buildEmailHtml({
        preheader: `${coin.name} triggered your CoinDash market alert.`,
        eyebrow: "Market alert",
        title: message,
        intro: "The market condition you asked CoinDash to watch has just been met.",
        details: [
          { label: "Asset", value: coin.name },
          { label: "Alert type", value: alertType },
          { label: "Your condition", value: `${alert.direction} ${alert.threshold}` },
          { label: "Observed value", value },
        ],
        note: "Market prices can move quickly. Review current market data before making a decision.",
      }),
    },
  };
}

function createMarketAlertEvaluator({
  database = pool,
  deliverEmail = sendEmail,
  maxDataAgeMs = DEFAULT_MAX_DATA_AGE_MS,
  now = () => Date.now(),
  onRuleError = () => console.error("A market alert rule failed; remaining rules will continue."),
} = {}) {
  let running = false;

  return async function evaluateMarketAlerts(snapshot) {
    if (running) return { status: "skipped_overlap", evaluated: 0, triggered: 0, rearmed: 0, skipped: 0, errors: 0 };
    const markets = Array.isArray(snapshot) ? snapshot : snapshot?.markets;
    const observedAt = Array.isArray(snapshot) ? now() : snapshot?.observedAt;
    if (!Array.isArray(markets) || markets.length === 0) {
      return { status: "skipped_empty", evaluated: 0, triggered: 0, rearmed: 0, skipped: 0, errors: 0 };
    }
    if (!isMarketSnapshotFresh(observedAt, now(), maxDataAgeMs)) {
      return { status: "skipped_stale", evaluated: 0, triggered: 0, rearmed: 0, skipped: markets.length, errors: 0 };
    }
    const observedDate = new Date(observedAt);

    running = true;
    const summary = { status: "completed", evaluated: 0, triggered: 0, rearmed: 0, skipped: 0, errors: 0 };
    try {
      const result = await database.query(
        `SELECT a.id, a.user_id, a.coin_id, a.alert_type, a.direction, a.threshold,
                a.condition_active, a.last_evaluated_at, u.email, p.notification_preferences,
                tl.id AS telegram_link_id
         FROM market_alerts a JOIN users u ON u.id = a.user_id
         LEFT JOIN user_preferences p ON p.user_id = a.user_id
         LEFT JOIN telegram_links tl ON tl.user_id = a.user_id WHERE a.enabled = TRUE`,
      );
      const marketById = new Map(markets.filter((coin) => coin?.id).map((coin) => [coin.id, coin]));
      let scheduledEmails = 0;

      for (const alert of result.rows) {
        const coin = marketById.get(alert.coin_id);
        const value = marketValueForAlert(alert, coin);
        if (!coin || value === null) {
          summary.skipped += 1;
          continue;
        }

        let client;
        let delivery;
        try {
          client = await database.connect();
          await client.query("BEGIN");
          const locked = await client.query(
            `SELECT condition_active, last_evaluated_at FROM market_alerts
             WHERE id = $1 AND enabled = TRUE FOR UPDATE`,
            [alert.id],
          );
          if (!locked.rows[0]) {
            await client.query("ROLLBACK");
            summary.skipped += 1;
            continue;
          }

          const current = { ...alert, ...locked.rows[0] };
          const { isMet, transition } = evaluateAlertState(current, value);
          if (transition === "trigger") {
            const content = buildAlertMessage(alert, coin, value);
            const wantsEmail = alert.notification_preferences?.email_alerts === true;
            const emailStatus = wantsEmail
              ? (scheduledEmails < MAX_EMAILS_PER_CYCLE ? "pending" : "rate_limited")
              : "not_requested";
            const payload = {
              alertId: alert.id,
              coinId: alert.coin_id,
              coinName: coin.name,
              observedValue: value,
              observedAt: new Date(observedAt).toISOString(),
              alertType: alert.alert_type,
              percentageWindow: alert.alert_type === "percentage" ? "24h" : undefined,
              direction: alert.direction,
              threshold: Number(alert.threshold),
              delivery: {
                inApp: "recorded",
                email: emailStatus,
                telegram: alert.telegram_link_id && alert.notification_preferences?.telegram_alerts === true
                  ? "queued"
                  : "not_requested",
              },
            };
            await client.query(
              `UPDATE market_alerts SET condition_active = TRUE, last_triggered_at = $2,
                 last_observed_value = $3, last_evaluated_at = $2, updated_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [alert.id, observedDate, value],
            );
            const notification = await client.query(
              `INSERT INTO notifications (user_id, notification_type, message, payload)
               VALUES ($1, 'market_alert', $2, $3::jsonb) RETURNING id`,
              [alert.user_id, content.message, JSON.stringify(payload)],
            );
            if (alert.telegram_link_id && alert.notification_preferences?.telegram_alerts === true) {
              await client.query(
                `INSERT INTO telegram_deliveries (notification_id, user_id, telegram_link_id)
                 VALUES ($1, $2, $3) ON CONFLICT (notification_id) DO NOTHING`,
                [notification.rows[0].id, alert.user_id, alert.telegram_link_id],
              );
            }
            if (emailStatus === "pending") {
              scheduledEmails += 1;
              delivery = { notificationId: notification.rows[0].id, userId: alert.user_id, email: content.email };
            }
            summary.triggered += 1;
          } else {
            await client.query(
              `UPDATE market_alerts SET condition_active = $2, last_observed_value = $3,
                 last_evaluated_at = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [alert.id, isMet, value, observedDate],
            );
            if (transition === "rearm") summary.rearmed += 1;
          }
          await client.query("COMMIT");
          summary.evaluated += 1;
        } catch (error) {
          if (client) await client.query("ROLLBACK").catch(() => {});
          summary.errors += 1;
          onRuleError(error, alert.id);
        } finally {
          client?.release();
        }

        if (delivery) {
          let emailStatus = "sent";
          try {
            await deliverEmail(delivery.email);
          } catch {
            emailStatus = "failed";
          }
          try {
            await database.query(
              `UPDATE notifications
               SET payload = jsonb_set(payload, '{delivery,email}', to_jsonb($2::text), TRUE)
               WHERE id = $1 AND user_id = $3`,
              [delivery.notificationId, emailStatus, delivery.userId],
            );
          } catch (error) {
            summary.errors += 1;
            onRuleError(error, alert.id);
          }
        }
      }
      return summary;
    } finally {
      running = false;
    }
  };
}

const evaluateMarketAlerts = createMarketAlertEvaluator();

module.exports = {
  DEFAULT_MAX_DATA_AGE_MS,
  alertTransition,
  createMarketAlertEvaluator,
  evaluateAlertState,
  evaluateMarketAlerts,
  hasEnabledMarketAlerts,
  isConditionMet,
  isMarketSnapshotFresh,
  marketValueForAlert,
};
