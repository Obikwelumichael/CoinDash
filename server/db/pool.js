const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString && !process.env.PGHOST && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_URL or PostgreSQL connection variables are required in production.");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});

module.exports = { pool };
