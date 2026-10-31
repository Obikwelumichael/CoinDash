const { pool } = require("./pool");

async function getUserPreferences(userId) {
  const result = await pool.query(
    "SELECT theme, notification_preferences FROM user_preferences WHERE user_id = $1",
    [userId],
  );
  const theme = result.rows[0]?.theme;
  return {
    theme: ["system", "dark", "light"].includes(theme) ? theme : "dark",
    emailAlerts: result.rows[0]?.notification_preferences?.email_alerts === true,
    telegramAlerts: result.rows[0]?.notification_preferences?.telegram_alerts === true,
    marketPriceMovements: result.rows[0]?.notification_preferences?.market_price_movements === true,
    marketUnusualVolume: result.rows[0]?.notification_preferences?.market_unusual_volume === true,
    marketBreakouts: result.rows[0]?.notification_preferences?.market_breakouts === true,
  };
}

async function updateUserPreferences(userId, {
  theme, emailAlerts, telegramAlerts, marketPriceMovements, marketUnusualVolume, marketBreakouts,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO user_preferences (user_id, theme, notification_preferences)
       VALUES ($1, COALESCE($2, 'dark'), jsonb_build_object(
         'email_alerts', COALESCE($3::boolean, FALSE),
         'telegram_alerts', COALESCE($4::boolean, FALSE),
         'market_price_movements', COALESCE($5::boolean, FALSE),
         'market_unusual_volume', COALESCE($6::boolean, FALSE),
         'market_breakouts', COALESCE($7::boolean, FALSE)))
       ON CONFLICT (user_id) DO UPDATE SET
         theme = COALESCE($2, user_preferences.theme),
         notification_preferences = user_preferences.notification_preferences || jsonb_strip_nulls(jsonb_build_object(
           'email_alerts', $3::boolean, 'telegram_alerts', $4::boolean,
           'market_price_movements', $5::boolean, 'market_unusual_volume', $6::boolean,
           'market_breakouts', $7::boolean)),
         updated_at = CURRENT_TIMESTAMP
       RETURNING theme, notification_preferences`,
      [userId, theme ?? null, emailAlerts ?? null, telegramAlerts ?? null,
        marketPriceMovements ?? null, marketUnusualVolume ?? null, marketBreakouts ?? null],
    );
    const disabledKeys = [
      ["market_price_movements", marketPriceMovements],
      ["market_unusual_volume", marketUnusualVolume],
      ["market_breakouts", marketBreakouts],
    ].filter(([, value]) => value === false).map(([key]) => key);
    if (disabledKeys.length) {
      await client.query(
        `UPDATE telegram_deliveries d SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP,
           last_error_code = 'preference_disabled'
         FROM notifications n WHERE n.id = d.notification_id AND d.user_id = $1
           AND d.status IN ('queued', 'retry') AND n.payload->>'preferenceKey' = ANY($2::text[])`,
        [userId, disabledKeys],
      );
      await client.query(
        `UPDATE notifications n SET payload = jsonb_set(n.payload, '{delivery,telegram}', '"cancelled"'::jsonb, TRUE)
         FROM telegram_deliveries d WHERE d.notification_id = n.id AND d.user_id = $1
           AND d.status = 'cancelled' AND n.payload->>'preferenceKey' = ANY($2::text[])`,
        [userId, disabledKeys],
      );
    }
    await client.query("COMMIT");
    const preferences = result.rows[0].notification_preferences;
    return {
      theme: result.rows[0].theme,
      emailAlerts: preferences?.email_alerts === true,
      telegramAlerts: preferences?.telegram_alerts === true,
      marketPriceMovements: preferences?.market_price_movements === true,
      marketUnusualVolume: preferences?.market_unusual_volume === true,
      marketBreakouts: preferences?.market_breakouts === true,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { getUserPreferences, updateUserPreferences };
