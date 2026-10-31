const { pool } = require("../db/pool");

const safeUserColumns = "id, email, display_name, email_verified_at, created_at, updated_at";

function findUserByEmail(email) {
  return pool.query(
    `SELECT ${safeUserColumns}, password_hash,
       EXISTS(SELECT 1 FROM user_two_factor WHERE user_id = users.id AND enabled_at IS NOT NULL) AS two_factor_enabled
     FROM users WHERE email = $1`,
    [email],
  ).then((result) => result.rows[0] || null);
}

function findSafeUserById(id) {
  return pool.query(`SELECT ${safeUserColumns} FROM users WHERE id = $1`, [id])
    .then((result) => result.rows[0] || null);
}

function createUser({ email, passwordHash, displayName }) {
  return pool.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
    RETURNING ${safeUserColumns}`,
    [email, passwordHash, displayName],
  ).then((result) => result.rows[0]);
}

module.exports = { createUser, findSafeUserById, findUserByEmail };
