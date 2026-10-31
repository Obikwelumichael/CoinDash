const net = require("net");
const http = require("http");
const WebSocket = require("ws");

net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { sessionMiddleware } = require("./server/session");
const { authRouter } = require("./server/auth/routes");
const { preferencesRouter } = require("./server/preferences/routes");
const { accountRouter } = require("./server/account/routes");
const { notificationsRouter } = require("./server/notifications/routes");
const { alertsRouter } = require("./server/alerts/routes");
const {
  DEFAULT_MAX_DATA_AGE_MS,
  evaluateMarketAlerts,
  hasEnabledMarketAlerts,
} = require("./server/alerts/evaluator");
const { createAlertScheduler } = require("./server/alerts/scheduler");
const { createAutomaticMarketScanner, hasEnabledAutomaticMarketFeed } = require("./server/alerts/market-feed");
const { accountTelegramRouter, telegramWebhookRouter } = require("./server/telegram/routes");
const { createTelegramWorker } = require("./server/telegram/worker");
const { createTelegramExpiryMaintenance } = require("./server/telegram/maintenance");
const { telegramConfig } = require("./server/telegram/adapter");
const { createOperationsRouter } = require("./server/telegram/operations");
const { pool } = require("./server/db/pool");
const { normalizeTrendingPayload } = require("./server/trending-data");
const { requireAuth, requirePageAuth } = require("./server/middleware/require-auth");
const {
  addWatchlistCoinId,
  listWatchlistCoinIds,
  removeWatchlistCoinId,
} = require("./server/db/watchlist");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const configuredAlertInterval = Number(process.env.ALERT_EVALUATION_INTERVAL_MS);
const ALERT_EVALUATION_INTERVAL_MS = Number.isFinite(configuredAlertInterval)
  && configuredAlertInterval >= 15_000
  ? configuredAlertInterval
  : 60_000;
const telegramWorker = createTelegramWorker();
const telegramExpiryMaintenance = createTelegramExpiryMaintenance();
const scanAutomaticMarketFeed = createAutomaticMarketScanner();

if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "16kb" }));
app.use(sessionMiddleware);
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again later." },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
const accountActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
app.use("/api/auth/forgot-password", accountActionLimiter);
app.use("/api/auth/reset-password", accountActionLimiter);
app.use("/api/auth/verification", accountActionLimiter);
const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many security attempts. Please try again later." },
});
const factorVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please try again later." },
});
app.use("/api/auth/login/verify", factorVerificationLimiter);
app.use("/api/account/2fa", sensitiveActionLimiter);
app.use("/api/account/2fa/confirm", factorVerificationLimiter);
app.use("/api/account/2fa/disable", factorVerificationLimiter);
app.use("/api/account/password", sensitiveActionLimiter);
app.use("/api/account/settings", sensitiveActionLimiter);
app.use("/api/account", accountRouter);
app.use("/api/auth", authRouter);
app.use("/api/preferences", preferencesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/telegram/webhook", telegramWebhookRouter);
app.use("/api/telegram", accountTelegramRouter);
app.use("/api/operations", createOperationsRouter({ worker: telegramWorker }));
app.get("/api/health", async (req, res) => {
  const config = telegramConfig();
  try {
    await pool.query("SELECT 1");
    return res.json({
      application: "ok",
      postgres: "ok",
      telegram: {
        configuration: config.configured ? "ready" : "not_configured",
        worker: config.workerDisabled ? "disabled" : telegramWorker.getStatus().lifecycle,
      },
    });
  } catch {
    return res.status(503).json({ application: "ok", postgres: "unavailable", telegram: { configuration: "unknown", worker: "unknown" } });
  }
});
const alertActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many alert changes. Please try again later." },
});
app.use("/api/alerts", alertActionLimiter, alertsRouter);

const protectedPages = new Map([
  ["watchlist", "watchlist.html"],
  ["signals", "signals.html"],
  ["settings", "settings.html"],
]);

for (const [route, fileName] of protectedPages) {
  const sendProtectedPage = (req, res) => res.sendFile(path.join(__dirname, "pages", fileName));
  app.get(`/${route}`, requirePageAuth, sendProtectedPage);
  app.get(`/pages/${fileName}`, requirePageAuth, sendProtectedPage);
}

app.use(express.static(path.join(__dirname), {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  setHeaders(res, filePath) {
    if (path.extname(filePath).toLowerCase() === ".html") {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

app.get("/markets", (req, res) => {
  res.sendFile(path.join(__dirname, "pages", "markets.html"));
});

app.get("/trending", (req, res) => {
  res.sendFile(path.join(__dirname, "pages", "trending.html"));
});

app.get("/news", (req, res) => {
  res.sendFile(path.join(__dirname, "pages", "news.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "pages", "login.html"));
});

app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "pages", "signup.html"));
});

app.get("/forgot-password", (req, res) => res.sendFile(path.join(__dirname, "pages", "forgot-password.html")));
app.get("/reset-password", (req, res) => res.sendFile(path.join(__dirname, "pages", "reset-password.html")));
app.get("/verify-email", (req, res) => res.sendFile(path.join(__dirname, "pages", "verify-email.html")));
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname, "pages", "privacy.html")));
app.get("/terms", (req, res) => res.sendFile(path.join(__dirname, "pages", "terms.html")));

const COINGECKO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidCoinGeckoId(coinId) {
  return typeof coinId === "string" && coinId.length <= 100 && COINGECKO_ID_PATTERN.test(coinId);
}

app.get("/api/watchlist", requireAuth, async (req, res) => {
  try {
    res.json({ watchlist: await listWatchlistCoinIds(req.user.id) });
  } catch (error) {
    console.error("Watchlist database read failed:", error.message);
    res.status(500).json({ error: "Unable to load the watchlist." });
  }
});

app.post("/api/watchlist", requireAuth, async (req, res) => {
  const { coinId } = req.body ?? {};
  if (!isValidCoinGeckoId(coinId)) {
    return res.status(400).json({ error: "coinId must be a valid CoinGecko coin ID." });
  }

  try {
    const added = await addWatchlistCoinId(req.user.id, coinId);
    return res.status(added ? 201 : 200).json({
      coinId,
      added,
      watchlist: await listWatchlistCoinIds(req.user.id),
    });
  } catch (error) {
    console.error("Watchlist database write failed:", error.message);
    return res.status(500).json({ error: "Unable to save this coin to the watchlist." });
  }
});

app.delete("/api/watchlist/:coinId", requireAuth, async (req, res) => {
  const { coinId } = req.params;
  if (!isValidCoinGeckoId(coinId)) {
    return res.status(400).json({ error: "coinId must be a valid CoinGecko coin ID." });
  }

  try {
    const removed = await removeWatchlistCoinId(req.user.id, coinId);
    return res.json({ coinId, removed });
  } catch (error) {
    console.error("Watchlist database delete failed:", error.message);
    return res.status(500).json({ error: "Unable to remove this coin from the watchlist." });
  }
});

let marketCache = null;
let marketCacheTime = 0;
const MARKET_CACHE_DURATION = 5 * 60 * 1000;
let marketRefreshPromise = null;
let marketEvaluationPromise = null;
let lastMarketEvaluationAt = 0;

let globalCache = null;
let globalCacheTime = 0;
const GLOBAL_CACHE_DURATION = 5 * 60 * 1000;

let trendingCache = null;
let trendingCacheTime = 0;
const TRENDING_CACHE_DURATION = 5 * 60 * 1000;
let trendingRefreshPromise = null;

async function fetchMarketsFromCoinGecko() {
  const perPage = 250;
  const pages = 5;
  const markets = await Promise.all(
    Array.from({ length: pages }, async (_, index) => {
      const params = new URLSearchParams({
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: String(perPage),
        page: String(index + 1),
        sparkline: "true",
        price_change_percentage: "1h,24h,7d",
      });
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?${params}`,
        { headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.log("COINGECKO STATUS:", response.status);
        console.log("COINGECKO RESPONSE:", errorText);
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      return response.json();
    }),
  );

  return [...new Map(markets.flat().map((coin) => [coin.id, coin])).values()];
}

async function evaluateFreshMarketSnapshot(snapshot) {
  const observedAt = Number(snapshot?.observedAt);
  if (!Number.isFinite(observedAt)) return { status: "skipped_invalid_snapshot" };
  if (marketEvaluationPromise) {
    await marketEvaluationPromise;
    if (observedAt <= lastMarketEvaluationAt) return { status: "skipped_duplicate" };
  }
  if (observedAt <= lastMarketEvaluationAt) return { status: "skipped_duplicate" };
  marketEvaluationPromise = (async () => {
    const [hasManualAlerts, hasAutomaticFeed] = await Promise.all([
      hasEnabledMarketAlerts(),
      hasEnabledAutomaticMarketFeed(),
    ]);
    if (!hasManualAlerts && !hasAutomaticFeed) return { status: "skipped_no_alerts" };
    const [manual, automatic] = await Promise.all([
      hasManualAlerts ? evaluateMarketAlerts(snapshot) : Promise.resolve({ status: "skipped_no_alerts" }),
      hasAutomaticFeed ? scanAutomaticMarketFeed(snapshot) : Promise.resolve({ status: "skipped_no_subscribers" }),
    ]);
    return { status: "completed", manual, automatic };
  })();
  try {
    const result = await marketEvaluationPromise;
    const retryableFailure = result?.automatic?.status === "error" || result?.manual?.status === "error";
    if (!retryableFailure) lastMarketEvaluationAt = Math.max(lastMarketEvaluationAt, observedAt);
    return result;
  } finally {
    marketEvaluationPromise = null;
  }
}

async function refreshMarketData() {
  if (!marketRefreshPromise) {
    marketRefreshPromise = (async () => {
      const data = await fetchMarketsFromCoinGecko();
      marketCache = data;
      marketCacheTime = Date.now();
      // Evaluate each genuinely fresh provider snapshot promptly without delaying the requesting HTTP response.
      void evaluateFreshMarketSnapshot({ markets: data, observedAt: marketCacheTime })
        .catch(() => console.error("Event-driven market alert evaluation failed; the fallback scheduler remains active."));
      return data;
    })().finally(() => { marketRefreshPromise = null; });
  }
  return marketRefreshPromise;
}

app.get("/api/markets", async (req, res) => {
  res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=300");
  if (marketCache && Date.now() - marketCacheTime < MARKET_CACHE_DURATION) {
    console.log("Using server-side market cache.");
    return res.json(marketCache);
  }

  try {
    const data = await refreshMarketData();

    res.json(data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch market data",
    });
  }
});

const coinSearchCache = new Map();
const COIN_SEARCH_CACHE_DURATION = 5 * 60 * 1000;
const MAX_COIN_SEARCH_RESULTS = 20;

async function searchCoinMarkets(query) {
  const headers = { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY };
  const searchResponse = await fetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
    { headers },
  );
  if (!searchResponse.ok) {
    throw new Error(`CoinGecko search error: ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();
  const matches = (Array.isArray(searchData.coins) ? searchData.coins : [])
    .filter((coin) => coin.id && coin.name && coin.symbol)
    .sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity))
    .slice(0, MAX_COIN_SEARCH_RESULTS);
  if (!matches.length) return [];

  const ids = matches.map((coin) => coin.id).join(",");
  const marketResponse = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&sparkline=true&price_change_percentage=1h,24h,7d`,
    { headers },
  );
  if (!marketResponse.ok) {
    throw new Error(`CoinGecko market search error: ${marketResponse.status}`);
  }

  const marketData = await marketResponse.json();
  return marketData.map((coin) => ({
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol.toUpperCase(),
    image: coin.image,
    price: coin.current_price,
    change: coin.price_change_percentage_24h,
    change1h: coin.price_change_percentage_1h_in_currency,
    change7d: coin.price_change_percentage_7d_in_currency,
    rank: coin.market_cap_rank,
    sparkline: coin.sparkline_in_7d?.price ?? [],
    marketCap: coin.market_cap,
    volume: coin.total_volume,
    high24h: coin.high_24h,
    low24h: coin.low_24h,
    circulatingSupply: coin.circulating_supply,
  }));
}

app.get("/api/coin-search", async (req, res) => {
  const query = String(req.query.q ?? "").trim().slice(0, 80);
  if (query.length < 2) return res.json({ coins: [] });

  const cacheKey = query.toLowerCase();
  const cached = coinSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < COIN_SEARCH_CACHE_DURATION) {
    return res.json({ coins: cached.coins });
  }

  try {
    const coins = await searchCoinMarkets(query);
    coinSearchCache.set(cacheKey, { coins, cachedAt: Date.now() });
    if (coinSearchCache.size > 100) {
      coinSearchCache.delete(coinSearchCache.keys().next().value);
    }
    res.json({ coins });
  } catch (error) {
    console.error("Coin search error:", error);
    res.status(502).json({ error: "Unable to search additional coins" });
  }
});

app.get("/api/global", async (req, res) => {
  res.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  if (globalCache && Date.now() - globalCacheTime < GLOBAL_CACHE_DURATION) {
    console.log("Using server-side global cache.");
    return res.json(globalCache);
  }
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/global");

    if (!response.ok) {
      return res.status(response.status).json({
        error: `CoinGecko API error: ${response.status}`,
      });
    }

    const data = await response.json();

    globalCache = data;
    globalCacheTime = Date.now();

    res.json(data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch global market data",
    });
  }
});

let marketSentimentCache = null;
let marketSentimentCacheTime = 0;
const MARKET_SENTIMENT_CACHE_DURATION = 15 * 60 * 1000;

function getMarketSentimentClassification(score) {
  if (score < 25) return "Extreme Fear";
  if (score < 45) return "Fear";
  if (score < 56) return "Neutral";
  if (score < 75) return "Greed";
  return "Extreme Greed";
}

function calculateMarketSentiment(markets) {
  const coins = markets
    .filter((coin) => Number.isFinite(coin.market_cap) && coin.market_cap > 0)
    .map((coin) => ({
      marketCap: coin.market_cap,
      change24h: coin.price_change_percentage_24h,
      change7d: coin.price_change_percentage_7d_in_currency,
    }));
  const dailyCoins = coins.filter((coin) => Number.isFinite(coin.change24h));
  const weeklyCoins = coins.filter((coin) => Number.isFinite(coin.change7d));

  if (!dailyCoins.length || !weeklyCoins.length) {
    throw new Error("Not enough market data to calculate sentiment");
  }

  const weightedChange = (entries, key) => {
    const totalMarketCap = entries.reduce((sum, coin) => sum + coin.marketCap, 0);
    return entries.reduce(
      (sum, coin) => sum + coin.marketCap * coin[key],
      0,
    ) / totalMarketCap;
  };
  const change24h = weightedChange(dailyCoins, "change24h");
  const change7d = weightedChange(weeklyCoins, "change7d");
  const advancing = dailyCoins.filter((coin) => coin.change24h > 0).length;
  const breadthScore = (advancing / dailyCoins.length) * 100;
  const weightedTrend = change24h * 0.7 + change7d * 0.3;
  const returnScore = Math.max(0, Math.min(100, 50 + weightedTrend * 5));
  const score = Math.round(returnScore * 0.7 + breadthScore * 0.3);

  return {
    value: score,
    classification: getMarketSentimentClassification(score),
    timestamp: new Date().toISOString(),
    weightedChange24h: change24h,
    weightedChange7d: change7d,
    advancing,
    assets: dailyCoins.length,
  };
}

app.get("/api/market-sentiment", async (req, res) => {
  if (
    marketSentimentCache &&
    Date.now() - marketSentimentCacheTime < MARKET_SENTIMENT_CACHE_DURATION
  ) {
    return res.json(marketSentimentCache);
  }

  try {
    let markets = marketCache;
    if (!markets || Date.now() - marketCacheTime >= MARKET_CACHE_DURATION) {
      markets = await refreshMarketData();
    }
    marketSentimentCache = calculateMarketSentiment(markets);
    marketSentimentCacheTime = Date.now();
    res.json(marketSentimentCache);
  } catch (error) {
    console.error("Market sentiment error:", error);
    res.status(502).json({ error: "Market sentiment is temporarily unavailable" });
  }
});

function createTrendingResponse(status, warning = "") {
  const now = Date.now();
  return {
    ...trendingCache,
    meta: {
      status,
      provider: "CoinGecko",
      fetchedAt: new Date(trendingCacheTime).toISOString(),
      servedAt: new Date(now).toISOString(),
      ageMs: Math.max(0, now - trendingCacheTime),
      ...(warning ? { warning } : {}),
    },
  };
}

async function refreshTrendingData() {
  if (!trendingRefreshPromise) {
    trendingRefreshPromise = (async () => {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/search/trending",
        {
          headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        throw new Error(`CoinGecko trending API error: ${response.status}`);
      }
      const providerData = await response.json();
      const normalized = normalizeTrendingPayload(providerData, marketCache ?? []);
      if (!normalized.coins.length) {
        throw new Error("CoinGecko returned no valid trending coins");
      }
      trendingCache = normalized;
      trendingCacheTime = Date.now();
      return normalized;
    })().finally(() => {
      trendingRefreshPromise = null;
    });
  }
  return trendingRefreshPromise;
}

app.get("/api/trending", async (req, res) => {
  res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=300");
  const forceRefresh = req.query.refresh === "1";
  if (!forceRefresh && trendingCache && Date.now() - trendingCacheTime < TRENDING_CACHE_DURATION) {
    console.log("Using server-side trending cache.");
    return res.json(createTrendingResponse("cached"));
  }

  try {
    await refreshTrendingData();
    return res.json(createTrendingResponse("fresh"));
  } catch (error) {
    console.error("Trending refresh failed:", error.message);
    if (trendingCache) {
      return res.json(createTrendingResponse(
        "stale",
        "Live refresh failed. Showing the last successful trending snapshot.",
      ));
    }
    return res.status(502).json({ error: "Trending data is temporarily unavailable." });
  }
});

let newsCache = null;
let newsCacheTime = 0;
const NEWS_CACHE_DURATION = 5 * 60 * 1000;

app.get("/api/news", async (req, res) => {
  if (newsCache && Date.now() - newsCacheTime < NEWS_CACHE_DURATION) {
    console.log("Using server-side news cache.");
    return res.json(newsCache);
  }

  try {
    const response = await fetch("https://cryptocurrency.cv/api/news?limit=10");

    if (!response.ok) {
      const errorText = await response.text();

      console.log("NEWS STATUS:", response.status);
      console.log("NEWS RESPONSE:", errorText);

      return res.status(response.status).json({
        error: `Cryptocurrency.cv error: ${response.status}`,
      });
    }

    const data = await response.json();

    newsCache = data;
    newsCacheTime = Date.now();

    console.log("Fetched fresh news from Cryptocurrency.cv.");

    res.json(data);
  } catch (error) {
    console.error("News error:", error);

    res.status(500).json({
      error: "Failed to fetch crypto news",
    });
  }
});

// Breaking crypto news
let breakingNewsCache = null;
let breakingNewsCacheTime = 0;
const BREAKING_NEWS_CACHE_DURATION = 5 * 60 * 1000;

app.get("/api/breaking", async (req, res) => {
  if (
    breakingNewsCache &&
    Date.now() - breakingNewsCacheTime < BREAKING_NEWS_CACHE_DURATION
  ) {
    console.log("Using server-side breaking news cache.");
    return res.json(breakingNewsCache);
  }

  try {
    const response = await fetch("https://cryptocurrency.cv/api/breaking");

    if (!response.ok) {
      const errorText = await response.text();

      console.log("BREAKING NEWS STATUS:", response.status);
      console.log("BREAKING NEWS RESPONSE:", errorText);

      return res.status(response.status).json({
        error: `Cryptocurrency.cv error: ${response.status}`,
      });
    }

    const data = await response.json();

    breakingNewsCache = data;
    breakingNewsCacheTime = Date.now();

    console.log("Fetched fresh breaking news.");

    res.json(data);
  } catch (error) {
    console.error("Breaking news error:", error);

    res.status(500).json({
      error: "Failed to fetch breaking crypto news",
    });
  }
});

// News image proxy
// app.get("/api/news-image", async (req, res) => {
//   const imageUrl = req.query.url;

//   if (!imageUrl) {
//     return res.status(400).send("Missing image URL");
//   }

//   try {
//     const response = await fetch(imageUrl, {
//       headers: {
//         "User-Agent":
//           "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
//         Accept:
//           "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
//       },
//     });

//     if (!response.ok) {
//       console.log(`News image request failed: ${response.status} ${imageUrl}`);

//       return res.status(response.status).send("Unable to load image");
//     }

//     const contentType = response.headers.get("content-type");

//     if (!contentType || !contentType.startsWith("image/")) {
//       return res.status(415).send("Resource is not an image");
//     }

//     res.set("Content-Type", contentType);

//     const imageBuffer = Buffer.from(await response.arrayBuffer());

//     res.send(imageBuffer);
//   } catch (error) {
//     console.error("News image proxy error:", error);

//     res.status(500).send("Failed to load news image");
//   }
// });

app.get("/api/coins/:id", async (req, res) => {
  try {
    const coinId = req.params.id;

    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}`,
    );

    if (!response.ok) {
      return res.status(response.status).json({
        error: `CoinGecko API error: ${response.status}`,
      });
    }

    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch coin details",
    });
  }
});

app.get("/api/coins/:id/chart", async (req, res) => {
  try {
    const coinId = req.params.id;
    const interval = String(req.query.interval ?? "");

    if (interval) {
      const supportedIntervals = new Set(["1m", "5m", "1h", "4h"]);
      if (!supportedIntervals.has(interval)) {
        return res.status(400).json({ error: "Unsupported chart interval" });
      }

      const cachedCoin = marketCache?.find((coin) => coin.id === coinId);
      const searchedCoin = [...coinSearchCache.values()]
        .flatMap((entry) => entry.coins)
        .find((coin) => coin.id === coinId);
      const symbol = String(
        cachedCoin?.symbol ?? searchedCoin?.symbol ?? req.query.symbol ?? "",
      ).toUpperCase();

      if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
        return res.status(404).json({
          error: "This coin does not have a matching exchange symbol for these intervals",
        });
      }

      const pair = `${symbol}USDT`;
      const query = new URLSearchParams({ symbol: pair, interval, limit: "500" });
      const binanceHosts = [
        "https://data-api.binance.vision",
        "https://api.binance.com",
        "https://api1.binance.com",
      ];
      let klines = null;
      let upstreamError = "Binance did not return candle data";

      for (const host of binanceHosts) {
        try {
          const response = await fetch(`${host}/api/v3/klines?${query}`);
          const body = await response.json().catch(() => null);
          if (response.ok && Array.isArray(body) && body.length) {
            klines = body;
            break;
          }

          upstreamError = body?.msg
            ? `Binance ${response.status}: ${body.msg}`
            : `Binance returned HTTP ${response.status}`;
          // A missing trading pair is not fixed by trying another Binance host.
          if (response.status === 400) break;
        } catch (error) {
          upstreamError = error.message || "Unable to reach Binance";
        }
      }

      if (!klines) {
        return res.status(502).json({
          error: `Could not load ${interval} candles for ${pair}. ${upstreamError}`,
        });
      }

      if (!Array.isArray(klines) || !klines.length) {
        return res.status(502).json({ error: "No exchange candles were returned" });
      }

      return res.json({
        source: "Binance",
        ohlc: klines.map((candle) => [
          candle[0],
          Number(candle[1]),
          Number(candle[2]),
          Number(candle[3]),
          Number(candle[4]),
        ]),
        volumes: klines.map((candle) => [candle[0], Number(candle[7])]),
      });
    }

    const days = req.query.days || 1;

    const [ohlcResponse, marketResponse] = await Promise.all([
      fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
        { headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } },
      ),

      fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
        { headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } },
      ),
    ]);

    if (!ohlcResponse.ok || !marketResponse.ok) {
      const ohlcError = await ohlcResponse.text();
      const marketError = await marketResponse.text();

      console.log("OHLC STATUS:", ohlcResponse.status);
      console.log("OHLC RESPONSE:", ohlcError);

      console.log("MARKET STATUS:", marketResponse.status);
      console.log("MARKET RESPONSE:", marketError);

      return res.status(500).json({
        error: "CoinGecko request failed",
        ohlcStatus: ohlcResponse.status,
        marketStatus: marketResponse.status,
      });
    }

    const ohlc = await ohlcResponse.json();
    const marketData = await marketResponse.json();

    res.json({
      source: "CoinGecko",
      ohlc: ohlc,
      volumes: marketData.total_volumes,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: `Failed to fetch chart data: ${error.message || "unknown server error"}`,
    });
  }
});

app.use((error, req, res, next) => {
  // Do not serialize database, session, or authentication internals to clients.
  console.error("Unhandled API error:", error.message);
  if (res.headersSent) return next(error);
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must contain valid JSON." });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

async function broadcastMarketData() {
  try {
    const data = await refreshMarketData();

    const marketUpdate = data.map((coin) => ({
      id: coin.id,
      rank: coin.market_cap_rank,
      price: coin.current_price,
      change: coin.price_change_percentage_24h,
      change1h: coin.price_change_percentage_1h_in_currency,
      change7d: coin.price_change_percentage_7d_in_currency,
      marketCap: coin.market_cap,
      volume: coin.total_volume,
      sparkline: coin.sparkline_in_7d?.price ?? [],
    }));

    const message = JSON.stringify({
      type: "market_update",
      coins: marketUpdate,
    });

    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });

    console.log(`Broadcasted ${marketUpdate.length} coins.`);
  } catch (error) {
    console.error("Failed to broadcast market data:", error);
  }
}

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  broadcastMarketData();
});

const marketBroadcastTimer = setInterval(() => {
  if (wss.clients.size > 0) {
    broadcastMarketData();
  }
}, 60000);
marketBroadcastTimer.unref();

const alertScheduler = createAlertScheduler({
  intervalMs: ALERT_EVALUATION_INTERVAL_MS,
  runCycle: async () => {
    if (!marketCache || Date.now() - marketCacheTime > DEFAULT_MAX_DATA_AGE_MS) {
      await refreshMarketData();
    }
    return evaluateFreshMarketSnapshot({ markets: marketCache, observedAt: marketCacheTime });
  },
  onError: () => console.error("Market alert evaluation failed; existing alerts remain unchanged."),
});
if (process.env.ALERT_SCHEDULER_DISABLED !== "true") alertScheduler.start();
telegramExpiryMaintenance.start();

const currentTelegramConfig = telegramConfig();
if (currentTelegramConfig.deliveryConfigured && !currentTelegramConfig.workerDisabled) telegramWorker.start();
if (currentTelegramConfig.issues.length) {
  console.warn(`Telegram integration is not fully ready: ${currentTelegramConfig.issues.join(", ")}.`);
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping background work.`);
  clearInterval(marketBroadcastTimer);
  alertScheduler.stop();
  telegramExpiryMaintenance.stop();
  telegramWorker.stop();
  wss.close();
  const forceExitTimer = setTimeout(() => process.exit(1), 15_000);
  forceExitTimer.unref();
  server.close(async () => {
    await Promise.all([telegramExpiryMaintenance.whenIdle(), telegramWorker.whenIdle()]);
    await pool.end().catch(() => {});
    clearTimeout(forceExitTimer);
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
