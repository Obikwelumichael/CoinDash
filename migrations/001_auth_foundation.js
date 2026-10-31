exports.up = (pgm) => {
  pgm.createExtension("pgcrypto", { ifNotExists: true });
  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    email: { type: "varchar(254)", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    display_name: { type: "varchar(80)", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createIndex("users", "email", { name: "users_email_idx" });
  pgm.createTable("watchlist", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: '"users"', onDelete: "CASCADE" },
    coin_id: { type: "varchar(100)", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.addConstraint("watchlist", "watchlist_user_coin_unique", { unique: ["user_id", "coin_id"] });
  pgm.createIndex("watchlist", "user_id", { name: "watchlist_user_id_idx" });
  pgm.createTable("user_preferences", {
    user_id: { type: "uuid", primaryKey: true, references: '"users"', onDelete: "CASCADE" },
    theme: { type: "varchar(32)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });
  pgm.createTable("session", {
    sid: { type: "varchar", primaryKey: true, notNull: true },
    sess: { type: "json", notNull: true },
    expire: { type: "timestamptz", notNull: true },
  });
  pgm.createIndex("session", "expire", { name: "session_expire_idx" });
};

exports.down = (pgm) => {
  pgm.dropTable("session");
  pgm.dropTable("user_preferences");
  pgm.dropTable("watchlist");
  pgm.dropTable("users");
};
