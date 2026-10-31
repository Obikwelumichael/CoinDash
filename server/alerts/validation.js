const COIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidAlertId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isValidCoinId(value) {
  return typeof value === "string" && value.length <= 100 && COIN_ID_PATTERN.test(value);
}

function isValidThreshold(alertType, threshold) {
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) return false;
  return alertType === "price"
    ? threshold > 0 && threshold < 1e18
    : alertType === "percentage" && threshold >= -100 && threshold <= 100;
}

function validateNewAlert(body) {
  const { coinId, alertType, direction, threshold } = body ?? {};
  return isValidCoinId(coinId)
    && ["price", "percentage"].includes(alertType)
    && ["above", "below"].includes(direction)
    && isValidThreshold(alertType, threshold);
}

function validateAlertPatch(body) {
  if (!body || !Object.keys(body).length) return false;
  if (Object.keys(body).some((key) => !["threshold", "direction", "enabled"].includes(key))) return false;
  if (body.threshold !== undefined && (typeof body.threshold !== "number" || !Number.isFinite(body.threshold))) return false;
  if (body.direction !== undefined && !["above", "below"].includes(body.direction)) return false;
  return body.enabled === undefined || typeof body.enabled === "boolean";
}

module.exports = {
  isValidAlertId,
  isValidCoinId,
  isValidThreshold,
  validateAlertPatch,
  validateNewAlert,
};
