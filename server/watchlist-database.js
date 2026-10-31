const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const defaultDatabasePath = path.join(__dirname, "..", "data", "cryptodash.sqlite");
const databasePath = path.resolve(process.env.CRYPTODASH_DB_PATH || defaultDatabasePath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
database.exec(`
  CREATE TABLE IF NOT EXISTS watchlist_coins (
    coin_id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT
`);

const listStatement = database.prepare(
  "SELECT coin_id FROM watchlist_coins ORDER BY created_at ASC, coin_id ASC",
);
const insertStatement = database.prepare(
  "INSERT OR IGNORE INTO watchlist_coins (coin_id) VALUES (?)",
);
const deleteStatement = database.prepare(
  "DELETE FROM watchlist_coins WHERE coin_id = ?",
);

function listWatchlistCoinIds() {
  return listStatement.all().map((row) => row.coin_id);
}

function addWatchlistCoinId(coinId) {
  return insertStatement.run(coinId).changes > 0;
}

function removeWatchlistCoinId(coinId) {
  return deleteStatement.run(coinId).changes > 0;
}

module.exports = {
  databasePath,
  listWatchlistCoinIds,
  addWatchlistCoinId,
  removeWatchlistCoinId,
};
