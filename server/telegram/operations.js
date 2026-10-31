const { timingSafeEqual } = require("node:crypto");
const express = require("express");
const { pool } = require("../db/pool");
const { telegramConfig } = require("./adapter");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function operationsTokenValid() {
  return typeof process.env.OPERATIONS_TOKEN === "string" && process.env.OPERATIONS_TOKEN.length >= 32;
}

function requireOperator(req, res, next) {
  if (!operationsTokenValid()) {
    return res.status(503).json({ error: "Operator diagnostics are not configured." });
  }
  const authorization = req.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!safeEqual(supplied, process.env.OPERATIONS_TOKEN)) {
    return res.status(401).json({ error: "Operator authorization is required." });
  }
  return next();
}

async function getTelegramOperationalStatus({ database = pool, worker }) {
  const [summary, categories] = await Promise.all([
    database.query(
      `SELECT
         count(*) FILTER (WHERE status IN ('queued', 'retry', 'processing'))::int AS pending,
         count(*) FILTER (WHERE status = 'retry' AND next_attempt_at <= CURRENT_TIMESTAMP)::int AS eligible_retries,
         count(*) FILTER (WHERE status = 'failed')::int AS failed,
         count(*) FILTER (WHERE status = 'ambiguous')::int AS ambiguous,
         count(*) FILTER (WHERE status = 'sent' AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS sent_24h,
         count(*) FILTER (WHERE status IN ('failed', 'ambiguous') AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS failed_24h,
         EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - min(created_at) FILTER (WHERE status IN ('queued', 'retry', 'processing'))))::int AS oldest_pending_seconds
       FROM telegram_deliveries`,
    ),
    database.query(
      `SELECT last_error_code AS code, count(*)::int AS count
       FROM telegram_deliveries WHERE last_error_code IS NOT NULL
         AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
       GROUP BY last_error_code ORDER BY count(*) DESC, last_error_code LIMIT 10`,
    ),
  ]);
  const metrics = summary.rows[0];
  const config = telegramConfig();
  const workerStatus = worker.getStatus();
  const workerLifecycle = config.workerDisabled ? "disabled" : workerStatus.lifecycle;
  const degraded = Number(metrics.failed) > 0 || Number(metrics.ambiguous) > 0
    || Number(metrics.eligible_retries) > 0 || Number(metrics.oldest_pending_seconds || 0) > 300;
  return {
    application: "ok",
    postgres: "ok",
    telegram: {
      health: !config.configured ? "not_configured" : degraded ? "degraded" : "ok",
      configuration: {
        ready: config.configured,
        issues: config.issues,
      },
      worker: { ...workerStatus, lifecycle: workerLifecycle },
      deliveries: {
        pending: Number(metrics.pending),
        eligibleRetries: Number(metrics.eligible_retries),
        failed: Number(metrics.failed),
        ambiguous: Number(metrics.ambiguous),
        oldestPendingSeconds: metrics.oldest_pending_seconds === null ? null : Number(metrics.oldest_pending_seconds),
        sentLast24Hours: Number(metrics.sent_24h),
        failedLast24Hours: Number(metrics.failed_24h),
        recentFailureCategories: categories.rows,
      },
    },
  };
}

function createOperationsRouter({ worker, database = pool }) {
  const router = express.Router();
  router.use(requireOperator);
  router.get("/telegram", async (req, res) => {
    try {
      return res.json(await getTelegramOperationalStatus({ database, worker }));
    } catch {
      return res.status(503).json({
        application: "ok",
        postgres: "unavailable",
        telegram: { health: "unknown" },
      });
    }
  });
  return router;
}

module.exports = {
  createOperationsRouter,
  getTelegramOperationalStatus,
  operationsTokenValid,
  requireOperator,
};
