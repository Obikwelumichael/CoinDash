const TELEGRAM_API_ROOT = "https://api.telegram.org";

class TelegramDeliveryError extends Error {
  constructor(code, { transient = false, retryAfterSeconds = null } = {}) {
    super("Telegram delivery was not accepted.");
    this.name = "TelegramDeliveryError";
    this.code = code;
    this.transient = transient;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const usernameValue = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || "";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  const workerValue = process.env.TELEGRAM_WORKER_DISABLED;
  const tokenValid = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token);
  const usernameValid = /^[A-Za-z0-9_]{5,32}$/.test(usernameValue);
  const webhookSecretValid = /^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret);
  const workerFlagValid = workerValue === undefined || workerValue === "true" || workerValue === "false";
  const issues = [];
  if (!tokenValid) issues.push(token ? "invalid_bot_token" : "missing_bot_token");
  if (!usernameValid) issues.push(usernameValue ? "invalid_bot_username" : "missing_bot_username");
  if (!webhookSecretValid) issues.push(webhookSecret ? "invalid_webhook_secret" : "missing_webhook_secret");
  if (!workerFlagValid) issues.push("invalid_worker_disabled_flag");
  return {
    configured: tokenValid && usernameValid && webhookSecretValid,
    deliveryConfigured: tokenValid,
    webhookConfigured: tokenValid && usernameValid && webhookSecretValid,
    token: tokenValid ? token : null,
    username: usernameValid ? usernameValue : null,
    webhookSecret: webhookSecretValid ? webhookSecret : null,
    workerDisabled: workerValue === "true",
    issues,
  };
}

async function sendTelegramMessage({ chatId, text }, { fetchImpl = fetch, timeoutMs = 10_000, token = telegramConfig().token } = {}) {
  if (!token) throw new TelegramDeliveryError("not_configured");
  let response;
  try {
    response = await fetchImpl(`${TELEGRAM_API_ROOT}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new TelegramDeliveryError("network_error", { transient: true });
  }
  const body = await response.json().catch(() => ({}));
  if (response.ok && body.ok === true && body.result?.message_id !== undefined) {
    return { messageId: body.result.message_id };
  }
  const retryAfterSeconds = Number(body.parameters?.retry_after);
  if (response.status === 429) {
    throw new TelegramDeliveryError("rate_limited", {
      transient: true,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    });
  }
  if (response.status >= 500) throw new TelegramDeliveryError("provider_unavailable", { transient: true });
  if (response.status === 401) throw new TelegramDeliveryError("bot_unauthorized");
  if (response.status === 403) throw new TelegramDeliveryError("bot_blocked");
  throw new TelegramDeliveryError("invalid_destination");
}

function formatTelegramAlert({ coinName, coinId, coinSymbol, alertType, direction, threshold, observedValue, observedAt, appBaseUrl, ...details }) {
  if (details.source === "automatic_market_feed") {
    const symbol = String(coinSymbol || coinId || "Market").toUpperCase();
    const price = Number(details.currentPrice ?? observedValue);
    const money = (value) => Number.isFinite(Number(value))
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number(value) < 1 ? 6 : 2 }).format(Number(value))
      : "Unavailable";
    const compactMoney = (value) => Number.isFinite(Number(value))
      ? `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value))}`
      : "Unavailable";
    const time = new Date(observedAt);
    const observedTime = Number.isNaN(time.getTime()) ? "Unavailable" : time.toISOString();
    const reasonText = {
      normal_to_major_escalation: "ordinary signal escalated to major severity",
      major_price_acceleration: "major price acceleration",
      major_volume_acceleration: "major independently measured volume spike",
      confirmed_major_breakout: "material range breakout with volume confirmation",
      material_major_breakout: "material range breakout; volume confirmation unavailable",
    }[details.overrideReason?.code] || "major severity threshold crossed";
    let lines;
    if (details.severityClass === "major") {
      const measured = alertType === "price_movement"
        ? `${symbol} moved ${Math.abs(Number(details.changePercent)).toFixed(2)}% ${direction} in ${details.windowMinutes} minutes.`
        : alertType === "unusual_volume"
          ? `${symbol} volume reached ${Number(details.volumeMultiple).toFixed(2)}× its recent baseline.`
          : `${symbol} broke ${direction} ${Math.abs(Number(details.rangeMovePercent)).toFixed(2)}% beyond its recent range.`;
      lines = [
        "🚨 CoinDash MAJOR MOVE",
        measured,
        `Current price: ${money(price)}`,
        `Observed at: ${observedTime}`,
        `Reason: ${reasonText}.`,
      ];
      if (alertType === "unusual_volume") {
        lines.splice(3, 0, `Current volume: ${compactMoney(details.currentVolume)}`, `Recent baseline: ${compactMoney(details.baselineVolume)}`);
      }
    } else if (alertType === "price_movement") {
      lines = [
        `${direction === "up" ? "🟢" : "🔴"} ${symbol} — Price moved ${direction} ${Math.abs(Number(details.changePercent)).toFixed(2)}% in ${details.windowMinutes} minutes`,
        `Price: ${money(price)}`,
        `Window: ${details.windowMinutes}m`,
      ];
    } else if (alertType === "unusual_volume") {
      lines = [
        `🟠 ${symbol} — Unusual trading volume`,
        `Current volume: ${compactMoney(details.currentVolume)}`,
        `Recent baseline: ${compactMoney(details.baselineVolume)}`,
        `Volume multiple: ${Number(details.volumeMultiple).toFixed(2)}×`,
      ];
    } else {
      const level = direction === "up" ? details.priorHigh : details.priorLow;
      lines = [
        `${direction === "up" ? "🟢" : "🔴"} ${symbol} — ${direction === "up" ? "Upward" : "Downward"} breakout`,
        `Price: ${money(price)}`,
        `Prior range ${direction === "up" ? "high" : "low"}: ${money(level)}`,
        `Move beyond range: ${Math.abs(Number(details.rangeMovePercent)).toFixed(2)}%`,
      ];
    }
    lines.push("", "CoinDash Market Feed · Market signal, not financial advice.");
    if (appBaseUrl) {
      try { lines.push(new URL("/signals", appBaseUrl).href); } catch {}
    }
    return lines.join("\n").slice(0, 4096);
  }
  const type = alertType === "percentage" ? "24-hour change" : "price";
  const observed = alertType === "percentage" ? `${observedValue}%` : `$${observedValue}`;
  const target = alertType === "percentage" ? `${threshold}%` : `$${threshold}`;
  const time = new Date(observedAt);
  const lines = [
    "CoinDash market alert",
    "",
    `${String(coinName || coinId)} crossed ${direction} your ${type} threshold.`,
    `Observed: ${observed}`,
    `Condition: ${direction} ${target}`,
    `Observed at: ${Number.isNaN(time.getTime()) ? "Unavailable" : time.toISOString()}`,
  ];
  if (appBaseUrl) {
    try { lines.push("", new URL("/signals", appBaseUrl).href); } catch {}
  }
  return lines.join("\n").slice(0, 4096);
}

module.exports = { TelegramDeliveryError, formatTelegramAlert, sendTelegramMessage, telegramConfig };
