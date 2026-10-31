exports.up = (pgm) => {
  pgm.addColumns("market_alerts", {
    last_observed_value: { type: "numeric(30,12)" },
    last_evaluated_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("market_alerts", ["last_observed_value", "last_evaluated_at"]);
};
