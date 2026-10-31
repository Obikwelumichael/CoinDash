const express = require("express");
const { requireAuth } = require("../middleware/require-auth");
const { createAlert, deleteAlert, listAlerts, updateAlert } = require("../db/alerts");
const {
  isValidAlertId,
  isValidThreshold,
  validateAlertPatch,
  validateNewAlert,
} = require("./validation");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try { return res.json({ alerts: await listAlerts(req.user.id) }); }
  catch (error) { return next(error); }
});

router.post("/", async (req, res, next) => {
  const { coinId, alertType, direction, threshold } = req.body ?? {};
  if (!validateNewAlert(req.body)) {
    return res.status(400).json({ error: "Provide a valid coin, alert type, direction, and threshold." });
  }
  try {
    const alert = await createAlert(req.user.id, { coinId, alertType, direction, threshold });
    if (!alert) return res.status(409).json({ error: "You can have at most 20 market alerts." });
    return res.status(201).json({ alert });
  } catch (error) { return next(error); }
});

router.patch("/:id", async (req, res, next) => {
  const { threshold, direction, enabled } = req.body ?? {};
  if (!isValidAlertId(req.params.id) || !validateAlertPatch(req.body)) {
    return res.status(400).json({ error: "Invalid alert update." });
  }
  try {
    const current = (await listAlerts(req.user.id)).find((alert) => alert.id === req.params.id);
    if (!current) return res.status(404).json({ error: "Alert not found." });
    if (threshold !== undefined && !isValidThreshold(current.alert_type, threshold)) return res.status(400).json({ error: "Threshold is outside the supported range for this alert." });
    const alert = await updateAlert(req.user.id, req.params.id, { threshold, direction, enabled });
    return res.json({ alert });
  } catch (error) { return next(error); }
});

router.delete("/:id", async (req, res, next) => {
  if (!isValidAlertId(req.params.id)) return res.status(400).json({ error: "Invalid alert ID." });
  try {
    if (!(await deleteAlert(req.user.id, req.params.id))) return res.status(404).json({ error: "Alert not found." });
    return res.status(204).end();
  } catch (error) { return next(error); }
});

module.exports = { alertsRouter: router };
