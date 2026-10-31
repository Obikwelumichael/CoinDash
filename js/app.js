import {
  formatPrice,
  formatChangePercent,
  formatLargeNumber,
} from "./utils/formatters.js";
import { clearChart, loadChart, updateLiveChart } from "./charts/market-chart.js";
import { connectMarketSocket } from "./services/market-socket.js";
import { createFavoriteButton } from "./ui/watchlist-control.js";
import { createMarketHeatMap } from "./ui/market-heat-map.js";
import { createMarketMotion } from "./ui/market-motion.js";
import {
  displayCoins,
  displayCoinTable,
  updateCoinUI,
} from "./ui/coin-view.js";

let coins = [];
const latestSocketCoinData = new Map();

const searchInput = document.getElementById("searchInput");
const navSearch = document.getElementById("navSearch");
const navSearchToggle = document.getElementById("navSearchToggle");
const searchSuggestions = document.getElementById("searchSuggestions");
const clearSearchButton = document.getElementById("clearSearchButton");
const searchResultsStatus = document.getElementById("searchResultsStatus");
const searchResultsTerm = document.getElementById("searchResultsTerm");
const clearResultsSearch = document.getElementById("clearResultsSearch");
const marketTableSearchStatus = document.getElementById("marketTableSearchStatus");
const marketTableSearchTerm = document.getElementById("marketTableSearchTerm");
const clearMarketTableSearch = document.getElementById("clearMarketTableSearch");
const sortSelect = document.getElementById("sortSelect");
const marketFilterSelect = document.getElementById("marketFilterSelect");
const marketVisibleCount = document.getElementById("marketVisibleCount");
const coinTableBody = document.getElementById("coinTableBody");
const marketPageRefresh = document.getElementById("marketPageRefresh");
const marketConnectionStatus = document.getElementById("marketConnectionStatus");
const marketHeatMap = createMarketHeatMap({
  root: document.getElementById("marketHeatMap"),
  onRetry: fetchMarketData,
});
const marketMotion = createMarketMotion({ root: document.getElementById("marketMotion") });
const marketCapChange = document.getElementById("marketCapChange");
const volumeChange = document.getElementById("volumeChange");
const marketBreadthElements = {
  content: document.getElementById("marketBreadthContent"),
  total: document.getElementById("marketBreadthTotal"),
  advancing: document.getElementById("marketBreadthAdvancing"),
  declining: document.getElementById("marketBreadthDeclining"),
  unchanged: document.getElementById("marketBreadthUnchanged"),
  unavailable: document.getElementById("marketBreadthUnavailable"),
  bar: document.getElementById("marketBreadthBar"),
  advancingBar: document.getElementById("marketBreadthBarAdvancing"),
  decliningBar: document.getElementById("marketBreadthBarDeclining"),
  unchangedBar: document.getElementById("marketBreadthBarUnchanged"),
  summary: document.getElementById("marketBreadthSummary"),
};

const coinDetails = document.getElementById("coinDetails");

const detailsName = document.getElementById("detailsName");
const detailsSymbol = document.getElementById("detailsSymbol");
const detailsIcon = document.getElementById("detailsIcon");
detailsIcon.addEventListener("error", () => {
  detailsIcon.hidden = true;
});
const detailsPrice = document.getElementById("detailsPrice");
const detailsChange = document.getElementById("detailsChange");
const detailsMarketCap = document.getElementById("detailsMarketCap");
const detailsVolume = document.getElementById("detailsVolume");
const detailsHigh = document.getElementById("detailsHigh");
const detailsLow = document.getElementById("detailsLow");
const detailsWatchlistAction = document.getElementById("detailsWatchlistAction");

const pagination = document.getElementById("pagination");

const topGainersContainer = document.getElementById("topGainers");
const topLosersContainer = document.getElementById("topLosers");

let selectedRange = { days: 1 };
let selectedCoin = null;

let currentPage = 1;
const coinsPerPage = 20;
const isMarketPage = window.location.pathname === "/markets";
const homePreviewCount = 5;
let searchSuggestionCoins = [];
let activeSearchSuggestion = -1;
let additionalSearchCoins = [];
let additionalSearchTimer = null;
let additionalSearchRequest = 0;
let additionalSearchLoading = false;
let additionalSearchFailed = false;
let marketRequestInProgress = false;
let globalRequestInProgress = false;
let marketCache = null;
let marketLoadState = "loading";
let sortDirection = "asc";

function arraysEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function updateChangesCurrentOrder(changed) {
  if (marketFilterSelect?.value !== "all" && changed.change) return true;
  if (sortSelect.value === "default") return changed.rank;
  if (sortSelect.value === "price") return changed.price;
  if (sortSelect.value === "change") return changed.change;
  if (sortSelect.value === "change1h") return changed.change1h;
  if (sortSelect.value === "change7d") return changed.change7d;
  if (sortSelect.value === "marketCap") return changed.marketCap;
  if (sortSelect.value === "volume") return changed.volume;
  return false;
}

function getSortableMarketRank(value) {
  const rank = Number(value);
  return value !== null && value !== "" && Number.isFinite(rank) && rank > 0
    ? rank
    : Infinity;
}

function updateMarketConnectionStatus(state, detail = {}) {
  if (!marketConnectionStatus) return;
  const messages = {
    connecting: "Connecting to live updates…",
    connected: "Live updates connected",
    reconnecting: `Live feed reconnecting in ${Math.round((detail.retryDelay || 1000) / 1000)}s…`,
    unavailable: "Live feed unavailable; periodic refresh remains active",
  };
  marketConnectionStatus.dataset.state = state;
  marketConnectionStatus.lastChild.textContent = ` ${messages[state] || messages.connecting}`;
  marketMotion?.setConnectionState(state);
}

connectMarketSocket((data) => {
  if (data.type !== "market_update") return;

  let breadthChanged = false;
  let fullRenderNeeded = false;
  const pendingUiUpdates = [];
  data.coins.forEach((update) => {
    latestSocketCoinData.set(update.id, update);
    const coin = coins.find((item) => item.id === update.id);
    if (!coin) return;

    const changed = {
      price: coin.price !== update.price,
      change: coin.change !== update.change,
      marketCap: coin.marketCap !== update.marketCap,
      volume: coin.volume !== update.volume,
      change1h: coin.change1h !== update.change1h,
      change7d: coin.change7d !== update.change7d,
      rank: coin.rank !== update.rank,
      sparkline: !arraysEqual(coin.sparkline, update.sparkline),
    };
    if (!Object.values(changed).some(Boolean)) return;

    coin.price = update.price;
    coin.change = update.change;
    coin.price_change_percentage_24h = update.change;
    breadthChanged ||= changed.change;
    coin.marketCap = update.marketCap;
    coin.volume = update.volume;
    coin.change1h = update.change1h;
    coin.change7d = update.change7d;
    coin.rank = update.rank;
    coin.sparkline = update.sparkline;
    fullRenderNeeded ||= updateChangesCurrentOrder(changed);
    pendingUiUpdates.push({ update, changed });
    if (selectedCoin?.id === update.id) {
      if (changed.price) detailsPrice.textContent = `$${formatPrice(update.price)}`;
      if (changed.change) updateChange(detailsChange, update.change);
      updateLiveChart(update);
    }
  });

  if (fullRenderNeeded) {
    updateCoins();
  } else {
    pendingUiUpdates.forEach(({ update, changed }) => updateCoinUI(update, changed));
  }
  if (breadthChanged) {
    renderMarketBreadth();
    if (!fullRenderNeeded) renderMarketMovers();
  }
  marketMotion?.updateCoins(data.coins);
  marketHeatMap?.updateCoins(pendingUiUpdates.map(({ update }) => update));
}, { onStatus: updateMarketConnectionStatus });

const chartRangeButtons = document.querySelectorAll(".chart-range");
chartRangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedRange = button.dataset.interval
      ? { interval: button.dataset.interval }
      : { days: Number(button.dataset.days) };

    chartRangeButtons.forEach((btn) => {
      btn.classList.remove("active");
    });

    button.classList.add("active");

    console.log("Selected chart timeframe:", selectedRange);

    if (selectedCoin) {
      loadChart(selectedCoin, selectedRange);
    }
  });
});
const closeDetails = document.getElementById("closeDetails");

// coin details
function updateDetailsIdentity({ name, symbol, image }) {
  detailsName.textContent = name;
  detailsSymbol.textContent = `${symbol.toUpperCase()} · LIVE MARKET`;
  if (image) {
    detailsIcon.src = image;
    detailsIcon.alt = `${name} logo`;
    detailsIcon.hidden = false;
  } else {
    detailsIcon.removeAttribute("src");
    detailsIcon.alt = "";
    detailsIcon.hidden = true;
  }
}

function showCoinDetails(coin) {
  selectedCoin = coin;
  updateDetailsIdentity(coin);
  detailsPrice.textContent = `$${formatPrice(coin.price)}`;
  updateChange(detailsChange, coin.change);
  detailsWatchlistAction.replaceChildren(
    createFavoriteButton(coin, { labeled: true }),
  );
  coinDetails.style.display = "block";
  coinDetails.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start",
  });

  fetch(`/api/coins/${coin.id}`)
    .then((response) => response.json())
    .then((data) => {
      if (selectedCoin?.id !== coin.id) return;
      const price = data.market_data.current_price.usd;
      const change = data.market_data.price_change_percentage_24h;
      const marketCap = data.market_data.market_cap.usd;
      const volume = data.market_data.total_volume.usd;
      const high24h = data.market_data.high_24h.usd;
      const low24h = data.market_data.low_24h.usd;

      updateDetailsIdentity({
        name: data.name,
        symbol: data.symbol,
        image: data.image?.small || coin.image,
      });

      detailsPrice.textContent = "$" + formatPrice(price);

      detailsMarketCap.textContent = "$" + formatLargeNumber(marketCap);

      detailsVolume.textContent = "$" + formatLargeNumber(volume);

      detailsHigh.textContent = "$" + formatPrice(high24h);

      detailsLow.textContent = "$" + formatPrice(low24h);

      updateChange(detailsChange, change);

    });

  loadChart(coin, selectedRange);
}

// displaying 20 tokens per page
function getPaginatedCoins(coinsToDisplay) {
  if (!isMarketPage) {
    const previewCoins = coinsToDisplay.slice(0, homePreviewCount);
    const isDefaultHomepagePreview =
      !searchInput.value.trim() && sortSelect.value === "default";
    const rippleIndex = previewCoins.findIndex((coin) => coin.id === "ripple");

    if (isDefaultHomepagePreview && rippleIndex !== -1) {
      const solana = coinsToDisplay.find((coin) => coin.id === "solana");
      if (solana) {
        previewCoins.splice(rippleIndex, 1);
        if (!previewCoins.some((coin) => coin.id === "solana")) {
          previewCoins.push(solana);
        } else {
          const nextCoin = coinsToDisplay
            .slice(homePreviewCount)
            .find(
              (coin) =>
                coin.id !== "ripple" &&
                !previewCoins.some((previewCoin) => previewCoin.id === coin.id),
            );
          if (nextCoin) previewCoins.push(nextCoin);
        }
      }
    }

    return previewCoins;
  }

  const startIndex = (currentPage - 1) * coinsPerPage;
  const endIndex = startIndex + coinsPerPage;

  return coinsToDisplay.slice(startIndex, endIndex);
}

function calculateMarketBreadth(marketCoins) {
  const counts = (Array.isArray(marketCoins) ? marketCoins : []).reduce(
    (result, coin) => {
      const change = coin?.price_change_percentage_24h;
      if (typeof change !== "number" || !Number.isFinite(change)) {
        result.unavailable += 1;
        return result;
      }

      if (change > 0) result.advancing += 1;
      else if (change < 0) result.declining += 1;
      else result.unchanged += 1;
      return result;
    },
    { advancing: 0, declining: 0, unchanged: 0, unavailable: 0 },
  );
  const measured = counts.advancing + counts.declining + counts.unchanged;
  const total = measured + counts.unavailable;

  return {
    ...counts,
    total,
    measured,
    advancingPercent: measured ? (counts.advancing / measured) * 100 : 0,
    decliningPercent: measured ? (counts.declining / measured) * 100 : 0,
    unchangedPercent: measured ? (counts.unchanged / measured) * 100 : 0,
  };
}

function renderMarketBreadth() {
  if (!marketBreadthElements.content) return;
  const breadth = calculateMarketBreadth(coins);
  marketBreadthElements.content.setAttribute("aria-busy", "false");

  if (!breadth.total) {
    marketBreadthElements.total.textContent = "Market data unavailable";
    marketBreadthElements.advancing.textContent = "—";
    marketBreadthElements.declining.textContent = "—";
    marketBreadthElements.unchanged.textContent = "—";
    marketBreadthElements.unavailable.textContent = "—";
    marketBreadthElements.summary.textContent = "Market breadth is unavailable.";
    marketBreadthElements.bar.setAttribute("aria-label", "Market breadth unavailable");
    marketBreadthElements.advancingBar.style.width = "0%";
    marketBreadthElements.decliningBar.style.width = "0%";
    marketBreadthElements.unchangedBar.style.width = "0%";
    return;
  }

  const number = new Intl.NumberFormat();
  marketBreadthElements.total.textContent = `${number.format(breadth.total)} TRACKED · 24H`;
  marketBreadthElements.advancing.textContent = number.format(breadth.advancing);
  marketBreadthElements.declining.textContent = number.format(breadth.declining);
  marketBreadthElements.unchanged.textContent = number.format(breadth.unchanged);
  marketBreadthElements.unavailable.textContent = number.format(breadth.unavailable);
  marketBreadthElements.advancingBar.style.width = `${breadth.advancingPercent}%`;
  marketBreadthElements.decliningBar.style.width = `${breadth.decliningPercent}%`;
  marketBreadthElements.unchangedBar.style.width = `${breadth.unchangedPercent}%`;
  marketBreadthElements.bar.setAttribute(
    "aria-label",
    `${breadth.advancingPercent.toFixed(1)}% advancing, ${breadth.decliningPercent.toFixed(1)}% declining, ${breadth.unchangedPercent.toFixed(1)}% unchanged`,
  );
  const direction = breadth.advancing > breadth.declining
    ? "Market is broadly positive."
    : breadth.declining > breadth.advancing
      ? "Market is broadly negative."
      : "Market is evenly mixed.";
  marketBreadthElements.summary.textContent = `${direction} ${breadth.advancingPercent.toFixed(1)}% of ${number.format(breadth.measured)} coins with 24h data are gaining.`;
}

// Rendering the 20 per pages view
function renderPagination(coinsToDisplay) {
  pagination.innerHTML = "";

  if (!isMarketPage) return;

  const totalPages = Math.ceil(coinsToDisplay.length / coinsPerPage);

  if (currentPage > totalPages) {
    currentPage = Math.max(1, totalPages);
  }

  if (totalPages <= 1) {
    return;
  }

  const appendPageButton = (page) => {
    const pageButton = document.createElement("button");
    pageButton.type = "button";
    pageButton.textContent = page;
    pageButton.setAttribute("aria-label", `Page ${page}`);

    if (page === currentPage) {
      pageButton.classList.add("active");
      pageButton.setAttribute("aria-current", "page");
    }

    pageButton.addEventListener("click", () => {
      currentPage = page;
      updateCoins();
    });
    pagination.appendChild(pageButton);
  };

  const appendEllipsis = () => {
    const ellipsis = document.createElement("span");
    ellipsis.className = "pagination-ellipsis";
    ellipsis.textContent = "…";
    ellipsis.setAttribute("aria-hidden", "true");
    pagination.appendChild(ellipsis);
  };

  const appendStepButton = (direction) => {
    const isPrevious = direction === "previous";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pagination-step";
    button.textContent = isPrevious ? "‹" : "›";
    button.setAttribute("aria-label", isPrevious ? "Previous page" : "Next page");
    button.title = isPrevious ? "Previous page" : "Next page";
    button.disabled = isPrevious ? currentPage === 1 : currentPage === totalPages;
    button.addEventListener("click", () => {
      currentPage += isPrevious ? -1 : 1;
      updateCoins();
    });
    pagination.appendChild(button);
  };

  appendStepButton("previous");

  let firstVisiblePage = Math.max(2, currentPage - 1);
  let lastVisiblePage = Math.min(totalPages - 1, currentPage + 1);
  if (currentPage <= 3) lastVisiblePage = Math.min(totalPages - 1, 4);
  if (currentPage >= totalPages - 2) firstVisiblePage = Math.max(2, totalPages - 3);

  appendPageButton(1);
  if (firstVisiblePage > 2) appendEllipsis();
  for (let page = firstVisiblePage; page <= lastVisiblePage; page += 1) {
    appendPageButton(page);
  }
  if (lastVisiblePage < totalPages - 1) appendEllipsis();
  appendPageButton(totalPages);

  appendStepButton("next");
}

if (isMarketPage) {
  document.body.classList.add("market-page");
  const heroSection = document.querySelector(".hero");
  const marketTableSection = document.querySelector(".market-table-section");
  const marketHeatMapSection = document.getElementById("marketHeatMap");
  const marketMoversSection = document.querySelector(".market-movers-section");
  const coinDetailsSection = document.getElementById("coinDetails");
  const btcDominanceSection = document.querySelector(".market-dominance-section");
  heroSection.insertAdjacentElement("afterend", marketTableSection);
  marketTableSection.insertAdjacentElement("afterend", marketHeatMapSection);
  marketHeatMapSection.insertAdjacentElement("afterend", marketMoversSection);
  marketMoversSection.insertAdjacentElement("afterend", coinDetailsSection);
  coinDetailsSection.insertAdjacentElement("afterend", btcDominanceSection);
  document.getElementById("marketTableToolbarSearch").append(navSearch);
  navSearch.classList.add("is-open", "market-table-search");
  navSearchToggle.setAttribute("aria-expanded", "true");

  document.querySelector('.nav-links a[href="/markets"]').setAttribute("aria-current", "page");
  document.querySelector("#markets .section-label").textContent = "MARKETS";
  document.querySelector("#markets h2").textContent = "All cryptocurrencies";
  document.querySelector("#markets .section-heading > a").hidden = true;
} else {
  (document.getElementById("marketMotion") ?? document.querySelector(".hero")).insertAdjacentElement(
    "afterend",
    document.getElementById("markets"),
  );
}

function getSortValue(coin, key) {
  if (key === "default") return getSortableMarketRank(coin.rank);
  if (coin[key] === null || coin[key] === undefined || coin[key] === "") return Number.NaN;
  return Number(coin[key]);
}

function compareMarketValues(left, right, key) {
  const leftValue = getSortValue(left, key);
  const rightValue = getSortValue(right, key);
  const leftValid = Number.isFinite(leftValue);
  const rightValid = Number.isFinite(rightValue);
  if (!leftValid && !rightValid) return 0;
  if (!leftValid) return 1;
  if (!rightValid) return -1;
  return (leftValue - rightValue) * (sortDirection === "asc" ? 1 : -1);
}

function updateSortIndicators() {
  document.querySelectorAll("[data-market-sort]").forEach((button) => {
    const selected = button.dataset.marketSort === sortSelect.value;
    const heading = button.closest("th");
    if (heading) heading.setAttribute("aria-sort", selected ? (sortDirection === "asc" ? "ascending" : "descending") : "none");
    button.querySelector("span").textContent = selected ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
    button.classList.toggle("active", selected);
  });
}

// to update the coins before any search of sort functions has been called
function updateCoins() {
  console.log("updateCoins() started");
  const searchTerm = searchInput.value.trim().toLowerCase();
  searchResultsStatus.hidden = !searchTerm;
  searchResultsTerm.textContent = searchTerm ? searchInput.value.trim() : "";
  marketTableSearchStatus.hidden = !isMarketPage || !searchTerm;
  marketTableSearchTerm.textContent = searchTerm ? searchInput.value.trim() : "";
  const searchableCoins = searchTerm
    ? [...new Map([...coins, ...additionalSearchCoins].map((coin) => [coin.id, coin])).values()]
    : coins;
  let visibleCoins = searchableCoins.filter((coin) => {
    return (
      coin.name.toLowerCase().includes(searchTerm) ||
      coin.symbol.toLowerCase().includes(searchTerm)
    );
  });

  if (marketFilterSelect?.value === "gainers") {
    visibleCoins = visibleCoins.filter((coin) => Number(coin.change) > 0);
  } else if (marketFilterSelect?.value === "losers") {
    visibleCoins = visibleCoins.filter((coin) => Number(coin.change) < 0);
  }

  visibleCoins = [...visibleCoins].sort((a, b) => compareMarketValues(a, b, sortSelect.value));

  if (isMarketPage) {
    currentPage = Math.min(
      currentPage,
      Math.max(1, Math.ceil(visibleCoins.length / coinsPerPage)),
    );
  }

  const paginatedCoins = getPaginatedCoins(visibleCoins);

  if (isMarketPage && marketVisibleCount) {
    const start = visibleCoins.length ? (currentPage - 1) * coinsPerPage + 1 : 0;
    const end = Math.min(currentPage * coinsPerPage, visibleCoins.length);
    const qualifier = searchTerm || marketFilterSelect?.value !== "all" ? " matching" : "";
    marketVisibleCount.textContent = visibleCoins.length
      ? `Showing ${start}–${end} of ${visibleCoins.length.toLocaleString()}${qualifier} assets`
      : marketLoadState === "loading" ? "Loading market data…" : "No matching assets";
  }
  updateSortIndicators();
  if (isMarketPage && !coins.length && marketLoadState !== "ready") {
    coinTableBody.innerHTML = `<tr class="market-loading-row"><td colspan="12">${marketLoadState === "error" ? "Market data is temporarily unavailable. Refresh to try again." : "Loading market data…"}</td></tr>`;
    pagination.replaceChildren();
    return;
  }
  if (!isMarketPage) displayCoins(paginatedCoins, showCoinDetails);
  displayCoinTable(
    paginatedCoins,
    isMarketPage ? showCoinDetails : undefined,
  );
  renderPagination(visibleCoins);
  renderMarketMovers();
}
// renderMarketMovers();

//Gainers & Losers
function renderMarketMovers() {
  if (!topGainersContainer || !topLosersContainer) {
    return;
  }

  const rankedMarketCoins = coins.filter((coin) => {
    const rank = Number(coin.rank);
    return Number.isFinite(rank) && rank > 0 && rank <= 100;
  });
  const moverUniverse = rankedMarketCoins.length ? rankedMarketCoins : coins;

  const gainers = moverUniverse
    .filter((coin) => Number(coin.change) > 0)
    .sort((a, b) => Number(b.change) - Number(a.change))
    .slice(0, 5);

  const losers = moverUniverse
    .filter((coin) => Number(coin.change) < 0)
    .sort((a, b) => Number(a.change) - Number(b.change))
    .slice(0, 5);

  topGainersContainer.replaceChildren();
  topLosersContainer.replaceChildren();

  gainers.forEach((coin) => {
    topGainersContainer.appendChild(createMarketMoverRow(coin, "gainer"));
  });

  losers.forEach((coin) => {
    topLosersContainer.appendChild(createMarketMoverRow(coin, "loser"));
  });
}

// gainers and losers data cell
function createMarketMoverRow(coin, type) {
  const row = document.createElement("button");

  row.className = `market-mover-row ${type}`;
  row.type = "button";
  row.setAttribute("aria-label", `Open ${coin.name || coin.symbol} market details`);
  row.addEventListener("click", () => showCoinDetails(coin));

  const coinInfo = document.createElement("div");

  coinInfo.className = "market-mover-coin";

  if (coin.image) {
    const image = document.createElement("img");

    image.src = coin.image;
    image.alt = coin.name || coin.symbol || "Crypto";
    image.loading = "lazy";
    image.decoding = "async";

    coinInfo.appendChild(image);
  }

  const nameWrapper = document.createElement("div");

  nameWrapper.className = "market-mover-name";

  const name = document.createElement("span");

  name.className = "market-mover-name-text";
  name.textContent = coin.name || coin.symbol || "Unknown";

  const symbol = document.createElement("span");

  symbol.className = "market-mover-symbol";
  symbol.textContent = (coin.symbol || "").toUpperCase();

  nameWrapper.append(name, symbol);

  coinInfo.appendChild(nameWrapper);

  const change = document.createElement("span");

  change.className = "market-mover-change";
  change.textContent = `${Number(coin.change).toFixed(2)}%`;

  const quote = document.createElement("div");
  quote.className = "market-mover-quote";
  const price = document.createElement("small");
  price.textContent = `$${formatPrice(coin.price)}`;
  quote.append(price, change);

  row.append(coinInfo, quote);

  return row;
}

// Search and sort controls both update the same filtered list.
function closeSearchSuggestions() {
  searchSuggestions.hidden = true;
  searchSuggestions.replaceChildren();
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
  searchSuggestionCoins = [];
  activeSearchSuggestion = -1;
}

function getSearchableCoins() {
  return [...new Map([...coins, ...additionalSearchCoins].map((coin) => [coin.id, coin])).values()];
}

function renderSearchSuggestions() {
  const query = searchInput.value.trim().toLowerCase();
  searchSuggestions.replaceChildren();
  activeSearchSuggestion = -1;

  if (!query) {
    closeSearchSuggestions();
    return;
  }

  searchSuggestionCoins = getSearchableCoins()
    .filter(
      (coin) =>
        coin.name.toLowerCase().includes(query) ||
        coin.symbol.toLowerCase().includes(query),
    )
    .slice(0, 6);
  searchSuggestions.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");

  if (searchSuggestionCoins.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "search-suggestion-empty";
    emptyState.textContent = additionalSearchLoading
      ? "Searching more coins..."
      : additionalSearchFailed
        ? "Additional coin search unavailable"
        : coins.length
          ? "No matching cryptocurrencies"
          : "Loading market data...";
    searchSuggestions.appendChild(emptyState);
    return;
  }

  searchSuggestionCoins.forEach((coin, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "search-suggestion";
    option.id = `searchSuggestion-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");

    if (coin.image) {
      const icon = document.createElement("img");
      icon.src = coin.image;
      icon.alt = "";
      icon.loading = "lazy";
      icon.decoding = "async";
      option.appendChild(icon);
    }

    const identity = document.createElement("span");
    identity.className = "search-suggestion-identity";
    const name = document.createElement("strong");
    name.textContent = coin.name;
    const symbol = document.createElement("small");
    symbol.textContent = coin.symbol;
    identity.append(name, symbol);

    const price = document.createElement("span");
    price.className = "search-suggestion-price";
    price.textContent = `$${formatPrice(coin.price)}`;
    option.append(identity, price);
    option.addEventListener("click", () => selectSearchCoin(coin));
    searchSuggestions.appendChild(option);
  });
}

function searchAdditionalCoins(query) {
  window.clearTimeout(additionalSearchTimer);
  const requestId = ++additionalSearchRequest;
  additionalSearchCoins = [];
  additionalSearchFailed = false;
  additionalSearchLoading = query.length >= 2;
  if (!additionalSearchLoading) return;

  additionalSearchTimer = window.setTimeout(async () => {
    try {
      const response = await fetch(
        `/api/coin-search?q=${encodeURIComponent(query)}`,
      );
      if (!response.ok) throw new Error(`Coin search failed: ${response.status}`);
      const data = await response.json();
      if (requestId !== additionalSearchRequest) return;
      additionalSearchCoins = Array.isArray(data.coins) ? data.coins : [];
    } catch (error) {
      if (requestId !== additionalSearchRequest) return;
      console.error("Unable to search additional coins:", error);
      additionalSearchFailed = true;
    } finally {
      if (requestId === additionalSearchRequest) {
        additionalSearchLoading = false;
        renderSearchSuggestions();
        updateCoins();
      }
    }
  }, 400);
}

function setActiveSearchSuggestion(index) {
  const options = searchSuggestions.querySelectorAll('[role="option"]');
  if (!options.length) return;
  activeSearchSuggestion = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const isActive = optionIndex === activeSearchSuggestion;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });
  const activeOption = options[activeSearchSuggestion];
  searchInput.setAttribute("aria-activedescendant", activeOption.id);
  activeOption.scrollIntoView({ block: "nearest" });
}

function selectSearchCoin(coin) {
  window.clearTimeout(additionalSearchTimer);
  additionalSearchRequest += 1;
  additionalSearchLoading = false;
  searchInput.value = coin.name;
  navSearch.classList.add("has-query");
  clearSearchButton.hidden = false;
  currentPage = 1;
  closeSearchSuggestions();
  updateCoins();

  requestAnimationFrame(() => {
    const result = [...document.querySelectorAll(
      isMarketPage ? "tr[data-coin-id]" : ".coin-card[data-coin-id]",
    )].find(
      (item) => item.dataset.coinId === coin.id,
    );
    if (!result) return;
    result.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
    result.classList.add("search-result-focus");
    result.focus({ preventScroll: true });
    window.setTimeout(() => result.classList.remove("search-result-focus"), 1400);
  });
}

searchInput.addEventListener("input", () => {
  const hasQuery = Boolean(searchInput.value.trim());
  navSearch.classList.toggle("has-query", hasQuery);
  clearSearchButton.hidden = !hasQuery;
  currentPage = 1;
  searchAdditionalCoins(searchInput.value.trim());
  renderSearchSuggestions();
  updateCoins();
});

function setNavSearchOpen(isOpen) {
  if (isMarketPage && !isOpen) {
    closeSearchSuggestions();
    return;
  }
  navSearch.classList.toggle("is-open", isOpen);
  navSearchToggle.setAttribute("aria-expanded", String(isOpen));
  navSearchToggle.setAttribute(
    "aria-label",
    isOpen ? "Close coin search" : "Open coin search",
  );
  if (isOpen) searchInput.focus();
  else closeSearchSuggestions();
}

navSearchToggle.addEventListener("click", () => {
  const isOpen = !navSearch.classList.contains("is-open");
  setNavSearchOpen(isOpen);
  if (isOpen && searchInput.value.trim()) renderSearchSuggestions();
});

function clearCoinSearch() {
  window.clearTimeout(additionalSearchTimer);
  additionalSearchRequest += 1;
  additionalSearchCoins = [];
  additionalSearchLoading = false;
  additionalSearchFailed = false;
  searchInput.value = "";
  navSearch.classList.remove("has-query");
  clearSearchButton.hidden = true;
  closeSearchSuggestions();
  currentPage = 1;
  selectedCoin = null;
  coinDetails.style.display = "none";
  clearChart();
  updateCoins();
}

clearSearchButton.addEventListener("click", () => {
  clearCoinSearch();
  searchInput.focus();
});

clearResultsSearch.addEventListener("click", clearCoinSearch);
clearMarketTableSearch.addEventListener("click", clearCoinSearch);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && !searchSuggestions.hidden) {
    event.preventDefault();
    setActiveSearchSuggestion(activeSearchSuggestion + 1);
  } else if (event.key === "ArrowUp" && !searchSuggestions.hidden) {
    event.preventDefault();
    setActiveSearchSuggestion(
      activeSearchSuggestion <= 0
        ? searchSuggestionCoins.length - 1
        : activeSearchSuggestion - 1,
    );
  } else if (
    event.key === "Enter" &&
    !searchSuggestions.hidden &&
    searchSuggestionCoins.length
  ) {
    event.preventDefault();
    selectSearchCoin(
      searchSuggestionCoins[
        activeSearchSuggestion >= 0 ? activeSearchSuggestion : 0
      ],
    );
  } else if (event.key === "Escape") {
    if (!searchSuggestions.hidden) closeSearchSuggestions();
    else if (isMarketPage) searchInput.blur();
    else {
      setNavSearchOpen(false);
      navSearchToggle.focus();
    }
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!navSearch.contains(event.target)) {
    if (isMarketPage) closeSearchSuggestions();
    else setNavSearchOpen(false);
  }
});

sortSelect.addEventListener("change", () => {
  sortDirection = sortSelect.value === "default" ? "asc" : "desc";
  currentPage = 1;
  updateCoins();
});

marketFilterSelect?.addEventListener("change", () => {
  currentPage = 1;
  updateCoins();
});

document.querySelectorAll("[data-market-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextSort = button.dataset.marketSort;
    if (sortSelect.value === nextSort) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortSelect.value = nextSort;
      sortDirection = nextSort === "default" ? "asc" : "desc";
    }
    currentPage = 1;
    updateCoins();
  });
});

updateCoins();

// market statistics
const marketCapValue = document.getElementById("marketCapValue");
const volumeValue = document.getElementById("volumeValue");
const marketOverview = document.getElementById("marketOverview");
const marketOverviewStatus = document.getElementById("marketOverviewStatus");
const btcDominanceValue = document.getElementById("btcDominanceValue");
const activeCoinsValue = document.getElementById("activeCoinsValue");
const lastUpdated = document.getElementById("lastUpdated");
const btcDominancePanel = {
  content: document.getElementById("btcDominanceContent"),
  status: document.getElementById("btcDominanceStatus"),
  value: document.getElementById("btcDominanceHeroValue"),
  bitcoinShare: document.getElementById("btcDominanceBitcoinShare"),
  altcoinShare: document.getElementById("btcDominanceAltcoinShare"),
  bar: document.getElementById("btcDominanceBar"),
  bitcoinBar: document.getElementById("btcDominanceBitcoinBar"),
  altcoinBar: document.getElementById("btcDominanceAltcoinBar"),
};

function updateBtcDominanceUI(data) {
  const btcDominance = data?.data?.market_cap_percentage?.btc;
  const isValid =
    typeof btcDominance === "number" &&
    Number.isFinite(btcDominance) &&
    btcDominance >= 0 &&
    btcDominance <= 100;

  btcDominancePanel.content.setAttribute("aria-busy", "false");
  if (!isValid) {
    const unavailable = data ? "BTC dominance unavailable." : "Global market data unavailable.";
    btcDominanceValue.textContent = "—";
    btcDominancePanel.value.textContent = "—";
    btcDominancePanel.bitcoinShare.textContent = "—";
    btcDominancePanel.altcoinShare.textContent = "—";
    btcDominancePanel.status.textContent = unavailable;
    btcDominancePanel.bitcoinBar.style.width = "0%";
    btcDominancePanel.altcoinBar.style.width = "0%";
    btcDominancePanel.bar.setAttribute("aria-label", unavailable);
    return;
  }

  const altcoinShare = 100 - btcDominance;
  const btcLabel = `${btcDominance.toFixed(2)}%`;
  const altcoinLabel = `${altcoinShare.toFixed(2)}%`;
  btcDominanceValue.textContent = btcLabel;
  btcDominancePanel.value.textContent = btcLabel;
  btcDominancePanel.bitcoinShare.textContent = btcLabel;
  btcDominancePanel.altcoinShare.textContent = altcoinLabel;
  btcDominancePanel.status.textContent = "";
  btcDominancePanel.bitcoinBar.style.width = `${btcDominance}%`;
  btcDominancePanel.altcoinBar.style.width = `${altcoinShare}%`;
  btcDominancePanel.bar.setAttribute(
    "aria-label",
    `Bitcoin ${btcLabel}; altcoins ${altcoinLabel}`,
  );
}

// updating marketdata ui
function updateMarketData(data) {
  coins = data.map((apiCoin) => {
    const socketUpdate = latestSocketCoinData.get(apiCoin.id);
    return {
      id: apiCoin.id,
      name: apiCoin.name,
      symbol: apiCoin.symbol.toUpperCase(),
      image: apiCoin.image,
      price: socketUpdate?.price ?? apiCoin.current_price,
      change:
        socketUpdate &&
        Object.prototype.hasOwnProperty.call(socketUpdate, "change")
          ? socketUpdate.change
          : apiCoin.price_change_percentage_24h,
      price_change_percentage_24h:
        socketUpdate && Object.prototype.hasOwnProperty.call(socketUpdate, "change")
          ? socketUpdate.change
          : apiCoin.price_change_percentage_24h,
      change1h: socketUpdate?.change1h ?? apiCoin.price_change_percentage_1h_in_currency,
      change7d: socketUpdate?.change7d ?? apiCoin.price_change_percentage_7d_in_currency,
      rank: socketUpdate?.rank ?? apiCoin.market_cap_rank,
      sparkline: socketUpdate?.sparkline ?? apiCoin.sparkline_in_7d?.price ?? [],
      marketCap: socketUpdate?.marketCap ?? apiCoin.market_cap,
      volume: socketUpdate?.volume ?? apiCoin.total_volume,
      high24h: apiCoin.high_24h,
      low24h: apiCoin.low_24h,
      circulatingSupply: apiCoin.circulating_supply,
    };
  });

  renderMarketBreadth();
  marketMotion?.setCoins(coins);
  marketMotion?.setDataState("ready");
  marketHeatMap?.setCoins(coins);
  updateCoins();
  renderMarketMovers();
}

// API Call
function fetchMarketData() {
  if (marketRequestInProgress) {
    console.log("Market request already in progress.");
    return Promise.resolve(false);
  }

  marketRequestInProgress = true;

  return fetch("/api/markets")
    .then((response) => {
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many requests. Please wait a moment.");
        }

        throw new Error(`API error: ${response.status}`);
      }

      return response.json();
    })

    .then((data) => {
      marketCache = data;
      marketLoadState = "ready";
      updateMarketData(data);
      document.getElementById("coinGrid").setAttribute("aria-busy", "false");

      lastUpdated.textContent =
        "Last updated: " + new Date().toLocaleTimeString();

      return true;
    })

    .catch((error) => {
      console.error("Error fetching crypto data:", error);

      if (marketCache) {
        marketLoadState = "ready";
        marketMotion?.setDataState("stale");
        marketHeatMap?.setError({ retainingData: true });
        lastUpdated.textContent =
          "Market data temporarily unavailable. Showing last successful update.";
      } else {
        marketLoadState = "error";
        marketMotion?.setDataState("error");
        marketHeatMap?.setError();
        lastUpdated.textContent = "Market data unavailable.";
        renderMarketBreadth();
        updateCoins();
      }

      document.getElementById("coinGrid").setAttribute("aria-busy", "false");

      return false;
    })
    .finally(() => {
      marketRequestInProgress = false;
    });
}

fetchMarketData();

setInterval(() => {
  console.log("Refreshing market data...");

  fetchMarketData();
  fetchGlobalMarketData();
}, 60000);

function updateChange(element, value) {
  element.textContent = formatChangePercent(value);
  element.classList.toggle("positive", value !== null && value >= 0);
  element.classList.toggle("negative", value !== null && value < 0);
}

function updateOverviewChange(element, value) {
  const isValid = typeof value === "number" && Number.isFinite(value);
  element.textContent = isValid
    ? `${formatChangePercent(value)} (24h)`
    : "24h change unavailable";
  element.classList.toggle("positive", isValid && value >= 0);
  element.classList.toggle("negative", isValid && value < 0);
  element.classList.toggle("metric-unavailable", !isValid);
}

function setMarketOverviewUnavailable(message) {
  marketOverview.setAttribute("aria-busy", "false");
  marketOverviewStatus.textContent = message;
  marketCapValue.textContent = "—";
  volumeValue.textContent = "—";
  if (activeCoinsValue) activeCoinsValue.textContent = "—";
  updateOverviewChange(marketCapChange, null);
  updateOverviewChange(volumeChange, null);
}

// updating ui
function updateGlobalMarketUI(data) {
  const globalData = data?.data ?? {};
  updateBtcDominanceUI(data);

  const marketCap = globalData.total_market_cap?.usd;
  const volume = globalData.total_volume?.usd;
  const hasMarketCap = typeof marketCap === "number" && Number.isFinite(marketCap) && marketCap >= 0;
  const hasVolume = typeof volume === "number" && Number.isFinite(volume) && volume >= 0;

  marketOverview.setAttribute("aria-busy", "false");
  marketOverviewStatus.textContent =
    hasMarketCap && hasVolume
      ? ""
      : hasMarketCap || hasVolume
        ? "Some market-wide metrics are unavailable."
        : "Market overview unavailable.";
  marketCapValue.textContent = hasMarketCap
    ? "$" + formatLargeNumber(marketCap)
    : "—";
  volumeValue.textContent = hasVolume
    ? "$" + formatLargeNumber(volume)
    : "—";
  if (activeCoinsValue) {
    activeCoinsValue.textContent = Number.isFinite(globalData.active_cryptocurrencies)
      ? globalData.active_cryptocurrencies.toLocaleString()
      : "—";
  }

  updateOverviewChange(marketCapChange, globalData.market_cap_change_percentage_24h_usd);
  updateOverviewChange(volumeChange, globalData.volume_change_percentage_24h_usd);
}

// fetching global market stats
function fetchGlobalMarketData() {
  if (globalRequestInProgress) {
    console.log("Global market request already in progress.");
    return Promise.resolve(false);
  }
  globalRequestInProgress = true;
  return fetch("/api/global")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return response.json();
    })

    .then((data) => {
      updateGlobalMarketUI(data);
      return true;
    })
    .catch((error) => {
      console.error("Error fetching global market data:", error);
      updateBtcDominanceUI(null);
      setMarketOverviewUnavailable("Global market data unavailable.");

      return false;
    })
    .finally(() => {
      globalRequestInProgress = false;
    });
}
fetchGlobalMarketData();

marketPageRefresh?.addEventListener("click", async () => {
  marketPageRefresh.disabled = true;
  marketPageRefresh.classList.add("is-loading");
  await Promise.allSettled([fetchMarketData(), fetchGlobalMarketData()]);
  marketPageRefresh.disabled = false;
  marketPageRefresh.classList.remove("is-loading");
});
