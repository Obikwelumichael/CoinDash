exports.up = (pgm) => {
  pgm.createTable("user_two_factor", {
    user_id: { type: "uuid", primaryKey: true, references: '"users"', onDelete: "CASCADE" },
    secret_ciphertext: { type: "text", notNull: true },
    enabled_at: { type: "timestamptz" },
    pending_expires_at: { type: "timestamptz" },
    last_totp_step: { type: "bigint" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createTable("two_factor_recovery_codes", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: '"users"', onDelete: "CASCADE" },
    code_hash: { type: "char(64)", notNull: true },
    used_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createIndex("two_factor_recovery_codes", ["user_id", "code_hash"], { unique: true, name: "two_factor_recovery_user_code_unique" });
  pgm.createTable("two_factor_login_challenges", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: '"users"', onDelete: "CASCADE" },
    token_hash: { type: "char(64)", notNull: true, unique: true },
    attempts: { type: "smallint", notNull: true, default: 0 },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createIndex("two_factor_login_challenges", "expires_at", { name: "two_factor_login_challenges_expiry_idx" });

  pgm.createTable("notifications", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: '"users"', onDelete: "CASCADE" },
    notification_type: { type: "varchar(40)", notNull: true },
    message: { type: "varchar(500)", notNull: true },
    payload: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    is_read: { type: "boolean", notNull: true, default: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createIndex("notifications", ["user_id", "created_at"], { name: "notifications_user_created_idx" });
  pgm.addColumn("user_preferences", {
    notification_preferences: { type: "jsonb", notNull: true, default: pgm.func("'{\"email_alerts\":false}'::jsonb") },
  });

  pgm.createTable("market_alerts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: '"users"', onDelete: "CASCADE" },
    coin_id: { type: "varchar(100)", notNull: true },
    alert_type: { type: "varchar(20)", notNull: true },
    direction: { type: "varchar(10)", notNull: true },
    threshold: { type: "numeric(30,12)", notNull: true },
    enabled: { type: "boolean", notNull: true, default: true },
    condition_active: { type: "boolean", notNull: true, default: false },
    last_triggered_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.addConstraint("market_alerts", "market_alerts_type_check", { check: "alert_type IN ('price', 'percentage')" });
  pgm.addConstraint("market_alerts", "market_alerts_direction_check", { check: "direction IN ('above', 'below')" });
  pgm.addConstraint("market_alerts", "market_alerts_threshold_check", { check: "(alert_type = 'price' AND threshold > 0) OR (alert_type = 'percentage' AND threshold BETWEEN -100 AND 100)" });
  pgm.createIndex("market_alerts", ["user_id", "created_at"], { name: "market_alerts_user_created_idx" });
  pgm.createIndex("market_alerts", ["enabled", "coin_id"], { name: "market_alerts_enabled_coin_idx" });
};

exports.down = (pgm) => {
  pgm.dropTable("market_alerts");
  pgm.dropColumn("user_preferences", "notification_preferences");
  pgm.dropTable("notifications");
  pgm.dropTable("two_factor_login_challenges");
  pgm.dropTable("two_factor_recovery_codes");
  pgm.dropTable("user_two_factor");
};
