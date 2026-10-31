require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { pool } = require("../server/db/pool");
const { createMarketAlertEvaluator } = require("../server/alerts/evaluator");

async function main() {
  const token = randomUUID();
  let userId;
  try {
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'market_alerts' AND column_name IN ('last_observed_value', 'last_evaluated_at')`,
    );
    if (columns.rowCount !== 2) throw new Error("Migration 004 is not applied.");

    const user = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, 'Phase 4.1 Runtime Check') RETURNING id`,
      [`phase41-${token}@example.test`, "runtime-check-not-a-login-credential"],
    );
    userId = user.rows[0].id;
    await pool.query(
      `INSERT INTO user_preferences (user_id, notification_preferences)
       VALUES ($1, '{"email_alerts":false}'::jsonb)`,
      [userId],
    );
    const created = await pool.query(
      `INSERT INTO market_alerts (user_id, coin_id, alert_type, direction, threshold)
       VALUES ($1, 'bitcoin', 'price', 'above', 100) RETURNING id`,
      [userId],
    );
    const alertId = created.rows[0].id;
    let observedAt = Date.now();
    const snapshot = (price) => ({
      markets: [{ id: "bitcoin", name: "Bitcoin", current_price: price }],
      observedAt,
    });
    const scopedDatabase = {
      connect: () => pool.connect(),
      query: (sql, params) => sql.includes("FROM market_alerts a")
        ? pool.query(`${sql} AND a.user_id = $1`, [userId])
        : pool.query(sql, params),
    };
    const evaluateA = createMarketAlertEvaluator({ database: scopedDatabase, now: () => observedAt });
    const evaluateB = createMarketAlertEvaluator({ database: scopedDatabase, now: () => observedAt });

    const baseline = await evaluateA(snapshot(90));
    observedAt += 60_000;
    const concurrent = await Promise.all([evaluateA(snapshot(110)), evaluateB(snapshot(110))]);
    observedAt += 60_000;
    const repeat = await evaluateA(snapshot(115));
    observedAt += 60_000;
    const rearm = await evaluateA(snapshot(90));
    observedAt += 60_000;
    const retrigger = await evaluateA(snapshot(105));
    const history = await pool.query(
      `SELECT payload FROM notifications
       WHERE user_id = $1 AND notification_type = 'market_alert' ORDER BY created_at`,
      [userId],
    );
    const state = await pool.query(
      `SELECT condition_active, last_observed_value, last_evaluated_at
       FROM market_alerts WHERE id = $1`,
      [alertId],
    );

    const triggerCount = concurrent.reduce((total, result) => total + result.triggered, 0);
    if (baseline.triggered !== 0 || triggerCount !== 1 || repeat.triggered !== 0
        || rearm.rearmed !== 1 || retrigger.triggered !== 1 || history.rowCount !== 2) {
      throw new Error("Runtime crossing assertions failed.");
    }
    if (!history.rows.every((row) => row.payload.delivery?.inApp === "recorded"
        && row.payload.delivery?.email === "not_requested"
        && row.payload.observedAt && Number.isFinite(row.payload.observedValue))) {
      throw new Error("Runtime trigger-history assertions failed.");
    }

    console.log(JSON.stringify({
      status: "passed",
      migrationColumns: columns.rows.map((row) => row.column_name).sort(),
      baselineTriggers: baseline.triggered,
      concurrentTriggers: triggerCount,
      repeatTriggers: repeat.triggered,
      rearmed: rearm.rearmed,
      retriggers: retrigger.triggered,
      persistedNotifications: history.rowCount,
      finalConditionActive: state.rows[0].condition_active,
      finalObservedValue: Number(state.rows[0].last_observed_value),
    }));
  } finally {
    if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
