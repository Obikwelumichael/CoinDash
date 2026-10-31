exports.up = (pgm) => {
  pgm.createTable("market_signal_observations", {
    coin_id: { type: "varchar(100)", notNull: true },
    observed_at: { type: "timestamptz", notNull: true },
    coin_name: { type: "varchar(120)", notNull: true },
    symbol: { type: "varchar(30)", notNull: true },
    market_cap_rank: { type: "integer", notNull: true },
    current_price: { type: "numeric(30,12)", notNull: true },
    total_volume: { type: "numeric(30,2)" },
    market_cap: { type: "numeric(30,2)", notNull: true },
    source: { type: "varchar(30)", notNull: true, default: "coingecko" },
  });
  pgm.addConstraint("market_signal_observations", "market_signal_observations_pk", {
    primaryKey: ["coin_id", "observed_at"],
  });
  pgm.createIndex("market_signal_observations", ["observed_at"], { name: "market_signal_observed_at_idx" });

  pgm.createTable("market_signal_states", {
    coin_id: { type: "varchar(100)", notNull: true },
    signal_type: { type: "varchar(30)", notNull: true },
    direction: { type: "varchar(10)", notNull: true },
    condition_active: { type: "boolean", notNull: true, default: false },
    last_triggered_at: { type: "timestamptz" },
    last_observed_at: { type: "timestamptz", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.addConstraint("market_signal_states", "market_signal_states_pk", {
    primaryKey: ["coin_id", "signal_type", "direction"],
  });

  pgm.createTable("market_signal_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    coin_id: { type: "varchar(100)", notNull: true },
    signal_type: { type: "varchar(30)", notNull: true },
    direction: { type: "varchar(10)", notNull: true },
    observed_at: { type: "timestamptz", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    payload: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.addConstraint("market_signal_events", "market_signal_events_logical_unique", {
    unique: ["coin_id", "signal_type", "direction", "observed_at"],
  });
  pgm.createIndex("market_signal_events", ["created_at"], { name: "market_signal_events_created_idx" });

  pgm.addColumn("notifications", {
    market_signal_event_id: { type: "uuid", references: '"market_signal_events"', onDelete: "SET NULL" },
  });
  pgm.addConstraint("notifications", "notifications_user_market_signal_unique", {
    unique: ["user_id", "market_signal_event_id"],
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("notifications", "notifications_user_market_signal_unique");
  pgm.dropColumn("notifications", "market_signal_event_id");
  pgm.dropTable("market_signal_events");
  pgm.dropTable("market_signal_states");
  pgm.dropTable("market_signal_observations");
};
