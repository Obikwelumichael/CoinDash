exports.up = (pgm) => {
  pgm.createTable("telegram_links", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, unique: true, references: '"users"', onDelete: "CASCADE" },
    chat_id: { type: "bigint", notNull: true, unique: true },
    telegram_user_id: { type: "bigint", notNull: true, unique: true },
    username: { type: "varchar(64)" },
    linked_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createTable("telegram_link_tokens", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: '"users"', onDelete: "CASCADE" },
    token_hash: { type: "char(64)", notNull: true, unique: true },
    expires_at: { type: "timestamptz", notNull: true },
    used_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createIndex("telegram_link_tokens", ["user_id", "expires_at"], { name: "telegram_link_tokens_user_expiry_idx" });
  pgm.createTable("telegram_link_attempts", {
    chat_id: { type: "bigint", primaryKey: true },
    attempts: { type: "smallint", notNull: true, default: 0 },
    window_started_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createTable("telegram_deliveries", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    notification_id: { type: "uuid", notNull: true, unique: true, references: '"notifications"', onDelete: "CASCADE" },
    user_id: { type: "uuid", notNull: true, references: '"users"', onDelete: "CASCADE" },
    telegram_link_id: { type: "uuid", references: '"telegram_links"', onDelete: "SET NULL" },
    status: { type: "varchar(20)", notNull: true, default: "queued" },
    attempts: { type: "smallint", notNull: true, default: 0 },
    next_attempt_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
    locked_at: { type: "timestamptz" },
    locked_by: { type: "uuid" },
    telegram_message_id: { type: "bigint" },
    last_error_code: { type: "varchar(40)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.addConstraint("telegram_deliveries", "telegram_deliveries_status_check", {
    check: "status IN ('queued', 'processing', 'retry', 'sent', 'failed', 'cancelled')",
  });
  pgm.createIndex("telegram_deliveries", ["status", "next_attempt_at"], { name: "telegram_deliveries_due_idx" });
};

exports.down = (pgm) => {
  pgm.dropTable("telegram_deliveries");
  pgm.dropTable("telegram_link_attempts");
  pgm.dropTable("telegram_link_tokens");
  pgm.dropTable("telegram_links");
};
