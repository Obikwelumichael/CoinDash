const express = require("express");
const { requireAuth } = require("../middleware/require-auth");
const { getUserPreferences, updateUserPreferences } = require("../db/preferences");

const router = express.Router();
const themes = new Set(["system", "dark", "light"]);
const booleanPreferences = new Set(["emailAlerts", "telegramAlerts", "marketPriceMovements", "marketUnusualVolume", "marketBreakouts"]);

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    return res.json({ preferences: await getUserPreferences(req.user.id) });
  } catch (error) {
    console.error("Preferences database read failed:", error.message);
    return res.status(500).json({ error: "Unable to load account preferences." });
  }
});

router.put("/", async (req, res) => {
  const body = req.body;
  const valid = body && typeof body === "object" && !Array.isArray(body)
    && Object.keys(body).length > 0
    && Object.keys(body).every((key) => key === "theme" || booleanPreferences.has(key))
    && (body.theme === undefined || themes.has(body.theme))
    && [...booleanPreferences].every((key) => body[key] === undefined || typeof body[key] === "boolean");
  if (!valid) {
    return res.status(400).json({
      error: "Provide supported preferences using supported boolean values.",
    });
  }

  try {
    const preferences = await updateUserPreferences(req.user.id, body);
    return res.json({ preferences });
  } catch (error) {
    console.error("Preferences database update failed:", error.message);
    return res.status(500).json({ error: "Unable to update account preferences." });
  }
});

module.exports = { preferencesRouter: router };
