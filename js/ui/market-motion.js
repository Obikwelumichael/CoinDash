import { formatChangePercent, formatPrice } from "../utils/formatters.js";

const PREFERRED_MARKET_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "binancecoin",
  "ripple",
  "dogecoin",
  "cardano",
  "avalanche-2",
  "chainlink",
  "polkadot",
];

function numeric(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function selectMarketMotionCoins(markets, limit = 10) {
  const valid = (Array.isArray(markets) ? markets : []).filter((coin) => coin?.id && coin?.symbol);
  const byId = new Map(valid.map((coin) => [coin.id, coin]));
  const selected = PREFERRED_MARKET_IDS.map((id) => byId.get(id)).filter(Boolean);
  const selectedIds = new Set(selected.map((coin) => coin.id));
  const fallbacks = valid
    .filter((coin) => !selectedIds.has(coin.id))
    .sort((left, right) => (Number(left.rank) || Infinity) - (Number(right.rank) || Infinity));
  return [...selected, ...fallbacks].slice(0, limit);
}

export function getMarketMotionDirection(change) {
  if (!numeric(change) || Number(change) === 0) return "neutral";
  return Number(change) > 0 ? "positive" : "negative";
}

function priceLabel(price) {
  return numeric(price) ? `$${formatPrice(Number(price))}` : "—";
}

function changeLabel(change) {
  if (!numeric(change)) return "—";
  const direction = getMarketMotionDirection(change);
  const marker = direction === "positive" ? "↑" : direction === "negative" ? "↓" : "→";
  return `${marker} ${formatChangePercent(Number(change))}`;
}

export function createMarketMotion({ root } = {}) {
  if (!root) return null;

  const viewport = root.querySelector("[data-market-motion-viewport]");
  const track = root.querySelector("[data-market-motion-track]");
  const primary = root.querySelector("[data-market-motion-primary]");
  const clone = root.querySelector("[data-market-motion-clone]");
  const empty = root.querySelector("[data-market-motion-empty]");
  const status = root.querySelector("[data-market-motion-status]");
  const summary = root.querySelector("[data-market-motion-summary]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coinById = new Map();
  const itemNodes = new Map();
  let selectedCoins = [];
  let connectionState = "connecting";
  let dataState = "loading";
  let resizeFrame = 0;

  function stateCopy() {
    if (dataState === "error") return ["unavailable", "Market prices unavailable"];
    if (dataState === "stale") return ["stale", "Showing the last successful market update"];
    if (dataState === "loading") {
      return connectionState === "connected"
        ? ["loading", "Live feed connected · loading prices…"]
        : ["loading", "Loading market prices…"];
    }
    if (connectionState === "connected") return ["connected", "Live updates connected"];
    if (connectionState === "reconnecting") return ["stale", "Prices loaded · live feed reconnecting…"];
    if (connectionState === "unavailable") return ["stale", "Periodic prices available · live feed unavailable"];
    return ["loading", "Prices loaded · connecting live updates…"];
  }

  function renderState() {
    const [state, copy] = stateCopy();
    root.dataset.state = state;
    status.textContent = copy;
    root.setAttribute("aria-busy", String(dataState === "loading"));
    empty.hidden = selectedCoins.length > 0;
    track.hidden = selectedCoins.length === 0;
    if (!selectedCoins.length) empty.textContent = copy;
  }

  function registerNode(coinId, node) {
    const nodes = itemNodes.get(coinId) ?? [];
    nodes.push(node);
    itemNodes.set(coinId, nodes);
  }

  function updateNode(node, coin) {
    const direction = getMarketMotionDirection(coin.change);
    const price = priceLabel(coin.price);
    const change = changeLabel(coin.change);
    node.dataset.direction = direction;
    node.querySelector("[data-market-motion-price]").textContent = price;
    node.querySelector("[data-market-motion-change]").textContent = change;
    node.setAttribute(
      "aria-label",
      `${coin.name || coin.symbol}, ${price}, ${numeric(coin.change) ? `${formatChangePercent(Number(coin.change))} over 24 hours` : "24-hour change unavailable"}`,
    );
  }

  function createItem(coin) {
    const item = document.createElement("div");
    item.className = "market-motion__item";
    item.dataset.coinId = coin.id;

    if (coin.image) {
      const image = document.createElement("img");
      image.className = "market-motion__icon";
      image.src = coin.image;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => image.remove(), { once: true });
      item.append(image);
    }

    const symbol = document.createElement("strong");
    symbol.textContent = String(coin.symbol).toUpperCase();
    const price = document.createElement("span");
    price.dataset.marketMotionPrice = "";
    const change = document.createElement("span");
    change.dataset.marketMotionChange = "";
    item.append(symbol, price, change);
    updateNode(item, coin);
    registerNode(coin.id, item);
    return item;
  }

  function renderGroup(group, repeatCount) {
    const fragment = document.createDocumentFragment();
    for (let repeat = 0; repeat < repeatCount; repeat += 1) {
      selectedCoins.forEach((coin) => fragment.append(createItem(coin)));
    }
    group.replaceChildren(fragment);
  }

  function updateAccessibleSummary() {
    summary.textContent = selectedCoins.length
      ? `Major cryptocurrency prices: ${selectedCoins.map((coin) => `${String(coin.symbol).toUpperCase()} ${priceLabel(coin.price)}, ${numeric(coin.change) ? `${formatChangePercent(Number(coin.change))} over 24 hours` : "change unavailable"}`).join("; ")}.`
      : "Major cryptocurrency prices are unavailable.";
  }

  function rebuild() {
    window.cancelAnimationFrame(resizeFrame);
    itemNodes.clear();
    if (!selectedCoins.length) {
      primary.replaceChildren();
      clone.replaceChildren();
      renderState();
      updateAccessibleSummary();
      return;
    }

    track.hidden = false;
    empty.hidden = true;
    renderGroup(primary, 1);
    const baseWidth = Math.max(primary.scrollWidth, 1);
    const repeatCount = reducedMotion.matches
      ? 1
      : Math.max(1, Math.ceil(viewport.clientWidth / baseWidth));
    itemNodes.clear();
    renderGroup(primary, repeatCount);
    renderGroup(clone, repeatCount);
    clone.hidden = reducedMotion.matches;
    const duration = Math.min(45, Math.max(30, primary.scrollWidth / 34));
    root.style.setProperty("--market-motion-duration", `${duration.toFixed(2)}s`);
    renderState();
    updateAccessibleSummary();
  }

  function scheduleRebuild() {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(rebuild);
  }

  function updateCoins(updates) {
    (Array.isArray(updates) ? updates : []).forEach((update) => {
      const current = coinById.get(update?.id);
      if (!current) return;
      ["price", "change", "name", "symbol", "image", "rank"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(update, key)) current[key] = update[key];
      });
      itemNodes.get(current.id)?.forEach((node) => updateNode(node, current));
    });
    selectedCoins = selectedCoins.map((coin) => coinById.get(coin.id) ?? coin);
    updateAccessibleSummary();
  }

  function setCoins(markets) {
    const next = selectMarketMotionCoins(markets);
    next.forEach((coin) => coinById.set(coin.id, { ...(coinById.get(coin.id) ?? {}), ...coin }));
    const nextIds = next.map((coin) => coin.id).join(",");
    const currentIds = selectedCoins.map((coin) => coin.id).join(",");
    selectedCoins = next.map((coin) => coinById.get(coin.id));
    if (nextIds === currentIds && itemNodes.size) updateCoins(next);
    else rebuild();
  }

  function setConnectionState(state) {
    connectionState = state;
    renderState();
  }

  function setDataState(state) {
    dataState = state;
    renderState();
  }

  const resizeObserver = new ResizeObserver(scheduleRebuild);
  resizeObserver.observe(viewport);
  reducedMotion.addEventListener("change", scheduleRebuild);
  window.addEventListener("pagehide", () => resizeObserver.disconnect(), { once: true });
  renderState();

  return { setCoins, updateCoins, setConnectionState, setDataState };
}
