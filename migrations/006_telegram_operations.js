exports.up = (pgm) => {
  pgm.addColumn("telegram_deliveries", {
    send_started_at: { type: "timestamptz" },
  });
  pgm.dropConstraint("telegram_deliveries", "telegram_deliveries_status_check");
  pgm.addConstraint("telegram_deliveries", "telegram_deliveries_status_check", {
    check: "status IN ('queued', 'processing', 'retry', 'sent', 'failed', 'cancelled', 'ambiguous')",
  });
  pgm.createTable("telegram_webhook_updates", {
    update_id: { type: "bigint", primaryKey: true },
    received_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createIndex("telegram_webhook_updates", "received_at", { name: "telegram_webhook_updates_received_idx" });
};

exports.down = (pgm) => {
  pgm.dropTable("telegram_webhook_updates");
  pgm.dropConstraint("telegram_deliveries", "telegram_deliveries_status_check");
  pgm.addConstraint("telegram_deliveries", "telegram_deliveries_status_check", {
    check: "status IN ('queued', 'processing', 'retry', 'sent', 'failed', 'cancelled')",
  });
  pgm.dropColumn("telegram_deliveries", "send_started_at");
};
