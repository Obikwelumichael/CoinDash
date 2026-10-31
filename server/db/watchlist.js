const { pool } = require("./pool");

function listWatchlistCoinIds(userId) {
  return pool.query("SELECT coin_id FROM watchlist WHERE user_id = $1 ORDER BY created_at ASC, coin_id ASC", [userId])
    .then((result) => result.rows.map((row) => row.coin_id));
}
function addWatchlistCoinId(userId, coinId) {
  return pool.query("INSERT INTO watchlist (user_id, coin_id) VALUES ($1, $2) ON CONFLICT (user_id, coin_id) DO NOTHING RETURNING id", [userId, coinId])
    .then((result) => result.rowCount > 0);
}
function removeWatchlistCoinId(userId, coinId) {
  return pool.query("DELETE FROM watchlist WHERE user_id = $1 AND coin_id = $2", [userId, coinId])
    .then((result) => result.rowCount > 0);
}
module.exports = { addWatchlistCoinId, listWatchlistCoinIds, removeWatchlistCoinId };
