const express = require("express");
const { requireAuth } = require("../middleware/require-auth");
const { listNotifications, markNotificationRead } = require("../db/notifications");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try { return res.json({ notifications: await listNotifications(req.user.id) }); }
  catch (error) { return next(error); }
});

router.put("/:id/read", async (req, res, next) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid notification ID." });
  try {
    const notification = await markNotificationRead(req.user.id, req.params.id);
    if (!notification) return res.status(404).json({ error: "Notification not found." });
    return res.json({ notification });
  } catch (error) { return next(error); }
});

module.exports = { notificationsRouter: router };
