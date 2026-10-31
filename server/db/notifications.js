const { pool } = require("./pool");

async function listNotifications(userId, limit = 50) {
  const result = await pool.query(
    `SELECT id, notification_type, message, payload, is_read, created_at
     FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return result.rows;
}

async function markNotificationRead(userId, notificationId) {
  const result = await pool.query(
    "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id, is_read",
    [notificationId, userId],
  );
  return result.rows[0] || null;
}

module.exports = { listNotifications, markNotificationRead };
