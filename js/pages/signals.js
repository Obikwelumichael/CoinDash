import { connectMarketSocket } from "../services/market-socket.js";
import "../services/protected-page.js";
import { formatChangePercent, formatPrice } from "../utils/formatters.js";

const state = {
  alerts: [],
  notifications: [],
  coins: [],
  coinMap: new Map(),
  filter: "all",
  selectedCoinId: "",
  preferences: {
    theme: "dark", emailAlerts: false, marketPriceMovements: false,
    marketUnusualVolume: false, marketBreakouts: false,
  },
  telegram: { linked: false, enabled: false, configured: false },
  telegramCsrfToken: "",
};

const form = document.querySelector("[data-signal-form]");
const assetSearch = document.getElementById("alertAssetSearch");
const assetId = form.elements.coinId;
const assetOptions = document.getElementById("alertAssetOptions");
const selectedAsset = document.querySelector("[data-selected-asset]");
const threshold = document.getElementById("signalThreshold");
const direction = document.getElementById("signalDirection");
const alertList = document.querySelector("[data-alert-list]");
const notificationList = document.querySelector("[data-notification-list]");
const formFeedback = document.querySelector("[data-signal-feedback]");
const headerSearch = document.getElementById("signalHeaderSearch");
const marketFeedForm = document.querySelector("[data-market-feed-form]");
let activeAssetOption = -1;

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch {
    throw new Error("Unable to reach CoinDash. Check your connection and try again.");
  }
  let data = {};
  if (response.status !== 204) {
    try { data = await response.json(); } catch {}
  }
  if (!response.ok) {
    const error = new Error(data.error || "This request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function json(method, values) { return { method, body: JSON.stringify(values) }; }
function telegramJson(method, values) {
  return { ...json(method, values), headers: { "X-CoinTrack-CSRF": state.telegramCsrfToken } };
}

function renderTelegramState() {
  const telegram = state.telegram;
  const settings = document.querySelector("[data-telegram-settings]");
  const checkbox = form.elements.telegramAlerts;
  checkbox.disabled = !telegram.linked || !telegram.configured;
  checkbox.checked = telegram.linked && telegram.enabled;
  document.querySelector("[data-telegram-form-status]").textContent = telegram.linked
    ? (telegram.enabled ? "Verified account · delivery enabled" : "Verified account · delivery disabled")
    : "Link Telegram below to enable delivery";
  document.querySelector("[data-telegram-title]").textContent = telegram.linked
    ? `Connected${telegram.username ? ` as @${telegram.username}` : " to a verified account"}`
    : "Connect a verified Telegram account";
  document.querySelector("[data-telegram-description]").textContent = !telegram.configured
    ? "Telegram delivery is not configured on this server."
    : telegram.linked
      ? `Telegram alerts are ${telegram.enabled ? "enabled" : "disabled"}.${telegram.latestDelivery ? ` Latest delivery: ${telegram.latestDelivery.status}.` : ""}`
      : "Generate a short-lived link, then confirm it inside the official CoinDash bot.";
  settings.querySelector("[data-telegram-link]").hidden = telegram.linked || !telegram.configured;
  settings.querySelector("[data-telegram-unlink]").hidden = !telegram.linked;
  marketFeedForm.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.disabled = !telegram.linked || !telegram.configured;
  });
  settings.setAttribute("aria-busy", "false");
}

function renderMarketFeedPreferences() {
  marketFeedForm.elements.marketPriceMovements.checked = state.preferences.marketPriceMovements;
  marketFeedForm.elements.marketUnusualVolume.checked = state.preferences.marketUnusualVolume;
  marketFeedForm.elements.marketBreakouts.checked = state.preferences.marketBreakouts;
}

async function loadTelegram() {
  const result = await api("/api/telegram");
  state.telegram = result.telegram;
  state.telegramCsrfToken = result.csrfToken;
  renderTelegramState();
}

function safePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${formatPrice(number)}` : "Unavailable";
}

function formatDate(value, includeTime = true) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" } : {}),
  }).format(date);
}

function normalizeCoin(coin) {
  return {
    id: coin.id,
    name: coin.name,
    symbol: String(coin.symbol || "").toUpperCase(),
    image: coin.image || "",
    price: Number(coin.current_price),
    change: Number(coin.price_change_percentage_24h),
  };
}

function setFeedback(message, type = "") {
  formFeedback.textContent = message;
  formFeedback.className = `auth-feedback${type ? ` is-${type}` : ""}`;
}

function currentAlertType() {
  return form.elements.alertType.value;
}

function findCoin(query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return null;
  return state.coins.find((coin) => coin.id === value || coin.name.toLowerCase() === value || coin.symbol.toLowerCase() === value)
    || state.coins.find((coin) => coin.name.toLowerCase().includes(value) || coin.symbol.toLowerCase().startsWith(value));
}

function renderSelectedAsset() {
  const coin = state.coinMap.get(state.selectedCoinId);
  if (!coin) {
    selectedAsset.hidden = true;
    selectedAsset.replaceChildren();
    document.querySelector("[data-current-reference]").textContent = "Choose an asset to see its current market value.";
    return;
  }
  const identity = document.createElement("div");
  if (coin.image) {
    const image = document.createElement("img");
    image.src = coin.image;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    identity.append(image);
  }
  const name = document.createElement("span");
  name.innerHTML = `<strong></strong><small></small>`;
  name.querySelector("strong").textContent = coin.name;
  name.querySelector("small").textContent = coin.symbol;
  identity.append(name);
  const market = document.createElement("div");
  market.innerHTML = `<strong></strong><small></small>`;
  market.querySelector("strong").textContent = safePrice(coin.price);
  market.querySelector("small").textContent = `24h ${formatChangePercent(coin.change)}`;
  market.querySelector("small").className = coin.change >= 0 ? "positive" : "negative";
  selectedAsset.replaceChildren(identity, market);
  selectedAsset.hidden = false;
  document.querySelector("[data-current-reference]").textContent = currentAlertType() === "price"
    ? `Current price: ${safePrice(coin.price)}`
    : `Current 24-hour change: ${formatChangePercent(coin.change)}`;
}

function selectCoin(coin) {
  if (!coin) return;
  state.selectedCoinId = coin.id;
  assetId.value = coin.id;
  assetSearch.value = `${coin.name} (${coin.symbol})`;
  document.querySelector("[data-asset-error]").textContent = "";
  closeAssetOptions();
  renderSelectedAsset();
  updateSummary();
}

function closeAssetOptions() {
  assetOptions.hidden = true;
  assetOptions.replaceChildren();
  assetSearch.setAttribute("aria-expanded", "false");
  assetSearch.removeAttribute("aria-activedescendant");
  activeAssetOption = -1;
}

function matchingCoins(query) {
  const value = query.trim().toLowerCase();
  if (!value) return state.coins.slice(0, 8);
  return state.coins.filter((coin) => coin.name.toLowerCase().includes(value)
    || coin.symbol.toLowerCase().includes(value)
    || coin.id.includes(value)).slice(0, 8);
}

function renderAssetOptions() {
  const matches = matchingCoins(assetSearch.value);
  assetOptions.replaceChildren();
  activeAssetOption = -1;
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "signal-asset-empty";
    empty.textContent = "No matching asset found.";
    assetOptions.append(empty);
  } else {
    matches.forEach((coin, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `signal-asset-option-${index}`;
      option.setAttribute("role", "option");
      option.dataset.coinId = coin.id;
      if (coin.image) {
        const image = document.createElement("img");
        image.src = coin.image;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        option.append(image);
      }
      const identity = document.createElement("span");
      identity.innerHTML = `<strong></strong><small></small>`;
      identity.querySelector("strong").textContent = coin.name;
      identity.querySelector("small").textContent = coin.symbol;
      const price = document.createElement("span");
      price.textContent = safePrice(coin.price);
      option.append(identity, price);
      option.addEventListener("click", () => selectCoin(coin));
      assetOptions.append(option);
    });
  }
  assetOptions.hidden = false;
  assetSearch.setAttribute("aria-expanded", "true");
}

function setActiveAssetOption(nextIndex) {
  const options = [...assetOptions.querySelectorAll('[role="option"]')];
  if (!options.length) return;
  activeAssetOption = (nextIndex + options.length) % options.length;
  options.forEach((option, index) => option.classList.toggle("active", index === activeAssetOption));
  assetSearch.setAttribute("aria-activedescendant", options[activeAssetOption].id);
  options[activeAssetOption].scrollIntoView({ block: "nearest" });
}

function updateAlertType() {
  const percentage = currentAlertType() === "percentage";
  threshold.min = percentage ? "-100" : "0.000000000001";
  threshold.max = percentage ? "100" : "";
  threshold.placeholder = percentage ? "5" : "65000";
  document.querySelector("[data-threshold-label]").textContent = percentage ? "24-hour change (%)" : "Target price (USD)";
  renderSelectedAsset();
  updateSummary();
}

function updateSummary() {
  const coin = state.coinMap.get(state.selectedCoinId);
  const value = Number(threshold.value);
  const summary = document.querySelector("[data-alert-summary]");
  if (!coin || !Number.isFinite(value)) {
    summary.textContent = "Choose an asset and set a threshold.";
    return;
  }
  const relation = direction.value === "above" ? "at or above" : "at or below";
  const target = currentAlertType() === "price" ? `$${formatPrice(value)}` : `${value}% over 24 hours`;
  summary.textContent = `Notify me when ${coin.symbol} is ${relation} ${target}.`;
}

function conditionText(alert) {
  const relation = alert.direction === "above" ? "At or above" : "At or below";
  return alert.alert_type === "price"
    ? `${relation} $${formatPrice(Number(alert.threshold))}`
    : `${relation} ${Number(alert.threshold)}% (24h)`;
}

function renderMetrics() {
  const today = new Date();
  const triggeredToday = state.alerts.filter((alert) => {
    if (!alert.last_triggered_at) return false;
    const date = new Date(alert.last_triggered_at);
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  }).length;
  document.querySelector('[data-signal-metric="active"]').textContent = state.alerts.filter((alert) => alert.enabled).length;
  document.querySelector('[data-signal-metric="triggered"]').textContent = triggeredToday;
  document.querySelector('[data-signal-metric="assets"]').textContent = new Set(state.alerts.map((alert) => alert.coin_id)).size;
  document.querySelector('[data-signal-metric="unread"]').textContent = state.notifications.filter((item) => !item.is_read).length;
  document.querySelector(".signals-overview").setAttribute("aria-busy", "false");
}

function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function renderAlerts() {
  alertList.replaceChildren();
  const alerts = state.alerts.filter((alert) => state.filter === "all" || (state.filter === "active" ? alert.enabled : !alert.enabled));
  alertList.setAttribute("aria-busy", "false");
  if (!alerts.length) {
    const empty = document.createElement("div");
    empty.className = "signal-empty-state";
    empty.innerHTML = "<strong>No alerts in this view</strong><span>Create a rule or choose a different filter.</span>";
    alertList.append(empty);
    return;
  }
  alerts.forEach((alert) => {
    const coin = state.coinMap.get(alert.coin_id);
    const row = document.createElement("article");
    row.className = "signal-alert-row";
    row.dataset.alertId = alert.id;

    const asset = document.createElement("div");
    asset.className = "signal-alert-asset";
    if (coin?.image) {
      const image = document.createElement("img");
      image.src = coin.image;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      asset.append(image);
    }
    const identity = document.createElement("span");
    addText(identity, "strong", "", coin?.name || alert.coin_id);
    addText(identity, "small", "", coin?.symbol || alert.coin_id);
    asset.append(identity);

    const condition = document.createElement("div");
    addText(condition, "strong", "", conditionText(alert));
    addText(condition, "small", "", `Created ${formatDate(alert.created_at, false)}`);

    const current = document.createElement("div");
    current.dataset.alertCurrent = alert.coin_id;
    addText(current, "strong", "", alert.alert_type === "price" ? safePrice(coin?.price) : formatChangePercent(coin?.change));
    if (alert.alert_type === "price" && Number.isFinite(coin?.price)) {
      const distance = ((Number(alert.threshold) - coin.price) / coin.price) * 100;
      const conditionMet = alert.direction === "above" ? coin.price >= Number(alert.threshold) : coin.price <= Number(alert.threshold);
      addText(current, "small", "", `${Math.abs(distance).toFixed(2)}% ${conditionMet ? "past target" : "away"}`);
    } else addText(current, "small", "", "Live market value");

    const status = document.createElement("span");
    status.className = `signal-status ${alert.enabled ? "is-active" : "is-paused"}`;
    status.textContent = alert.enabled ? "Active" : "Paused";
    const triggered = document.createElement("time");
    triggered.dateTime = alert.last_triggered_at || "";
    triggered.textContent = formatDate(alert.last_triggered_at);

    const actions = document.createElement("div");
    actions.className = "signal-alert-actions";
    const editButton = addText(actions, "button", "", "Edit");
    editButton.type = "button";
    const toggleButton = addText(actions, "button", "", alert.enabled ? "Pause" : "Enable");
    toggleButton.type = "button";
    const deleteButton = addText(actions, "button", "is-delete", "Delete");
    deleteButton.type = "button";

    const editForm = document.createElement("form");
    editForm.className = "signal-edit-form";
    editForm.hidden = true;
    editForm.innerHTML = `<label>Condition<select name="direction"><option value="above">At or above</option><option value="below">At or below</option></select></label><label>Threshold<input name="threshold" type="number" step="any" required></label><button type="submit">Save changes</button><button type="button" data-cancel-edit>Cancel</button><p role="status"></p>`;
    editForm.elements.direction.value = alert.direction;
    editForm.elements.threshold.value = Number(alert.threshold);
    editForm.elements.threshold.min = alert.alert_type === "price" ? "0.000000000001" : "-100";
    if (alert.alert_type === "percentage") editForm.elements.threshold.max = "100";

    editButton.addEventListener("click", () => { editForm.hidden = !editForm.hidden; if (!editForm.hidden) editForm.elements.direction.focus(); });
    editForm.querySelector("[data-cancel-edit]").addEventListener("click", () => { editForm.hidden = true; });
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = editForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api(`/api/alerts/${alert.id}`, json("PATCH", { direction: editForm.elements.direction.value, threshold: Number(editForm.elements.threshold.value) }));
        await loadAlerts();
      } catch (error) { editForm.querySelector("p").textContent = error.message; }
      finally { button.disabled = false; }
    });
    toggleButton.addEventListener("click", async () => {
      toggleButton.disabled = true;
      try { await api(`/api/alerts/${alert.id}`, json("PATCH", { enabled: !alert.enabled })); await loadAlerts(); }
      catch (error) { setFeedback(error.message, "error"); toggleButton.disabled = false; }
    });
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`Delete the ${coin?.symbol || alert.coin_id} alert? This cannot be undone.`)) return;
      deleteButton.disabled = true;
      try { await api(`/api/alerts/${alert.id}`, { method: "DELETE" }); await loadAlerts(); }
      catch (error) { setFeedback(error.message, "error"); deleteButton.disabled = false; }
    });

    row.append(asset, condition, current, status, triggered, actions, editForm);
    alertList.append(row);
  });
}

function renderNotifications() {
  notificationList.replaceChildren();
  notificationList.setAttribute("aria-busy", "false");
  const notifications = state.notifications.filter((item) => item.notification_type === "market_alert");
  if (!notifications.length) {
    const empty = document.createElement("div");
    empty.className = "signal-empty-state";
    empty.innerHTML = "<strong>No alert activity yet</strong><span>Triggered alerts will appear here using real notification records.</span>";
    notificationList.append(empty);
    return;
  }
  notifications.forEach((notification) => {
    const row = document.createElement("article");
    row.className = `signal-activity-row${notification.is_read ? "" : " is-unread"}`;
    const marker = document.createElement("span");
    marker.className = "signal-activity-marker";
    marker.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    addText(content, "strong", "", notification.message);
    const details = notification.payload || {};
    const observed = ["price", "price_movement", "unusual_volume", "breakout"].includes(details.alertType)
      ? safePrice(details.observedValue)
      : formatChangePercent(details.observedValue);
    addText(content, "small", "", `${details.coinId || "Market alert"}${details.observedValue !== undefined ? ` · Observed ${observed}` : ""} · ${formatDate(notification.created_at)}`);
    row.append(marker, content);
    if (!notification.is_read) {
      const button = addText(row, "button", "", "Mark read");
      button.type = "button";
      button.addEventListener("click", async () => { await api(`/api/notifications/${notification.id}/read`, json("PUT", {})); await loadNotifications(); });
    }
    notificationList.append(row);
  });
}

function updateLiveAlertValues(updatedCoinIds) {
  alertList.querySelectorAll("[data-alert-current]").forEach((current) => {
    const coinId = current.dataset.alertCurrent;
    if (!updatedCoinIds.has(coinId)) return;
    const row = current.closest("[data-alert-id]");
    const alert = state.alerts.find((item) => item.id === row?.dataset.alertId);
    const coin = state.coinMap.get(coinId);
    if (!alert || !coin) return;
    current.querySelector("strong").textContent = alert.alert_type === "price" ? safePrice(coin.price) : formatChangePercent(coin.change);
    const context = current.querySelector("small");
    if (alert.alert_type === "price" && Number.isFinite(coin.price)) {
      const distance = ((Number(alert.threshold) - coin.price) / coin.price) * 100;
      const conditionMet = alert.direction === "above" ? coin.price >= Number(alert.threshold) : coin.price <= Number(alert.threshold);
      context.textContent = `${Math.abs(distance).toFixed(2)}% ${conditionMet ? "past target" : "away"}`;
    } else context.textContent = "Live market value";
  });
}

async function loadAlerts() {
  state.alerts = (await api("/api/alerts")).alerts;
  renderAlerts();
  renderMetrics();
}

async function loadNotifications() {
  state.notifications = (await api("/api/notifications")).notifications;
  renderNotifications();
  renderMetrics();
}

async function loadSignals() {
  try {
    const [markets, alerts, notifications, preferences, telegram] = await Promise.all([
      api("/api/markets"), api("/api/alerts"), api("/api/notifications"), api("/api/preferences"), api("/api/telegram"),
    ]);
    state.coins = markets.map(normalizeCoin).filter((coin) => coin.id && coin.name);
    state.coinMap = new Map(state.coins.map((coin) => [coin.id, coin]));
    state.alerts = alerts.alerts;
    state.notifications = notifications.notifications;
    state.preferences = preferences.preferences;
    state.telegram = telegram.telegram;
    state.telegramCsrfToken = telegram.csrfToken;
    form.elements.emailAlerts.checked = state.preferences.emailAlerts;
    renderMarketFeedPreferences();
    renderTelegramState();
    renderAlerts();
    renderNotifications();
    renderMetrics();
  } catch (error) {
    if (error.status === 401) return window.location.assign("/login");
    setFeedback(error.message, "error");
    alertList.setAttribute("aria-busy", "false");
    notificationList.setAttribute("aria-busy", "false");
  }
}

assetSearch.addEventListener("input", () => {
  const exact = findCoin(assetSearch.value);
  if (!exact || ![exact.id, exact.name.toLowerCase(), exact.symbol.toLowerCase()].includes(assetSearch.value.trim().toLowerCase())) {
    state.selectedCoinId = "";
    assetId.value = "";
    renderSelectedAsset();
  }
  renderAssetOptions();
  updateSummary();
});
assetSearch.addEventListener("focus", renderAssetOptions);
assetSearch.addEventListener("keydown", (event) => {
  const options = [...assetOptions.querySelectorAll('[role="option"]')];
  if (event.key === "ArrowDown") { event.preventDefault(); setActiveAssetOption(activeAssetOption + 1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); setActiveAssetOption(activeAssetOption - 1); }
  else if (event.key === "Enter") {
    if (!assetOptions.hidden) event.preventDefault();
    const id = options[activeAssetOption]?.dataset.coinId;
    selectCoin(state.coinMap.get(id) || findCoin(assetSearch.value));
  } else if (event.key === "Escape") closeAssetOptions();
});
document.addEventListener("pointerdown", (event) => { if (!event.target.closest(".signal-asset-picker")) closeAssetOptions(); });
form.querySelectorAll('[name="alertType"]').forEach((input) => input.addEventListener("change", updateAlertType));
threshold.addEventListener("input", updateSummary);
direction.addEventListener("change", updateSummary);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const coin = state.coinMap.get(state.selectedCoinId);
  const value = Number(threshold.value);
  if (!coin) {
    document.querySelector("[data-asset-error]").textContent = "Choose a cryptocurrency from the search results.";
    assetSearch.focus();
    return;
  }
  if (!Number.isFinite(value) || (currentAlertType() === "price" ? value <= 0 : value < -100 || value > 100)) {
    threshold.setAttribute("aria-invalid", "true");
    threshold.focus();
    return setFeedback("Enter a threshold within the supported range.", "error");
  }
  threshold.removeAttribute("aria-invalid");
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  setFeedback("Creating alert…");
  try {
    const emailAlerts = form.elements.emailAlerts.checked;
    if (emailAlerts !== state.preferences.emailAlerts) {
      const response = await api("/api/preferences", json("PUT", { theme: state.preferences.theme, emailAlerts }));
      state.preferences = response.preferences;
    }
    const telegramAlerts = form.elements.telegramAlerts.checked;
    if (telegramAlerts !== state.telegram.enabled) {
      await api("/api/telegram/preferences", telegramJson("PUT", { enabled: telegramAlerts }));
      state.telegram.enabled = telegramAlerts;
    }
    await api("/api/alerts", json("POST", { coinId: coin.id, alertType: currentAlertType(), direction: direction.value, threshold: value }));
    const emailState = form.elements.emailAlerts.checked;
    form.reset();
    form.elements.emailAlerts.checked = emailState;
    state.selectedCoinId = "";
    assetId.value = "";
    renderSelectedAsset();
    updateAlertType();
    setFeedback("Alert created successfully.", "success");
    await loadAlerts();
  } catch (error) { setFeedback(error.message, "error"); }
  finally { button.disabled = false; }
});

document.querySelectorAll("[data-alert-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.alertFilter;
    document.querySelectorAll("[data-alert-filter]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderAlerts();
  });
});

document.querySelector("[data-open-alert]").addEventListener("click", () => {
  document.getElementById("createAlert").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  assetSearch.focus({ preventScroll: true });
});

marketFeedForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = document.querySelector("[data-market-feed-feedback]");
  const button = marketFeedForm.querySelector('button[type="submit"]');
  button.disabled = true;
  feedback.textContent = "Saving market-feed preferences…";
  try {
    const response = await api("/api/preferences", json("PUT", {
      marketPriceMovements: marketFeedForm.elements.marketPriceMovements.checked,
      marketUnusualVolume: marketFeedForm.elements.marketUnusualVolume.checked,
      marketBreakouts: marketFeedForm.elements.marketBreakouts.checked,
    }));
    state.preferences = response.preferences;
    renderMarketFeedPreferences();
    feedback.textContent = "Automatic market-feed preferences saved.";
  } catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; }
});

headerSearch.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const coin = findCoin(headerSearch.value);
  if (!coin) return;
  event.preventDefault();
  selectCoin(coin);
  document.getElementById("createAlert").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  assetSearch.focus({ preventScroll: true });
});

const telegramFeedback = document.querySelector("[data-telegram-feedback]");
document.querySelector("[data-telegram-link]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  telegramFeedback.textContent = "Creating a secure Telegram link…";
  try {
    const result = await api("/api/telegram/link-token", telegramJson("POST", {}));
    const instructions = document.querySelector("[data-telegram-instructions]");
    instructions.replaceChildren();
    const text = document.createElement("p");
    text.textContent = `This one-time link expires at ${formatDate(result.expiresAt)}.`;
    instructions.append(text);
    if (result.startUrl) {
      const link = document.createElement("a");
      link.href = result.startUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open the CoinDash bot →";
      instructions.append(link);
    }
    instructions.hidden = false;
    telegramFeedback.textContent = result.instructions;
  } catch (error) { telegramFeedback.textContent = error.message; }
  finally { button.disabled = false; }
});

document.querySelector("[data-telegram-refresh]").addEventListener("click", async () => {
  telegramFeedback.textContent = "Refreshing verified state…";
  try {
    await loadTelegram();
    telegramFeedback.textContent = state.telegram.linked ? "Telegram connection verified." : "Telegram is not linked yet.";
  } catch (error) { telegramFeedback.textContent = error.message; }
});

document.querySelector("[data-telegram-unlink]").addEventListener("click", async () => {
  if (!window.confirm("Unlink Telegram? Queued Telegram alerts will be cancelled.")) return;
  telegramFeedback.textContent = "Unlinking Telegram…";
  try {
    await api("/api/telegram/link", { method: "DELETE", headers: { "X-CoinTrack-CSRF": state.telegramCsrfToken } });
    await loadTelegram();
    telegramFeedback.textContent = "Telegram has been unlinked. In-app alert history was kept.";
  } catch (error) { telegramFeedback.textContent = error.message; }
});

form.elements.telegramAlerts.addEventListener("change", async () => {
  const enabled = form.elements.telegramAlerts.checked;
  form.elements.telegramAlerts.disabled = true;
  try {
    await api("/api/telegram/preferences", telegramJson("PUT", { enabled }));
    state.telegram.enabled = enabled;
    renderTelegramState();
  } catch (error) {
    telegramFeedback.textContent = error.message;
    form.elements.telegramAlerts.checked = state.telegram.enabled;
    renderTelegramState();
  }
});

connectMarketSocket((data) => {
  if (data.type !== "market_update" || !Array.isArray(data.coins)) return;
  const alertCoinIds = new Set(state.alerts.map((alert) => alert.coin_id));
  const updatedCoinIds = new Set();
  data.coins.forEach((update) => {
    const coin = state.coinMap.get(update.id);
    if (!coin) return;
    if (Number.isFinite(update.price)) coin.price = update.price;
    if (Number.isFinite(update.change)) coin.change = update.change;
    if (alertCoinIds.has(update.id)) updatedCoinIds.add(update.id);
  });
  if (state.selectedCoinId && state.coinMap.has(state.selectedCoinId)) renderSelectedAsset();
  if (updatedCoinIds.size) updateLiveAlertValues(updatedCoinIds);
});

updateAlertType();
loadSignals();
