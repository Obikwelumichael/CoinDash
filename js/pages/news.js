import { scoreNewsArticle } from "../utils/news-util.js";
import { formatChangePercent, formatPrice } from "../utils/formatters.js";

const featuredContainer = document.querySelector("[data-featured-news]");
const feed = document.querySelector("[data-news-feed]");
const filters = document.querySelector("[data-news-filters]");
const search = document.getElementById("newsSearch");
const status = document.querySelector("[data-news-status]");
const updated = document.querySelector("[data-news-updated]");
const refreshButton = document.querySelector("[data-news-refresh]");
const emptyState = document.querySelector("[data-news-empty]");
const count = document.querySelector("[data-news-count]");
const contextPanel = document.querySelector("[data-market-context]");
const featuredSection = document.querySelector(".news-featured-section");
const contextSection = document.querySelector(".news-market-context");

const categories = {
  Bitcoin: ["bitcoin", "btc"],
  Ethereum: ["ethereum", "ether", "eth"],
  Altcoins: ["solana", "sol", "xrp", "ripple", "cardano", "ada", "dogecoin", "doge", "bnb", "avalanche", "chainlink", "polkadot", "altcoin"],
  DeFi: ["defi", "decentralized finance", "dex", "lending protocol", "yield farming", "liquidity pool"],
  Regulation: ["regulation", "regulator", "sec", "cftc", "lawmakers", "legislation", "compliance", "lawsuit", "court"],
  Markets: ["market", "price", "rally", "sell-off", "liquidation", "trading", "volume", "etf", "fed", "interest rate", "inflow", "outflow"],
};

const coinKeywords = [
  { symbol: "BTC", names: ["bitcoin", "btc"] },
  { symbol: "ETH", names: ["ethereum", "ether", "eth"] },
  { symbol: "SOL", names: ["solana", "sol"] },
  { symbol: "XRP", names: ["xrp", "ripple"] },
  { symbol: "ADA", names: ["cardano", "ada"] },
  { symbol: "DOGE", names: ["dogecoin", "doge"] },
  { symbol: "BNB", names: ["bnb", "binance coin"] },
  { symbol: "AVAX", names: ["avalanche", "avax"] },
  { symbol: "LINK", names: ["chainlink"] },
  { symbol: "DOT", names: ["polkadot"] },
];

let articles = [];
let activeCategory = "All";
let requestNumber = 0;
let activeController = null;

function includesTerm(text, term) {
  if (term.length <= 4) return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  return text.includes(term);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function cleanText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeArticle(article, index) {
  const title = cleanText(article?.title || article?.headline, "Untitled market update");
  const description = cleanText(article?.description || article?.summary || article?.snippet, "No synopsis was supplied by the publisher.");
  const source = cleanText(article?.source || article?.publisher || article?.sourceName, "Unknown publisher");
  const link = safeUrl(article?.link || article?.url);
  const imageUrl = safeUrl(article?.imageUrl || article?.image || article?.thumbnail);
  const rawDate = article?.pubDate || article?.publishedAt || article?.published_at || article?.date;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  const pubDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : "";
  const text = `${title} ${description}`.toLowerCase();
  const articleCategories = Object.entries(categories)
    .filter(([, terms]) => terms.some((term) => includesTerm(text, term)))
    .map(([name]) => name);
  const coins = coinKeywords
    .filter(({ names }) => names.some((term) => includesTerm(text, term)))
    .map(({ symbol }) => symbol);

  return {
    id: link || `${title}-${source}-${index}`,
    title,
    description,
    source,
    link,
    imageUrl,
    pubDate,
    categories: articleCategories,
    coins,
    credibility: article?.credibility,
    contentType: article?.contentType,
  };
}

function normalizeArticles(data) {
  const sourceArticles = Array.isArray(data?.articles) ? data.articles : Array.isArray(data) ? data : [];
  const seen = new Set();
  return sourceArticles.map(normalizeArticle).filter((article) => {
    const key = article.link || article.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatTime(pubDate) {
  if (!pubDate) return "Time unavailable";
  const date = new Date(pubDate);
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function createPlaceholder() {
  const placeholder = document.createElement("div");
  placeholder.className = "news-page-image-placeholder";
  placeholder.setAttribute("role", "img");
  placeholder.setAttribute("aria-label", "Article image unavailable");
  placeholder.innerHTML = '<span aria-hidden="true">◇</span><small>Image unavailable</small>';
  return placeholder;
}

function createImage(article, className) {
  if (!article.imageUrl) return createPlaceholder();
  const image = document.createElement("img");
  image.className = className;
  image.src = article.imageUrl;
  image.alt = `Image for ${article.title}`;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => image.replaceWith(createPlaceholder()), { once: true });
  return image;
}

function appendMeta(parent, article) {
  const meta = document.createElement("div");
  meta.className = "news-page-meta";
  const sourceName = document.createElement("strong");
  sourceName.textContent = article.source;
  const separator = document.createElement("span");
  separator.textContent = "•";
  const time = document.createElement("time");
  time.dateTime = article.pubDate;
  time.textContent = formatTime(article.pubDate);
  meta.append(sourceName, separator, time);
  parent.append(meta);
}

function appendTags(parent, article) {
  if (!article.coins.length) return;
  const tags = document.createElement("div");
  tags.className = "news-coin-tags";
  tags.setAttribute("aria-label", "Cryptocurrencies mentioned");
  article.coins.forEach((symbol) => {
    const tag = document.createElement("span");
    tag.textContent = symbol;
    tags.append(tag);
  });
  parent.append(tags);
}

function createArticleLink(article, className) {
  const element = document.createElement(article.link ? "a" : "article");
  element.className = className;
  if (article.link) {
    element.href = article.link;
    element.target = "_blank";
    element.rel = "noopener noreferrer";
    element.setAttribute("aria-label", `${article.title} — opens original article`);
  }
  return element;
}

function renderFeatured(visibleArticles) {
  featuredContainer.replaceChildren();
  const ranked = [...visibleArticles].sort((a, b) => scoreNewsArticle(b) - scoreNewsArticle(a)).slice(0, 3);
  featuredSection.hidden = ranked.length === 0;
  if (!ranked.length) return;

  ranked.forEach((article, index) => {
    const story = createArticleLink(article, index === 0 ? "news-lead-story" : "news-featured-brief");
    if (index === 0) story.append(createImage(article, "news-lead-image"));
    const content = document.createElement("div");
    const label = document.createElement("span");
    label.className = "news-priority-label";
    label.textContent = index === 0 ? "LEAD STORY" : "PRIORITY BRIEF";
    const heading = document.createElement("h3");
    heading.textContent = article.title;
    const synopsis = document.createElement("p");
    synopsis.textContent = article.description;
    content.append(label);
    appendMeta(content, article);
    content.append(heading, synopsis);
    appendTags(content, article);
    if (article.link) {
      const read = document.createElement("span");
      read.className = "news-read-original";
      read.textContent = "Read original ↗";
      content.append(read);
    }
    story.append(content);
    featuredContainer.append(story);
  });
}

function renderFeed(visibleArticles) {
  feed.replaceChildren();
  count.textContent = `${visibleArticles.length} ${visibleArticles.length === 1 ? "story" : "stories"}`;
  emptyState.hidden = visibleArticles.length > 0;
  feed.hidden = visibleArticles.length === 0;

  visibleArticles.forEach((article) => {
    const story = createArticleLink(article, "news-feed-item");
    const content = document.createElement("div");
    appendMeta(content, article);
    const heading = document.createElement("h3");
    heading.textContent = article.title;
    const synopsis = document.createElement("p");
    synopsis.textContent = article.description;
    content.append(heading, synopsis);
    appendTags(content, article);
    story.append(content);
    if (article.imageUrl) story.append(createImage(article, "news-feed-image"));
    feed.append(story);
  });
}

function filteredArticles() {
  const query = search.value.trim().toLowerCase();
  return articles.filter((article) => {
    const categoryMatches = activeCategory === "All" || article.categories.includes(activeCategory);
    const queryMatches = !query || `${article.title} ${article.description} ${article.source} ${article.coins.join(" ")}`.toLowerCase().includes(query);
    return categoryMatches && queryMatches;
  });
}

function renderArticles() {
  const visible = filteredArticles();
  renderFeatured(visible);
  renderFeed(visible);
}

function renderFilters() {
  filters.replaceChildren();
  const available = ["All", ...Object.keys(categories).filter((category) => articles.some((article) => article.categories.includes(category)))];
  if (!available.includes(activeCategory)) activeCategory = "All";
  available.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = category;
    button.dataset.category = category;
    button.classList.toggle("active", category === activeCategory);
    button.setAttribute("aria-pressed", String(category === activeCategory));
    button.addEventListener("click", () => {
      activeCategory = category;
      renderFilters();
      renderArticles();
    });
    filters.append(button);
  });
}

function setLoading(isLoading, isRefresh = false) {
  refreshButton.disabled = isLoading;
  refreshButton.classList.toggle("is-loading", isLoading);
  featuredSection.setAttribute("aria-busy", String(isLoading));
  feed.setAttribute("aria-busy", String(isLoading));
  if (isLoading) {
    status.hidden = false;
    status.textContent = isRefresh ? "Refreshing market intelligence…" : "Loading the latest market intelligence…";
  }
}

async function loadNews({ refresh = false } = {}) {
  const currentRequest = ++requestNumber;
  activeController?.abort();
  activeController = new AbortController();
  setLoading(true, refresh);
  try {
    const response = await fetch(`/api/breaking${refresh ? `?refresh=${Date.now()}` : ""}`, { signal: activeController.signal });
    if (!response.ok) throw new Error(`News request failed with status ${response.status}`);
    const normalized = normalizeArticles(await response.json());
    if (currentRequest !== requestNumber) return;
    articles = normalized;
    updated.dateTime = new Date().toISOString();
    updated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    renderFilters();
    renderArticles();
    status.hidden = normalized.length > 0;
    if (!normalized.length) {
      status.hidden = false;
      status.textContent = "No cryptocurrency news is available right now.";
    }
  } catch (error) {
    if (error.name === "AbortError" || currentRequest !== requestNumber) return;
    console.error("News page error:", error);
    articles = [];
    renderFilters();
    renderArticles();
    status.hidden = false;
    status.textContent = "News is temporarily unavailable. Please try refreshing in a moment.";
  } finally {
    if (currentRequest === requestNumber) setLoading(false);
  }
}

function createMover(coin) {
  const row = document.createElement("a");
  row.className = "news-context-mover";
  row.href = "/markets";
  if (coin.image) {
    const image = document.createElement("img");
    image.src = coin.image;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    row.append(image);
  }
  const identity = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = coin.name || "Unknown asset";
  const price = document.createElement("small");
  price.textContent = `$${formatPrice(coin.current_price)}`;
  identity.append(name, price);
  const change = document.createElement("em");
  change.className = Number(coin.price_change_percentage_24h) >= 0 ? "positive" : "negative";
  change.textContent = formatChangePercent(coin.price_change_percentage_24h);
  row.append(identity, change);
  return row;
}

async function loadMarketContext() {
  try {
    const response = await fetch("/api/markets");
    if (!response.ok) throw new Error(`Market request failed with status ${response.status}`);
    const coins = await response.json();
    const usable = Array.isArray(coins) ? coins.filter((coin) => Number.isFinite(Number(coin.price_change_percentage_24h))) : [];
    const majorAssets = usable.filter((coin) => Number(coin.market_cap_rank) > 0 && Number(coin.market_cap_rank) <= 100);
    const contextAssets = majorAssets.length ? majorAssets : usable.slice(0, 100);
    const advancing = contextAssets.filter((coin) => Number(coin.price_change_percentage_24h) > 0).length;
    const direction = contextAssets.length && advancing / contextAssets.length >= 0.6 ? "Broadly positive" : contextAssets.length && advancing / contextAssets.length <= 0.4 ? "Broadly negative" : "Mixed market";
    const movers = [...contextAssets].sort((a, b) => Math.abs(Number(b.price_change_percentage_24h)) - Math.abs(Number(a.price_change_percentage_24h))).slice(0, 4);
    contextPanel.replaceChildren();
    const breadth = document.createElement("div");
    breadth.className = "news-context-breadth";
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "24H DIRECTION";
    const heading = document.createElement("strong");
    heading.textContent = direction;
    const detail = document.createElement("small");
    detail.textContent = contextAssets.length ? `${advancing} of ${contextAssets.length} top-ranked assets advancing` : "Direction unavailable";
    breadth.append(eyebrow, heading, detail);
    const moverList = document.createElement("div");
    moverList.className = "news-context-movers";
    movers.forEach((coin) => moverList.append(createMover(coin)));
    contextPanel.append(breadth, moverList);
  } catch (error) {
    console.error("News market context error:", error);
    const message = document.createElement("p");
    message.className = "news-context-error";
    message.textContent = "Market context is temporarily unavailable.";
    contextPanel.replaceChildren(message);
  } finally {
    contextSection.setAttribute("aria-busy", "false");
  }
}

search.addEventListener("input", renderArticles);
refreshButton.addEventListener("click", () => loadNews({ refresh: true }));
document.querySelector("[data-clear-news-filters]").addEventListener("click", () => {
  search.value = "";
  activeCategory = "All";
  renderFilters();
  renderArticles();
  search.focus();
});

loadNews();
loadMarketContext();
