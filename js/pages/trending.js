import { connectMarketSocket } from "../services/market-socket.js";
import { clearChart, loadChart, updateLiveChart } from "../charts/market-chart.js";
import { createFavoriteButton } from "../ui/watchlist-control.js";
import {
  calculateRankChanges,
  createTrendingSnapshot,
  filterTrendingCategories,
  isTrendingSnapshotUsable,
  normalizeTrendingApiPayload,
  shouldApplyTrendingResponse,
} from "./trending-data.mjs";

const trendingContainer = document.getElementById("trendingCoins");
const trendingCategoriesContainer = document.getElementById("trendingCategories");
const trendingCategoryFilters = document.getElementById("trendingCategoryFilters");
const trendingMomentumContainer = document.getElementById("trendingMomentum");
const trendingChartPanel = document.getElementById("trendingCoinDetails");
const trendingChartName = document.getElementById("trendingChartName");
const trendingChartSymbol = document.getElementById("trendingChartSymbol");
const trendingChartPrice = document.getElementById("trendingChartPrice");
const trendingChartChange = document.getElementById("trendingChartChange");
const closeTrendingChartButton = document.getElementById("closeTrendingChart");
const refreshTrendingButton = document.getElementById("refreshTrending");
const trendingDataStatus = document.getElementById("trendingDataStatus");
const trendingLastUpdated = document.getElementById("trendingLastUpdated");
const trendingListStatus = document.getElementById("trendingListStatus");
const trendingCoinMap = new Map();
const TRENDING_SNAPSHOT_KEY = "cointrack.trending-rank-snapshot.v2";

let selectedTrendingCoin = null;
let selectedTrendingCard = null;
let selectedTrendingTimeframe = { days: 1 };
let selectedCategoryId = "all";
let currentCategories = [];
let activeRequestId = 0;
let activeRequestController = null;

function readPreviousTrendingSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(TRENDING_SNAPSHOT_KEY));
    return snapshot && typeof snapshot === "object" ? snapshot : null;
  } catch {
    return null;
  }
}

function saveTrendingSnapshot(snapshot) {
  if (!snapshot) return;
  try {
    localStorage.setItem(TRENDING_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Rank history remains optional when local storage is unavailable.
  }
}

function formatObservationTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function setDataStatus(state, message, fetchedAt = null) {
  trendingDataStatus.dataset.state = state;
  trendingDataStatus.querySelector("strong").textContent = message;
  trendingLastUpdated.textContent = fetchedAt
    ? `Updated ${formatObservationTime(fetchedAt)}`
    : "Update time unavailable";
  trendingLastUpdated.dateTime = fetchedAt || "";
}

function setRefreshing(isRefreshing) {
  refreshTrendingButton.disabled = isRefreshing;
  refreshTrendingButton.classList.toggle("is-loading", isRefreshing);
  refreshTrendingButton.setAttribute("aria-busy", String(isRefreshing));
}

function showTrendingMessage(message, className = "trending-message") {
  const status = document.createElement("p");
  status.className = className;
  status.textContent = message;
  trendingContainer.replaceChildren(status);
}

function formatTrendingPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Price unavailable";
  }
  const numericPrice = Number(value);
  const magnitude = Math.abs(numericPrice);
  const options = magnitude >= 1
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : magnitude >= 0.01
      ? { maximumFractionDigits: 4 }
      : magnitude >= 0.0001
        ? { maximumFractionDigits: 6 }
        : { minimumSignificantDigits: 2, maximumSignificantDigits: 5 };
  return `$${numericPrice.toLocaleString("en-US", options)}`;
}

function formatTrendingLargeNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Unavailable";
  const numericValue = Number(value);
  if (numericValue >= 1e12) return `$${(numericValue / 1e12).toFixed(2)}T`;
  if (numericValue >= 1e9) return `$${(numericValue / 1e9).toFixed(2)}B`;
  if (numericValue >= 1e6) return `$${(numericValue / 1e6).toFixed(2)}M`;
  if (numericValue >= 1e3) return `$${(numericValue / 1e3).toFixed(2)}K`;
  return `$${numericValue.toLocaleString("en-US")}`;
}

function updateTrendingChartQuote(coin) {
  trendingChartPrice.textContent = formatTrendingPrice(coin.price);
  trendingChartChange.textContent = coin.change24h === null
    ? "24h —"
    : `24h ${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(2)}%`;
  trendingChartChange.classList.toggle("positive", coin.change24h !== null && coin.change24h >= 0);
  trendingChartChange.classList.toggle("negative", coin.change24h !== null && coin.change24h < 0);
}

function showTrendingCoinChart(coin, card) {
  selectedTrendingCard?.setAttribute("aria-expanded", "false");
  selectedTrendingCoin = coin;
  selectedTrendingCard = card;
  selectedTrendingCard.setAttribute("aria-expanded", "true");
  trendingChartSymbol.textContent = `${(coin.symbol || "—").toUpperCase()} · TRENDING #${coin.trendingRank ?? "—"}`;
  trendingChartName.textContent = `${coin.name || "Cryptocurrency"} chart`;
  updateTrendingChartQuote(coin);
  trendingChartPanel.style.display = "block";
  trendingChartPanel.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
  loadChart(coin, selectedTrendingTimeframe);
}

function closeTrendingCoinChart() {
  trendingChartPanel.style.display = "none";
  selectedTrendingCard?.setAttribute("aria-expanded", "false");
  selectedTrendingCard = null;
  selectedTrendingCoin = null;
  clearChart();
}

document.querySelectorAll(".trending-chart-details .chart-range").forEach((button) => {
  button.addEventListener("click", () => {
    selectedTrendingTimeframe = button.dataset.interval
      ? { interval: button.dataset.interval }
      : { days: Number(button.dataset.days) };
    document.querySelectorAll(".trending-chart-details .chart-range").forEach((rangeButton) => {
      rangeButton.classList.toggle("active", rangeButton === button);
    });
    if (selectedTrendingCoin) loadChart(selectedTrendingCoin, selectedTrendingTimeframe);
  });
});

closeTrendingChartButton.addEventListener("click", closeTrendingCoinChart);

function appendMomentumMovementNote(container, momentum) {
  const parts = [];
  if (momentum.newCount) parts.push(`${momentum.newCount} new`);
  if (momentum.exitedCount) parts.push(`${momentum.exitedCount} left the list`);
  if (momentum.observedAt) parts.push(`previous observation ${formatObservationTime(momentum.observedAt)}`);
  if (!parts.length) return;
  const note = document.createElement("p");
  note.className = "trending-momentum-note";
  note.textContent = parts.join(" · ");
  container.append(note);
}

function renderTrendingMomentum(momentum, emptyMessage = "A rank comparison will appear after the provider publishes a newer snapshot.") {
  trendingMomentumContainer.replaceChildren();
  trendingMomentumContainer.setAttribute("aria-busy", "false");
  const message = document.createElement("p");
  message.className = "trending-momentum-message";
  if (!momentum || !momentum.compared) {
    message.textContent = emptyMessage;
    trendingMomentumContainer.append(message);
    return;
  }

  const { rising, stable, cooling } = momentum.counts;
  message.textContent = `${momentum.compared} coins matched the previous observation.`;
  const summary = document.createElement("div");
  summary.className = "trending-momentum-summary";
  [
    { key: "rising", label: "Rank improved", icon: "↑", count: rising },
    { key: "stable", label: "Unchanged", icon: "→", count: stable },
    { key: "cooling", label: "Rank declined", icon: "↓", count: cooling },
  ].forEach((item) => {
    const stat = document.createElement("div");
    stat.className = `trending-momentum-stat ${item.key}`;
    const label = document.createElement("span");
    label.textContent = `${item.icon} ${item.label}`;
    const count = document.createElement("strong");
    count.textContent = item.count.toLocaleString("en-US");
    stat.append(label, count);
    summary.append(stat);
  });
  trendingMomentumContainer.append(message, summary);
  appendMomentumMovementNote(trendingMomentumContainer, momentum);

  if (momentum.movers.length) {
    const movers = document.createElement("div");
    movers.className = "trending-momentum-movers";
    const heading = document.createElement("h3");
    heading.textContent = "Largest observed rank changes";
    movers.append(heading);
    momentum.movers.forEach((coin) => {
      const mover = document.createElement("p");
      mover.className = `trending-momentum-mover ${coin.status}`;
      const direction = document.createElement("span");
      direction.setAttribute("aria-hidden", "true");
      direction.textContent = coin.status === "rising" ? "↑" : "↓";
      const name = document.createElement("span");
      name.className = "trending-momentum-mover-name";
      name.textContent = coin.name || coin.symbol || coin.id;
      const ranks = document.createElement("span");
      ranks.textContent = `#${coin.previousRank} → #${coin.trendingRank}`;
      mover.append(direction, name, ranks);
      movers.append(mover);
    });
    trendingMomentumContainer.append(movers);
  }
}

function renderCategoryFilters(categories) {
  trendingCategoryFilters.replaceChildren();
  const options = [{ id: "all", name: "All themes" }, ...categories];
  if (selectedCategoryId !== "all" && !categories.some((category) => category.id === selectedCategoryId)) {
    selectedCategoryId = "all";
  }
  options.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.categoryId = category.id;
    button.textContent = category.name;
    const active = category.id === selectedCategoryId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", () => {
      selectedCategoryId = category.id;
      renderCategoryFilters(currentCategories);
      renderTrendingCategories(currentCategories);
    });
    trendingCategoryFilters.append(button);
  });
}

function renderTrendingCategories(categories) {
  const rows = filterTrendingCategories(categories, selectedCategoryId);
  trendingCategoriesContainer.replaceChildren();
  trendingCategoriesContainer.setAttribute("aria-busy", "false");
  if (!rows.length) {
    const message = document.createElement("p");
    message.className = "trending-category-message";
    message.textContent = selectedCategoryId === "all"
      ? "No trending category data is available right now."
      : "This category is no longer present in the latest provider response.";
    trendingCategoriesContainer.append(message);
    return;
  }
  const largestCount = Math.max(...categories.map((category) => category.coinCount ?? 0), 1);
  const list = document.createElement("div");
  list.className = "trending-category-list";
  rows.forEach((category) => {
    const row = document.createElement("article");
    row.className = "trending-category-row";
    const rank = document.createElement("span");
    rank.className = "trending-category-rank";
    rank.textContent = `#${category.trendingRank}`;
    const details = document.createElement("div");
    details.className = "trending-category-details";
    const name = document.createElement("h3");
    name.textContent = category.name;
    const count = document.createElement("span");
    count.textContent = category.coinCount === null
      ? "Tracked coin count unavailable"
      : `${category.coinCount.toLocaleString("en-US")} coins tracked`;
    details.append(name, count);
    const bar = document.createElement("div");
    bar.className = "trending-category-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", count.textContent);
    const fill = document.createElement("span");
    fill.style.width = category.coinCount === null
      ? "0%"
      : `${Math.max((category.coinCount / largestCount) * 100, 2)}%`;
    bar.append(fill);
    const change = document.createElement("span");
    change.className = "trending-category-change";
    if (category.marketCapChange1h === null) {
      change.textContent = "—";
      change.setAttribute("aria-label", "One-hour category market-cap change unavailable");
    } else {
      const value = category.marketCapChange1h;
      change.classList.add(value >= 0 ? "positive" : "negative");
      change.textContent = `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
      change.setAttribute("aria-label", `${value.toFixed(2)}% category market-cap change in one hour`);
    }
    row.append(rank, details, bar, change);
    list.append(row);
  });
  trendingCategoriesContainer.append(list);
}

function createCoinIcon(coin) {
  const icon = document.createElement("div");
  icon.className = "coin-icon";
  const fallback = document.createElement("span");
  fallback.className = "trending-icon-fallback";
  fallback.textContent = (coin.symbol || coin.name || "?").slice(0, 1).toUpperCase();
  icon.append(fallback);
  if (coin.image) {
    const image = document.createElement("img");
    image.src = coin.image;
    image.alt = `${coin.name || "Cryptocurrency"} logo`;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("load", () => { fallback.hidden = true; }, { once: true });
    image.addEventListener("error", () => {
      fallback.hidden = false;
      image.remove();
    }, { once: true });
    icon.append(image);
  }
  return icon;
}

function renderTrendingCoins(coins, momentum) {
  trendingContainer.replaceChildren();
  if (!coins.length) {
    showTrendingMessage("No trending coins are available right now.");
    return;
  }
  const movementById = new Map((momentum?.movements ?? []).map((coin) => [coin.id, coin]));
  coins.forEach((coin) => {
    const card = document.createElement("article");
    card.className = "coin-card trending-card";
    card.dataset.coinId = coin.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${coin.name || coin.symbol || "coin"} details and chart`);
    card.setAttribute("aria-expanded", "false");
    card.setAttribute("aria-controls", "trendingCoinDetails");
    card.addEventListener("click", () => showTrendingCoinChart(coin, card));
    card.addEventListener("keydown", (event) => {
      if (event.target.closest(".watchlist-favorite") || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      showTrendingCoinChart(coin, card);
    });

    const rankCell = document.createElement("div");
    rankCell.className = "trending-rank-cell";
    const rank = document.createElement("span");
    rank.className = "trending-rank";
    rank.textContent = coin.trendingRank === null ? "—" : `#${coin.trendingRank}`;
    rank.title = coin.trendingRank === null ? "Provider rank unavailable" : "CoinGecko trending search-interest rank";
    rankCell.append(rank);
    const movement = movementById.get(coin.id);
    if (movement?.rankMovement) {
      const change = document.createElement("small");
      change.className = movement.rankMovement > 0 ? "rank-up" : "rank-down";
      change.textContent = `${movement.rankMovement > 0 ? "↑" : "↓"}${Math.abs(movement.rankMovement)}`;
      rankCell.append(change);
    }
    card.append(rankCell, createFavoriteButton(coin));

    const header = document.createElement("div");
    header.className = "coin-header";
    const identity = document.createElement("div");
    const identityLine = document.createElement("div");
    identityLine.className = "trending-identity-line";
    const name = document.createElement("h3");
    name.textContent = coin.name || "Unknown coin";
    name.title = name.textContent;
    const symbol = document.createElement("p");
    symbol.textContent = (coin.symbol || "—").toUpperCase();
    identityLine.append(name, symbol);
    identity.append(identityLine);
    header.append(createCoinIcon(coin), identity);
    card.append(header);

    const price = document.createElement("div");
    price.className = "coin-price";
    const priceValue = document.createElement("h2");
    priceValue.className = "trending-price-value";
    priceValue.textContent = formatTrendingPrice(coin.price);
    const changeValue = document.createElement("span");
    changeValue.className = "trending-change-value";
    if (coin.change24h === null) {
      changeValue.textContent = "—";
      changeValue.setAttribute("aria-label", "24-hour change unavailable");
    } else {
      changeValue.classList.add(coin.change24h >= 0 ? "positive" : "negative");
      changeValue.textContent = `${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(2)}%`;
    }
    price.append(priceValue, changeValue);
    card.append(price);

    const stats = document.createElement("div");
    stats.className = "trending-stats";
    const marketCap = document.createElement("div");
    const marketCapValue = document.createElement("strong");
    marketCapValue.className = "trending-market-cap-value";
    marketCapValue.textContent = formatTrendingLargeNumber(coin.marketCap);
    marketCap.append(marketCapValue);
    const volume = document.createElement("div");
    const volumeValue = document.createElement("strong");
    volumeValue.className = "trending-volume-value";
    volumeValue.textContent = formatTrendingLargeNumber(coin.volume24h);
    volume.append(volumeValue);
    stats.append(marketCap, volume);
    card.append(stats);
    trendingContainer.append(card);
  });
}

function updateTrendingCards() {
  trendingContainer.querySelectorAll(".trending-card").forEach((card) => {
    const coin = trendingCoinMap.get(card.dataset.coinId);
    if (!coin) return;
    const price = card.querySelector(".trending-price-value");
    const change = card.querySelector(".trending-change-value");
    const cap = card.querySelector(".trending-market-cap-value");
    const volume = card.querySelector(".trending-volume-value");
    if (price) price.textContent = formatTrendingPrice(coin.price);
    if (change) {
      change.classList.remove("positive", "negative");
      if (coin.change24h === null) change.textContent = "—";
      else {
        change.classList.add(coin.change24h >= 0 ? "positive" : "negative");
        change.textContent = `${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(2)}%`;
      }
    }
    if (cap) cap.textContent = formatTrendingLargeNumber(coin.marketCap);
    if (volume) volume.textContent = formatTrendingLargeNumber(coin.volume24h);
  });
}

async function loadTrendingCoins({ force = false } = {}) {
  const requestId = ++activeRequestId;
  activeRequestController?.abort();
  activeRequestController = new AbortController();
  setRefreshing(true);
  setDataStatus("loading", force ? "Refreshing trending data" : "Loading trending data");
  trendingMomentumContainer.setAttribute("aria-busy", "true");
  trendingCategoriesContainer.setAttribute("aria-busy", "true");
  if (!trendingCoinMap.size) showTrendingMessage("Loading trending coins...");

  try {
    const response = await fetch(force ? "/api/trending?refresh=1" : "/api/trending", {
      signal: activeRequestController.signal,
    });
    if (!response.ok) throw new Error(`Trending request failed (${response.status})`);
    const payload = normalizeTrendingApiPayload(await response.json());
    if (!shouldApplyTrendingResponse(requestId, activeRequestId)) return;
    if (!payload.coins.length) throw new Error("The trending response contained no valid coins");

    const previousSnapshot = readPreviousTrendingSnapshot();
    const canCompare = isTrendingSnapshotUsable(previousSnapshot, payload.meta.fetchedAt);
    const momentum = canCompare ? calculateRankChanges(payload.coins, previousSnapshot) : null;
    renderTrendingMomentum(momentum);

    const nextSnapshot = createTrendingSnapshot(payload.coins, payload.meta.fetchedAt);
    if (!previousSnapshot || previousSnapshot.providerFetchedAt !== nextSnapshot?.providerFetchedAt) {
      saveTrendingSnapshot(nextSnapshot);
    }

    trendingCoinMap.clear();
    payload.coins.forEach((coin) => trendingCoinMap.set(coin.id, coin));
    currentCategories = payload.categories;
    renderTrendingCoins(payload.coins, momentum);
    renderCategoryFilters(currentCategories);
    renderTrendingCategories(currentCategories);

    const statusLabel = payload.meta.status === "fresh"
      ? "Fresh provider data"
      : payload.meta.status === "cached"
        ? "Cached provider data"
        : "Stale cached data";
    setDataStatus(payload.meta.status, statusLabel, payload.meta.fetchedAt);
  } catch (error) {
    if (error.name === "AbortError" || !shouldApplyTrendingResponse(requestId, activeRequestId)) return;
    console.error("Trending error:", error);
    setDataStatus(trendingCoinMap.size ? "stale" : "unavailable", trendingCoinMap.size
      ? "Refresh failed · showing current results"
      : "Trending data unavailable");
    if (!trendingCoinMap.size) {
      showTrendingMessage("Unable to load trending coins right now. Use Refresh to try again.");
      currentCategories = [];
      renderCategoryFilters([]);
      renderTrendingCategories([]);
      renderTrendingMomentum(null, "Rank history is unavailable because trending data could not be loaded.");
    }
  } finally {
    if (shouldApplyTrendingResponse(requestId, activeRequestId)) setRefreshing(false);
  }
}

refreshTrendingButton.addEventListener("click", () => loadTrendingCoins({ force: true }));

connectMarketSocket((data) => {
  if (data.type !== "market_update" || !Array.isArray(data.coins)) return;
  let hasChanges = false;
  data.coins.forEach((update) => {
    const coin = trendingCoinMap.get(update.id);
    if (!coin) return;
    const next = {
      price: update.price ?? null,
      change24h: update.change ?? null,
      marketCap: update.marketCap ?? null,
      volume24h: update.volume ?? null,
    };
    if (coin.price === next.price && coin.change24h === next.change24h && coin.marketCap === next.marketCap && coin.volume24h === next.volume24h) return;
    Object.assign(coin, next);
    if (selectedTrendingCoin?.id === coin.id) {
      updateTrendingChartQuote(coin);
      updateLiveChart(update);
    }
    hasChanges = true;
  });
  if (hasChanges) updateTrendingCards();
}, {
  onStatus(status) {
    const labels = {
      connecting: "CONNECTING",
      connected: "LIVE PRICES",
      reconnecting: "RECONNECTING",
      unavailable: "LIVE PRICES PAUSED",
    };
    trendingListStatus.lastChild.textContent = ` ${labels[status] ?? "LIVE PRICES"}`;
    trendingListStatus.classList.toggle("is-offline", ["reconnecting", "unavailable"].includes(status));
  },
});

loadTrendingCoins();
