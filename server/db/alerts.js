const { pool } = require("./pool");

async function listAlerts(userId) {
  const result = await pool.query(
    `SELECT id, coin_id, alert_type, direction, threshold, enabled, last_triggered_at, created_at
     FROM market_alerts WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
}

async function createAlert(userId, alert) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const count = await client.query("SELECT count(*)::int AS count FROM market_alerts WHERE user_id = $1", [userId]);
    if (count.rows[0].count >= 20) {
      await client.query("ROLLBACK");
      return null;
    }
    const result = await client.query(
      `INSERT INTO market_alerts (user_id, coin_id, alert_type, direction, threshold)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, coin_id, alert_type, direction, threshold, enabled, last_triggered_at, created_at`,
      [userId, alert.coinId, alert.alertType, alert.direction, alert.threshold],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function updateAlert(userId, id, { threshold, direction, enabled }) {
  const result = await pool.query(
    `UPDATE market_alerts SET threshold = COALESCE($3, threshold),
       direction = COALESCE($4, direction), enabled = COALESCE($5, enabled),
       condition_active = CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL THEN FALSE ELSE condition_active END,
       last_observed_value = CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL THEN NULL ELSE last_observed_value END,
       last_evaluated_at = CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL THEN NULL ELSE last_evaluated_at END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2
     RETURNING id, coin_id, alert_type, direction, threshold, enabled, last_triggered_at, created_at`,
    [id, userId, threshold ?? null, direction ?? null, enabled ?? null],
  );
  return result.rows[0] || null;
}

async function deleteAlert(userId, id) {
  const result = await pool.query("DELETE FROM market_alerts WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
  return Boolean(result.rowCount);
}

module.exports = { createAlert, deleteAlert, listAlerts, updateAlert };
