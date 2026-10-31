exports.up = (pgm) => {
  pgm.addColumns("market_signal_states", {
    major_condition_active: { type: "boolean", notNull: true, default: false },
    last_major_triggered_at: { type: "timestamptz" },
    last_normal_metric: { type: "numeric(30,12)" },
    last_major_metric: { type: "numeric(30,12)" },
  });
  pgm.addColumns("market_signal_events", {
    severity_class: { type: "varchar(10)", notNull: true, default: "normal" },
    override_reason: { type: "varchar(60)" },
  });
  pgm.addConstraint("market_signal_events", "market_signal_events_severity_check", {
    check: "severity_class IN ('normal', 'major')",
  });
  pgm.createIndex("market_signal_events", ["severity_class", "created_at"], { name: "market_signal_events_severity_created_idx" });
};

exports.down = (pgm) => {
  pgm.dropIndex("market_signal_events", ["severity_class", "created_at"], { name: "market_signal_events_severity_created_idx" });
  pgm.dropConstraint("market_signal_events", "market_signal_events_severity_check");
  pgm.dropColumns("market_signal_events", ["severity_class", "override_reason"]);
  pgm.dropColumns("market_signal_states", ["major_condition_active", "last_major_triggered_at", "last_normal_metric", "last_major_metric"]);
};
