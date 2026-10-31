import { connectMarketSocket } from "../services/market-socket.js";
import "../services/protected-page.js";
import { formatChangePercent, formatLargeNumber, formatPrice } from "../utils/formatters.js";
import {
  getWatchlist,
  loadWatchlist,
  subscribeWatchlist,
} from "../services/watchlist-store.js";
import { createFavoriteButton } from "../ui/watchlist-control.js";
import { clearChart, loadChart, updateLiveChart } from "../charts/market-chart.js";
import { isWatchlistNumber as isNumeric, selectWatchlistCoins, summarizeWatchlist } from "../utils/watchlist-view.js";

const container = document.getElementById("watchlistCoins");
const tableShell = document.querySelector("[data-watchlist-table]");
const emptyState = document.getElementById("emptyWatchlist");
const noResultsState = document.getElementById("watchlistNoResults");
const pageStatus = document.getElementById("watchlistStatus");
const searchInput = document.getElementById("watchlistSearch");
const sortSelect = document.getElementById("watchlistSort");
const filterButtons = [...document.querySelectorAll("[data-watchlist-filter]")];
const clearButtons = [...document.querySelectorAll("[data-watchlist-clear]")];
const countValue = document.querySelector("[data-watchlist-count]");
const countLabel = document.querySelector("[data-watchlist-count-label]");
const summaryCount = document.querySelector("[data-summary-count]");
const summaryGainers = document.querySelector("[data-summary-gainers]");
const summaryLosers = document.querySelector("[data-summary-losers]");
const marketStatus = document.querySelector("[data-market-status]");
const marketById = new Map();
const latestSocketUpdates = new Map();
let watchlistIds = getWatchlist();
let loading = true;
let loadError = "";
let authRequired = false;
let activeFilter = "all";
let selectedWatchlistCoin = null;
let selectedWatchlistCard = null;
let selectedWatchlistTimeframe = { days: 1 };
const chartPanel = document.getElementById("watchlistCoinDetails");
const chartName = document.getElementById("watchlistChartName");
const chartSymbol = document.getElementById("watchlistChartSymbol");
const chartPrice = document.getElementById("watchlistChartPrice");
const chartChange = document.getElementById("watchlistChartChange");

function changeLabel(value) {
  if (!isNumeric(value)) return "Unavailable";
  const number = Number(value);
  const indicator = number > 0 ? "↑" : number < 0 ? "↓" : "•";
  return `${indicator} ${formatChangePercent(number)}`;
}

function updateWatchlistChartQuote(coin) {
  chartPrice.textContent = isNumeric(coin.price) ? `$${formatPrice(Number(coin.price))}` : "Price unavailable";
  chartChange.textContent = `24h ${changeLabel(coin.change)}`;
  chartChange.classList.toggle("positive", isNumeric(coin.change) && Number(coin.change) >= 0);
  chartChange.classList.toggle("negative", isNumeric(coin.change) && Number(coin.change) < 0);
}

function showWatchlistCoinChart(coin, button) {
  selectedWatchlistCard?.setAttribute("aria-expanded", "false");
  if (selectedWatchlistCard) selectedWatchlistCard.textContent = "View chart";
  selectedWatchlistCoin = coin;
  selectedWatchlistCard = button;
  button.setAttribute("aria-expanded", "true");
  button.textContent = "Chart open";
  chartSymbol.textContent = (coin.symbol || "—").toUpperCase();
  chartName.textContent = `${coin.name || "Cryptocurrency"} chart`;
  updateWatchlistChartQuote(coin);
  chartPanel.style.display = "block";
  chartPanel.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
  clearChart();
  loadChart(coin, selectedWatchlistTimeframe);
}

function closeWatchlistCoinChart() {
  chartPanel.style.display = "none";
  selectedWatchlistCard?.setAttribute("aria-expanded", "false");
  if (selectedWatchlistCard) selectedWatchlistCard.textContent = "View chart";
  selectedWatchlistCard = null;
  selectedWatchlistCoin = null;
  clearChart();
}

document.getElementById("closeWatchlistChart").addEventListener("click", closeWatchlistCoinChart);

document.querySelectorAll(".watchlist-chart-details .chart-range").forEach((button) => {
  button.addEventListener("click", () => {
    selectedWatchlistTimeframe = button.dataset.interval
      ? { interval: button.dataset.interval }
      : { days: Number(button.dataset.days) };
    document
      .querySelectorAll(".watchlist-chart-details .chart-range")
      .forEach((rangeButton) => rangeButton.classList.toggle("active", rangeButton === button));
    if (selectedWatchlistCoin) loadChart(selectedWatchlistCoin, selectedWatchlistTimeframe);
  });
});

function coinForId(id) {
  return marketById.get(id) || {
    id,
    name: id,
    symbol: "",
    image: "",
    price: null,
    change: null,
    marketCap: null,
    volume: null,
    sparkline: null,
  };
}

function visibleCoins() {
  return selectWatchlistCoins(watchlistIds.map(coinForId), {
    query: searchInput.value,
    filter: activeFilter,
    sort: sortSelect.value,
  });
}

function updateSummary() {
  const count = loading ? null : watchlistIds.length;
  countValue.textContent = count === null ? "—" : String(count);
  countLabel.textContent = count === 1 ? "Tracked asset" : "Tracked assets";
  summaryCount.textContent = count === null ? "—" : String(count);

  if (loading || loadError || watchlistIds.length === 0) {
    summaryGainers.textContent = loading || loadError ? "—" : "0";
    summaryLosers.textContent = loading || loadError ? "—" : "0";
  } else {
    const coins = watchlistIds.map(coinForId);
    const summary = summarizeWatchlist(coins);
    summaryGainers.textContent = String(summary.gainers);
    summaryLosers.textContent = String(summary.losers);
  }

  marketStatus.textContent = loading
    ? "Loading saved assets…"
    : loadError
      ? "Market view unavailable"
      : watchlistIds.length === 0
        ? "No saved assets yet"
        : "Latest snapshot loaded · streaming updates apply when available";
}

function updateControls() {
  const hasFilters = searchInput.value.trim() !== "" || activeFilter !== "all" || sortSelect.value !== "name-asc";
  clearButtons.forEach((button) => { button.hidden = !hasFilters; });
  filterButtons.forEach((button) => {
    const active = button.dataset.watchlistFilter === activeFilter;
    button.setAttribute("aria-pressed", String(active));
  });
}

function showPageStatus(message, { error = false, authentication = false, retry = false } = {}) {
  pageStatus.replaceChildren();
  pageStatus.classList.toggle("is-error", error);
  if (!message) return;
  const copy = document.createElement("span");
  copy.textContent = message;
  pageStatus.append(copy);
  if (authentication) {
    const signIn = document.createElement("a");
    signIn.href = "/login";
    signIn.textContent = "Sign in";
    const signUp = document.createElement("a");
    signUp.href = "/signup";
    signUp.textContent = "Create account";
    pageStatus.append(signIn, signUp);
  } else if (retry) {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "Retry";
    retryButton.addEventListener("click", loadPageData);
    pageStatus.append(retryButton);
  }
}

function createIdentityCell(coin) {
  const cell = document.createElement("td");
  cell.className = "watchlist-asset-cell";
  cell.dataset.label = "Asset";
  const identity = document.createElement("div");
  identity.className = "watchlist-asset";
  const icon = document.createElement("span");
  icon.className = "watchlist-asset-icon";
  const fallback = document.createElement("span");
  fallback.className = "watchlist-icon-fallback";
  fallback.textContent = (coin.symbol || coin.name || "?").slice(0, 1).toUpperCase();
  fallback.setAttribute("aria-hidden", "true");
  icon.append(fallback);
  if (coin.image) {
    const image = document.createElement("img");
    image.src = coin.image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove(), { once: true });
    icon.append(image);
  }
  const copy = document.createElement("span");
  copy.className = "watchlist-asset-copy";
  const name = document.createElement("strong");
  name.textContent = coin.name;
  const symbol = document.createElement("small");
  symbol.textContent = coin.symbol || "Market data unavailable";
  copy.append(name, symbol);
  identity.append(icon, copy);
  cell.append(identity);
  return cell;
}

function createValueCell(label, value, className = "") {
  const cell = document.createElement("td");
  cell.className = `watchlist-numeric ${className}`.trim();
  cell.dataset.label = label;
  cell.textContent = value;
  return cell;
}

function createSparklineCell(coin) {
  const cell = document.createElement("td");
  cell.className = "watchlist-sparkline-cell";
  cell.dataset.label = "7d trend";
  const values = Array.isArray(coin.sparkline)
    ? coin.sparkline.map(Number).filter(Number.isFinite)
    : [];
  if (values.length < 2) {
    cell.textContent = "Unavailable";
    return cell;
  }

  const minimum = Math.min(...values);
  const range = Math.max(...values) - minimum || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 96;
    const y = 26 - ((value - minimum) / range) * 24;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 96 28");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${coin.name} seven-day price trend`);
  svg.classList.add(isNumeric(coin.change) && Number(coin.change) < 0 ? "is-down" : "is-up");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", points);
  svg.append(line);
  cell.append(svg);
  return cell;
}

function createRow(coin) {
  const row = document.createElement("tr");
  row.className = "watchlist-row";
  row.dataset.coinId = coin.id;
  if (selectedWatchlistCoin?.id === coin.id) row.classList.add("is-chart-open");
  row.append(createIdentityCell(coin));
  row.append(createValueCell("Price", isNumeric(coin.price) ? `$${formatPrice(Number(coin.price))}` : "Unavailable", "watchlist-price-value"));

  const change = createValueCell("24h change", changeLabel(coin.change), "coin-change-value");
  if (isNumeric(coin.change)) change.classList.add(Number(coin.change) >= 0 ? "positive" : "negative");
  row.append(change);
  row.append(createValueCell("24h volume", isNumeric(coin.volume) ? `$${formatLargeNumber(Number(coin.volume))}` : "Unavailable", "watchlist-volume-value"));
  row.append(createValueCell("Market cap", isNumeric(coin.marketCap) ? `$${formatLargeNumber(Number(coin.marketCap))}` : "Unavailable", "coin-market-cap-value"));
  row.append(createSparklineCell(coin));

  const actionsCell = document.createElement("td");
  actionsCell.className = "watchlist-actions-cell";
  actionsCell.dataset.label = "Actions";
  const actions = document.createElement("div");
  actions.className = "watchlist-row-actions";
  const chartButton = document.createElement("button");
  chartButton.className = "watchlist-chart-button";
  chartButton.type = "button";
  chartButton.textContent = selectedWatchlistCoin?.id === coin.id ? "Chart open" : "View chart";
  chartButton.setAttribute("aria-expanded", String(selectedWatchlistCoin?.id === coin.id));
  chartButton.setAttribute("aria-controls", "watchlistCoinDetails");
  chartButton.addEventListener("click", () => showWatchlistCoinChart(coin, chartButton));
  if (selectedWatchlistCoin?.id === coin.id) selectedWatchlistCard = chartButton;

  const removeButton = createFavoriteButton(coin);
  removeButton.classList.add("watchlist-remove-button");
  removeButton.textContent = "Remove";
  removeButton.title = "Remove from watchlist";
  actions.append(chartButton, removeButton);
  actionsCell.append(actions);
  row.append(actionsCell);
  return row;
}

function render() {
  if (selectedWatchlistCoin && !watchlistIds.includes(selectedWatchlistCoin.id)) closeWatchlistCoinChart();
  selectedWatchlistCard = null;
  container.replaceChildren();
  tableShell.hidden = true;
  emptyState.hidden = true;
  noResultsState.hidden = true;
  updateSummary();
  updateControls();

  if (loading) {
    tableShell.setAttribute("aria-busy", "true");
    showPageStatus("Loading your watchlist…");
    return;
  }
  tableShell.setAttribute("aria-busy", "false");

  if (loadError) {
    showPageStatus(loadError, { error: true, authentication: authRequired, retry: !authRequired });
    return;
  }

  showPageStatus("");
  if (watchlistIds.length === 0) {
    emptyState.hidden = false;
    return;
  }

  const coins = visibleCoins();
  if (coins.length === 0) {
    noResultsState.hidden = false;
    return;
  }

  container.append(...coins.map(createRow));
  tableShell.hidden = false;
}

async function loadMarkets() {
  try {
    const response = await fetch("/api/markets");
    if (!response.ok) throw new Error(`Market data request failed (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Market data response was invalid.");
    marketById.clear();
    data.forEach((item) => {
      if (!item?.id) return;
      marketById.set(item.id, {
        id: item.id,
        name: item.name,
        symbol: String(item.symbol || "").toUpperCase(),
        image: item.image,
        price: item.current_price,
        change: item.price_change_percentage_24h,
        marketCap: item.market_cap,
        volume: item.total_volume,
        sparkline: item.sparkline_in_7d?.price,
      });
    });
    latestSocketUpdates.forEach((update, id) => {
      const coin = marketById.get(id);
      if (!coin) return;
      coin.price = update.price;
      coin.change = update.change;
      coin.marketCap = update.marketCap;
      coin.volume = update.volume;
    });
  } catch (error) {
    console.error("Unable to load watchlist market data:", error);
    loadError = "Market data could not be loaded. Check your connection and try again.";
  } finally {
    loading = false;
    render();
  }
}

async function loadPageData() {
  loading = true;
  loadError = "";
  render();
  const result = await loadWatchlist();
  if (!result.ok) {
    loading = false;
    authRequired = result.error === "Sign in to view your watchlist.";
    loadError = result.error || "Your watchlist could not be loaded. Check the server connection and retry.";
    render();
    return;
  }
  authRequired = false;
  watchlistIds = getWatchlist();
  if (watchlistIds.length === 0) {
    loading = false;
    render();
    return;
  }
  await loadMarkets();
}

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);
filterButtons.forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.watchlistFilter;
  render();
}));
clearButtons.forEach((button) => button.addEventListener("click", () => {
  searchInput.value = "";
  sortSelect.value = "name-asc";
  activeFilter = "all";
  render();
  searchInput.focus();
}));

subscribeWatchlist((ids, state) => {
  watchlistIds = ids;
  authRequired = state.authRequired;
  if (!state.loaded && !state.loading && state.error && !loading) loadError = state.error;
  render();
});

connectMarketSocket((data) => {
  if (data.type !== "market_update" || !Array.isArray(data.coins)) return;
  let watchedUpdate = false;
  data.coins.forEach((update) => {
    if (!watchlistIds.includes(update.id)) return;
    watchedUpdate = true;
    latestSocketUpdates.set(update.id, update);
    const coin = marketById.get(update.id);
    if (coin) {
      coin.price = update.price;
      coin.change = update.change;
      coin.marketCap = update.marketCap;
      coin.volume = update.volume;
      if (selectedWatchlistCoin?.id === coin.id) {
        updateWatchlistChartQuote(coin);
        updateLiveChart(update);
      }
    }
  });
  if (!watchedUpdate) return;

  if (activeFilter !== "all" || sortSelect.value !== "name-asc") {
    render();
    return;
  }

  data.coins.forEach((update) => {
    const row = container.querySelector(`.watchlist-row[data-coin-id="${update.id}"]`);
    if (!row) return;
    const price = row.querySelector(".watchlist-price-value");
    const change = row.querySelector(".coin-change-value");
    const marketCap = row.querySelector(".coin-market-cap-value");
    const volume = row.querySelector(".watchlist-volume-value");
    if (price && isNumeric(update.price)) price.textContent = `$${formatPrice(Number(update.price))}`;
    if (change) {
      change.textContent = changeLabel(update.change);
      change.classList.toggle("positive", isNumeric(update.change) && Number(update.change) >= 0);
      change.classList.toggle("negative", isNumeric(update.change) && Number(update.change) < 0);
    }
    if (marketCap && isNumeric(update.marketCap)) marketCap.textContent = `$${formatLargeNumber(Number(update.marketCap))}`;
    if (volume && isNumeric(update.volume)) volume.textContent = `$${formatLargeNumber(Number(update.volume))}`;
  });
  updateSummary();
});

render();
loadPageData();
