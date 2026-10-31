exports.up = (pgm) => {
  pgm.addColumn("users", {
    email_verified_at: { type: "timestamptz" },
  });

  for (const table of ["password_reset_tokens", "email_verification_tokens"]) {
    pgm.createTable(table, {
      id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
      user_id: { type: "uuid", notNull: true, references: '"users"', onDelete: "CASCADE" },
      token_hash: { type: "char(64)", notNull: true, unique: true },
      expires_at: { type: "timestamptz", notNull: true },
      used_at: { type: "timestamptz" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
    });
    pgm.createIndex(table, "user_id", { name: `${table}_user_id_idx` });
    pgm.createIndex(table, "expires_at", { name: `${table}_expires_at_idx` });
  }
};

exports.down = (pgm) => {
  pgm.dropTable("email_verification_tokens");
  pgm.dropTable("password_reset_tokens");
  pgm.dropColumn("users", "email_verified_at");
};
