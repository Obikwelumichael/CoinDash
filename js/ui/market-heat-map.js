import { formatChangePercent, formatLargeNumber, formatPrice } from "../utils/formatters.js";

// CoinGecko IDs already used by CoinDash's normalized /api/markets payload.
export const MAJOR_COIN_IDS = Object.freeze([
  "bitcoin",
  "ethereum",
  "tether",
  "binancecoin",
  "ripple",
  "solana",
  "usd-coin",
  "dogecoin",
  "cardano",
  "tron",
  "avalanche-2",
  "chainlink",
  "the-open-network",
  "sui",
  "shiba-inu",
  "polkadot",
  "stellar",
  "litecoin",
  "bitcoin-cash",
  "uniswap",
]);

const MIN_CHANGE_BOUND = 2;
const MAX_CHANGE_BOUND = 8;

function numeric(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function selectMajorCoins(coins) {
  const byId = new Map((Array.isArray(coins) ? coins : []).map((coin) => [coin?.id, coin]));
  return MAJOR_COIN_IDS
    .map((id) => byId.get(id))
    .filter((coin) => coin && numeric(coin.marketCap) && Number(coin.marketCap) > 0)
    .map((coin) => ({ ...coin, marketCap: Number(coin.marketCap) }));
}

// The symmetric scale uses the 85th percentile absolute move, clamped to 2–8%.
// This keeps ordinary differences visible without allowing one outlier to flatten the map.
export function getChangeBound(coins) {
  const moves = coins
    .map((coin) => Math.abs(Number(coin.change)))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!moves.length) return MAX_CHANGE_BOUND;
  const percentile = moves[Math.min(moves.length - 1, Math.floor((moves.length - 1) * 0.85))];
  return Math.max(MIN_CHANGE_BOUND, Math.min(MAX_CHANGE_BOUND, percentile));
}

export function getHeatStrength(change, bound) {
  if (!numeric(change) || !Number.isFinite(bound) || bound <= 0) return 0;
  return Math.min(1, Math.abs(Number(change)) / bound);
}

// Preserve market-cap ordering while compressing extreme differences so the
// full major-coin field remains legible, as in a trading-terminal heat map.
export function getTreemapDisplayWeight(marketCap) {
  if (!numeric(marketCap) || Number(marketCap) <= 0) return 0;
  return Math.pow(Number(marketCap), 0.55);
}

function worstAspect(row, shortSide) {
  if (!row.length || shortSide <= 0) return Infinity;
  const area = row.reduce((sum, item) => sum + item.area, 0);
  const largest = Math.max(...row.map((item) => item.area));
  const smallest = Math.min(...row.map((item) => item.area));
  const sideSquared = shortSide * shortSide;
  return Math.max(
    (sideSquared * largest) / (area * area),
    (area * area) / (sideSquared * smallest),
  );
}

function placeRow(row, rect, placements) {
  const area = row.reduce((sum, item) => sum + item.area, 0);
  if (rect.width >= rect.height) {
    const width = area / rect.height;
    let y = rect.y;
    row.forEach((item) => {
      const height = item.area / width;
      placements.push({ id: item.id, x: rect.x, y, width, height });
      y += height;
    });
    rect.x += width;
    rect.width -= width;
  } else {
    const height = area / rect.width;
    let x = rect.x;
    row.forEach((item) => {
      const width = item.area / height;
      placements.push({ id: item.id, x, y: rect.y, width, height });
      x += width;
    });
    rect.y += height;
    rect.height -= height;
  }
}

export function layoutTreemap(coins, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const usable = coins
    .filter((coin) => numeric(coin.marketCap) && Number(coin.marketCap) > 0)
    .sort((left, right) => Number(right.marketCap) - Number(left.marketCap));
  const total = usable.reduce((sum, coin) => sum + Number(coin.marketCap), 0);
  if (!total) return [];

  const queue = usable.map((coin) => ({
    id: coin.id,
    area: (Number(coin.marketCap) / total) * width * height,
  }));
  const rect = { x: 0, y: 0, width, height };
  const placements = [];
  let row = [];

  while (queue.length) {
    const candidate = queue[0];
    const shortSide = Math.min(rect.width, rect.height);
    if (!row.length || worstAspect([...row, candidate], shortSide) <= worstAspect(row, shortSide)) {
      row.push(queue.shift());
    } else {
      placeRow(row, rect, placements);
      row = [];
    }
  }
  if (row.length) placeRow(row, rect, placements);
  return placements;
}

export function summarizeMajorCoins(coins) {
  const changes = coins.map((coin) => coin.change).filter(numeric).map(Number);
  return {
    up: changes.filter((change) => change > 0).length,
    down: changes.filter((change) => change < 0).length,
    average: changes.length ? changes.reduce((sum, change) => sum + change, 0) / changes.length : null,
  };
}

function currency(value) {
  return numeric(value) ? `$${formatPrice(Number(value))}` : "Unavailable";
}

function compactCurrency(value) {
  return numeric(value) ? `$${formatLargeNumber(Number(value))}` : "Unavailable";
}

function spokenChange(value, periodLabel) {
  if (!numeric(value)) return `${periodLabel} change unavailable`;
  const amount = Math.abs(Number(value)).toFixed(2);
  return `${periodLabel} change ${Number(value) >= 0 ? "up" : "down"} ${amount} percent`;
}

export function createMarketHeatMap({ root, onRetry = () => {} } = {}) {
  if (!root) return null;
  const canvas = root.querySelector("[data-heat-map-canvas]");
  const loading = root.querySelector("[data-heat-map-loading]");
  const empty = root.querySelector("[data-heat-map-empty]");
  const status = root.querySelector("[data-heat-map-status]");
  const retry = root.querySelector("[data-heat-map-retry]");
  const tooltip = root.querySelector("[data-heat-map-tooltip]");
  const summaryUp = root.querySelector("[data-heat-map-up]");
  const summaryDown = root.querySelector("[data-heat-map-down]");
  const summaryAverage = root.querySelector("[data-heat-map-average]");
  const periodButtons = [...root.querySelectorAll("[data-heat-map-period]")];
  const periodLabels = [...root.querySelectorAll("[data-heat-map-period-label]")];
  const inspector = root.querySelector("[data-heat-map-inspector]");
  const inspectorSelect = root.querySelector("[data-heat-map-select]");
  const inspectorDetails = root.querySelector("[data-heat-map-inspector-details]");
  const coinById = new Map();
  const tileById = new Map();
  let coins = [];
  let changeBound = MAX_CHANGE_BOUND;
  let activeCoinId = null;
  let selectedCoinId = null;
  let tooltipPinned = false;
  let resizeFrame = null;
  let lastReceivedAt = null;
  let activePeriod = { key: "change", label: "24h" };

  function activeChange(coin) {
    return coin?.[activePeriod.key];
  }

  function updateSummary() {
    const summary = summarizeMajorCoins(coins.map((coin) => ({ change: activeChange(coin) })));
    summaryUp.textContent = String(summary.up);
    summaryDown.textContent = String(summary.down);
    summaryAverage.textContent = summary.average === null ? "—" : formatChangePercent(summary.average);
    summaryAverage.classList.toggle("positive", summary.average !== null && summary.average > 0);
    summaryAverage.classList.toggle("negative", summary.average !== null && summary.average < 0);
  }

  function updateInspector(coin) {
    if (!coin) {
      inspectorDetails.textContent = "Choose a coin to inspect its market data.";
      return;
    }
    inspectorDetails.textContent = `${coin.name} (${coin.symbol}) · ${currency(coin.price)} · ${formatChangePercent(activeChange(coin))} over ${activePeriod.label} · Market cap ${compactCurrency(coin.marketCap)}`;
  }

  function tooltipCopy(coin) {
    tooltip.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = `${coin.name} · ${coin.symbol}`;
    const rows = [
      ["Price", currency(coin.price)],
      [activePeriod.label, formatChangePercent(activeChange(coin))],
      ["Market cap", compactCurrency(coin.marketCap)],
      ["24h volume", compactCurrency(coin.volume)],
    ];
    const list = document.createElement("dl");
    rows.forEach(([label, value]) => {
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      list.append(term, detail);
    });
    tooltip.append(title, list);
  }

  function positionTooltip(tile, pointer) {
    const tileRect = tile.getBoundingClientRect();
    const width = tooltip.offsetWidth || 210;
    const height = tooltip.offsetHeight || 150;
    const anchorX = pointer?.clientX ?? tileRect.left + tileRect.width / 2;
    const anchorY = pointer?.clientY ?? tileRect.top;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchorX + 12));
    const preferredTop = anchorY - height - 12;
    const top = preferredTop >= 8 ? preferredTop : Math.min(window.innerHeight - height - 8, anchorY + 16);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function showTooltip(coin, tile, pointer, pinned = false) {
    activeCoinId = coin.id;
    tooltipPinned = pinned;
    tooltipCopy(coin);
    tooltip.hidden = false;
    tile.setAttribute("aria-expanded", "true");
    positionTooltip(tile, pointer);
  }

  function hideTooltip({ force = false } = {}) {
    if (tooltipPinned && !force) return;
    if (activeCoinId) tileById.get(activeCoinId)?.setAttribute("aria-expanded", "false");
    activeCoinId = null;
    tooltipPinned = false;
    tooltip.hidden = true;
  }

  function selectTile(coinId) {
    if (selectedCoinId) {
      const previous = tileById.get(selectedCoinId);
      previous?.classList.remove("is-selected");
      previous?.setAttribute("aria-pressed", "false");
    }
    selectedCoinId = coinId;
    if (selectedCoinId) {
      const selected = tileById.get(selectedCoinId);
      selected?.classList.add("is-selected");
      selected?.setAttribute("aria-pressed", "true");
    }
  }

  function updateTile(tile, coin) {
    const measuredChange = activeChange(coin);
    const change = numeric(measuredChange) ? Number(measuredChange) : null;
    const direction = change === null || change === 0 ? "neutral" : change > 0 ? "positive" : "negative";
    tile.dataset.direction = direction;
    const strength = getHeatStrength(change, changeBound);
    tile.style.setProperty("--heat-strength", strength.toFixed(3));
    tile.style.setProperty("--heat-alpha", (0.28 + strength * 0.34).toFixed(3));
    tile.querySelector("[data-heat-change]").textContent = change === null ? "—" : formatChangePercent(change);
    tile.setAttribute("aria-label", `${coin.name}, ${coin.symbol}. Price ${currency(coin.price)}. ${spokenChange(change, activePeriod.label)}. Market capitalization ${compactCurrency(coin.marketCap)}.`);
    if (activeCoinId === coin.id && !tooltip.hidden) tooltipCopy(coin);
  }

  function createTile(coin) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "market-heat-map-tile";
    tile.dataset.coinId = coin.id;
    tile.setAttribute("aria-controls", "marketHeatMapTooltip");
    tile.setAttribute("aria-expanded", "false");
    tile.setAttribute("aria-pressed", "false");

    const identity = document.createElement("span");
    identity.className = "market-heat-map-identity";
    if (coin.image) {
      const image = document.createElement("img");
      image.className = "market-heat-map-icon";
      image.src = coin.image;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        image.remove();
        tile.classList.add("has-no-image");
      }, { once: true });
      identity.append(image);
    } else {
      tile.classList.add("has-no-image");
    }
    const identityCopy = document.createElement("span");
    identityCopy.className = "market-heat-map-identity-copy";
    const symbol = document.createElement("strong");
    symbol.textContent = coin.symbol;
    const name = document.createElement("span");
    name.textContent = coin.name;
    identityCopy.append(symbol, name);
    identity.append(identityCopy);
    const change = document.createElement("span");
    change.className = "market-heat-map-change";
    change.dataset.heatChange = "";
    const metrics = document.createElement("span");
    metrics.className = "market-heat-map-metrics";
    metrics.append(change);
    tile.append(identity, metrics);
    updateTile(tile, coin);

    tile.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") showTooltip(coinById.get(coin.id), tile, event);
    });
    tile.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch" && activeCoinId === coin.id && !tooltipPinned) positionTooltip(tile, event);
    });
    tile.addEventListener("pointerleave", () => hideTooltip());
    tile.addEventListener("focus", () => showTooltip(coinById.get(coin.id), tile));
    tile.addEventListener("blur", () => hideTooltip());
    tile.addEventListener("click", (event) => {
      if (activeCoinId === coin.id && tooltipPinned) {
        selectTile(null);
        hideTooltip({ force: true });
      } else {
        selectTile(coin.id);
        showTooltip(coinById.get(coin.id), tile, event, true);
      }
    });
    return tile;
  }

  function layout() {
    if (!coins.length) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const visualCoins = coins.map((coin) => ({
      ...coin,
      marketCap: getTreemapDisplayWeight(coin.marketCap),
    }));
    layoutTreemap(visualCoins, width, height).forEach((placement) => {
      const tile = tileById.get(placement.id);
      if (!tile) return;
      const inset = 3;
      tile.style.left = `${placement.x + inset}px`;
      tile.style.top = `${placement.y + inset}px`;
      tile.style.width = `${Math.max(0, placement.width - inset * 2)}px`;
      tile.style.height = `${Math.max(0, placement.height - inset * 2)}px`;
      tile.classList.toggle("is-compact", placement.width < 112 || placement.height < 82);
      tile.classList.toggle("is-micro", placement.width < 76 || placement.height < 54);
    });
  }

  function render() {
    hideTooltip({ force: true });
    selectedCoinId = null;
    canvas.replaceChildren();
    tileById.clear();
    coinById.clear();
    coins.forEach((coin) => {
      coinById.set(coin.id, coin);
      const tile = createTile(coin);
      tileById.set(coin.id, tile);
      canvas.append(tile);
    });
    selectTile(coins[0]?.id ?? null);
    inspectorSelect.replaceChildren(...coins.map((coin) => {
      const option = document.createElement("option");
      option.value = coin.id;
      option.textContent = `${coin.symbol} · ${coin.name}`;
      return option;
    }));
    inspector.hidden = !coins.length;
    updateInspector(coins[0]);
    loading.hidden = true;
    empty.hidden = true;
    canvas.hidden = false;
    root.setAttribute("aria-busy", "false");
    updateSummary();
    requestAnimationFrame(layout);
  }

  function setCoins(nextCoins, { receivedAt = Date.now() } = {}) {
    coins = selectMajorCoins(nextCoins);
    if (!coins.length) {
      loading.hidden = true;
      canvas.hidden = true;
      empty.hidden = false;
      inspector.hidden = true;
      root.setAttribute("aria-busy", "false");
      status.textContent = "Market heat map unavailable";
      return;
    }
    changeBound = getChangeBound(coins.map((coin) => ({ change: activeChange(coin) })));
    render();
    lastReceivedAt = receivedAt;
    status.textContent = `${activePeriod.label} performance · snapshot received ${new Date(receivedAt).toLocaleTimeString()}`;
  }

  function updateCoins(updates) {
    let summaryChanged = false;
    (Array.isArray(updates) ? updates : []).forEach((update) => {
      const coin = coinById.get(update?.id);
      if (!coin) return;
      ["price", "change", "change1h", "change7d", "marketCap", "volume"].forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(update, key)) return;
        coin[key] = update[key];
        if (key === activePeriod.key) summaryChanged = true;
      });
      updateTile(tileById.get(coin.id), coin);
    });
    if (summaryChanged) updateSummary();
    if (updates.length) {
      lastReceivedAt = Date.now();
      status.textContent = `${activePeriod.label} performance · live update received ${new Date(lastReceivedAt).toLocaleTimeString()}`;
    }
    updateInspector(coinById.get(inspectorSelect.value));
  }

  function setError({ retainingData = false } = {}) {
    if (retainingData && coins.length) {
      status.textContent = "Live data temporarily unavailable · showing the last successful snapshot";
      return;
    }
    loading.hidden = true;
    canvas.hidden = true;
    empty.hidden = false;
    inspector.hidden = true;
    root.setAttribute("aria-busy", "false");
    status.textContent = "Market heat map unavailable";
  }

  retry.addEventListener("click", onRetry);
  periodButtons.forEach((button) => button.addEventListener("click", () => {
    activePeriod = {
      key: button.dataset.heatMapPeriod,
      label: button.textContent.trim().toLowerCase(),
    };
    periodButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    periodLabels.forEach((label) => { label.textContent = activePeriod.label; });
    changeBound = getChangeBound(coins.map((coin) => ({ change: activeChange(coin) })));
    coins.forEach((coin) => updateTile(tileById.get(coin.id), coin));
    updateSummary();
    updateInspector(coinById.get(inspectorSelect.value));
    if (lastReceivedAt) status.textContent = `${activePeriod.label} performance · last data received ${new Date(lastReceivedAt).toLocaleTimeString()}`;
  }));
  inspectorSelect.addEventListener("change", () => updateInspector(coinById.get(inspectorSelect.value)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      selectTile(null);
      hideTooltip({ force: true });
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (tooltipPinned && !tooltip.contains(event.target) && !event.target.closest?.(".market-heat-map-tile")) {
      selectTile(null);
      hideTooltip({ force: true });
    }
  });
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(layout);
    }).observe(canvas);
  }

  return { setCoins, updateCoins, setError, layout };
}
