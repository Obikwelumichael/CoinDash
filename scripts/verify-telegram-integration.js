require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { pool } = require("../server/db/pool");
const { createMarketAlertEvaluator } = require("../server/alerts/evaluator");
const { consumeLinkToken, createLinkToken } = require("../server/telegram/linking");
const { createTelegramWorker } = require("../server/telegram/worker");

async function main() {
  const marker = randomUUID();
  const userIds = [];
  try {
    for (const suffix of ["a", "b"]) {
      const result = await pool.query(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'not-a-login-hash', 'Telegram Runtime Check') RETURNING id",
        [`phase42-${suffix}-${marker}@example.test`],
      );
      userIds.push(result.rows[0].id);
      await pool.query(
        `INSERT INTO user_preferences (user_id, notification_preferences)
         VALUES ($1, '{"email_alerts":false,"telegram_alerts":true}'::jsonb)`,
        [result.rows[0].id],
      );
    }

    const firstToken = await createLinkToken(userIds[0]);
    const stored = await pool.query(
      "SELECT token_hash, expires_at, used_at FROM telegram_link_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [userIds[0]],
    );
    if (stored.rows[0].token_hash.includes(firstToken.token) || stored.rows[0].used_at) throw new Error("Token storage assertion failed.");
    const concurrent = await Promise.all([
      consumeLinkToken({ token: firstToken.token, chatId: "910000001", telegramUserId: "920000001", username: "phase42test" }),
      consumeLinkToken({ token: firstToken.token, chatId: "910000002", telegramUserId: "920000002", username: "phase42other" }),
    ]);
    if (concurrent.filter((result) => result.status === "linked").length !== 1) throw new Error("Single-use token assertion failed.");

    const secondToken = await createLinkToken(userIds[1]);
    const duplicateDestination = await consumeLinkToken({
      token: secondToken.token,
      chatId: "910000001",
      telegramUserId: "920000001",
      username: "phase42test",
    });
    if (duplicateDestination.status !== "unavailable") throw new Error("Destination uniqueness assertion failed.");

    const expiredToken = await createLinkToken(userIds[1]);
    await pool.query("UPDATE telegram_link_tokens SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE user_id = $1 AND used_at IS NULL", [userIds[1]]);
    const expired = await consumeLinkToken({
      token: expiredToken.token,
      chatId: "910000003",
      telegramUserId: "920000003",
      username: "expiredtest",
    });
    if (expired.status !== "invalid") throw new Error("Expired-token assertion failed.");

    const linkedUserId = concurrent.find((result) => result.status === "linked").userId;
    const created = await pool.query(
      "INSERT INTO market_alerts (user_id, coin_id, alert_type, direction, threshold) VALUES ($1, 'bitcoin', 'price', 'above', 100) RETURNING id",
      [linkedUserId],
    );
    let observedAt = Date.now();
    const scopedEvaluatorDatabase = {
      connect: () => pool.connect(),
      query: (sql, params) => sql.includes("FROM market_alerts a")
        ? pool.query(`${sql} AND a.user_id = $1`, [linkedUserId])
        : pool.query(sql, params),
    };
    const evaluate = createMarketAlertEvaluator({ database: scopedEvaluatorDatabase, now: () => observedAt });
    await evaluate({ markets: [{ id: "bitcoin", name: "Bitcoin", current_price: 90 }], observedAt });
    observedAt += 60_000;
    const crossing = await evaluate({ markets: [{ id: "bitcoin", name: "Bitcoin", current_price: 110 }], observedAt });
    const queued = await pool.query(
      `SELECT d.status, n.payload FROM telegram_deliveries d
       JOIN notifications n ON n.id = d.notification_id WHERE d.user_id = $1`,
      [linkedUserId],
    );
    if (crossing.triggered !== 1 || queued.rowCount !== 1 || queued.rows[0].status !== "queued"
        || queued.rows[0].payload.delivery.telegram !== "queued") throw new Error("Transactional outbox assertion failed.");

    const scopedWorkerDatabase = {
      query: (sql, params = []) => {
        if (sql.includes("WITH due AS (")) {
          return pool.query(sql.replace("WHERE d.status", "WHERE d.user_id = $2 AND d.status"), [...params, linkedUserId]);
        }
        return pool.query(sql, params);
      },
    };
    const worker = createTelegramWorker({
      database: scopedWorkerDatabase,
      deliver: async () => ({ messageId: 4242 }),
    });
    const worked = await worker.runOnce();
    const delivered = await pool.query(
      "SELECT status, attempts, telegram_message_id FROM telegram_deliveries WHERE user_id = $1",
      [linkedUserId],
    );
    if (worked.processed !== 1 || delivered.rows[0].status !== "sent"
        || Number(delivered.rows[0].telegram_message_id) !== 4242) throw new Error("Mock worker persistence assertion failed.");

    console.log(JSON.stringify({
      status: "passed",
      tokenStoredAsHash: true,
      concurrentSuccessfulLinks: 1,
      duplicateDestination: duplicateDestination.status,
      expiredToken: expired.status,
      triggerNotifications: crossing.triggered,
      queuedDeliveries: queued.rowCount,
      workerProcessed: worked.processed,
      finalDeliveryStatus: delivered.rows[0].status,
      alertIdCreated: Boolean(created.rows[0].id),
    }));
  } finally {
    if (userIds.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
