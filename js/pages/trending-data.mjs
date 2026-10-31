export const TRENDING_SNAPSHOT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeTrendingApiPayload(payload) {
  const coins = (Array.isArray(payload?.coins) ? payload.coins : [])
    .map((coin, index) => {
      if (typeof coin?.id !== "string" || !coin.id.trim()) return null;
      const rank = Number(coin.trendingRank);
      return {
        id: coin.id,
        name: typeof coin.name === "string" && coin.name.trim() ? coin.name.trim() : null,
        symbol: typeof coin.symbol === "string" && coin.symbol.trim() ? coin.symbol.trim() : null,
        image: typeof coin.image === "string" ? coin.image : "",
        trendingRank: Number.isInteger(rank) && rank > 0 ? rank : null,
        providerScore: numericOrNull(coin.providerScore),
        providerOrder: numericOrNull(coin.providerOrder) ?? index + 1,
        marketRank: numericOrNull(coin.marketRank),
        price: numericOrNull(coin.price),
        change24h: numericOrNull(coin.change24h),
        marketCap: numericOrNull(coin.marketCap),
        volume24h: numericOrNull(coin.volume24h),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.trendingRank === null && b.trendingRank === null) return a.providerOrder - b.providerOrder;
      if (a.trendingRank === null) return 1;
      if (b.trendingRank === null) return -1;
      return a.trendingRank - b.trendingRank;
    });

  const categories = (Array.isArray(payload?.categories) ? payload.categories : [])
    .map((category, index) => {
      if (typeof category?.name !== "string" || !category.name.trim()) return null;
      return {
        id: String(category.id ?? category.slug ?? category.name),
        name: category.name.trim(),
        trendingRank: numericOrNull(category.trendingRank) ?? index + 1,
        coinCount: numericOrNull(category.coinCount),
        marketCapChange1h: numericOrNull(category.marketCapChange1h),
        images: Array.isArray(category.images)
          ? category.images.filter((image) => typeof image === "string").slice(0, 3)
          : [],
      };
    })
    .filter(Boolean);

  const status = ["fresh", "cached", "stale"].includes(payload?.meta?.status)
    ? payload.meta.status
    : "unavailable";
  const fetchedAt = Number.isFinite(Date.parse(payload?.meta?.fetchedAt))
    ? payload.meta.fetchedAt
    : null;

  return {
    coins,
    categories,
    meta: {
      status,
      fetchedAt,
      ageMs: numericOrNull(payload?.meta?.ageMs),
      warning: typeof payload?.meta?.warning === "string" ? payload.meta.warning : "",
    },
  };
}

export function createTrendingSnapshot(coins, providerFetchedAt, now = new Date()) {
  const rankings = (Array.isArray(coins) ? coins : [])
    .filter((coin) => typeof coin?.id === "string" && Number.isInteger(coin.trendingRank))
    .map((coin) => ({ coinId: coin.id, rank: coin.trendingRank }));
  if (!rankings.length) return null;
  return {
    capturedAt: now.toISOString(),
    providerFetchedAt: Number.isFinite(Date.parse(providerFetchedAt)) ? providerFetchedAt : null,
    rankings,
  };
}

export function isTrendingSnapshotUsable(
  snapshot,
  currentProviderFetchedAt,
  now = new Date(),
  maxAge = TRENDING_SNAPSHOT_MAX_AGE,
) {
  if (!snapshot || !Array.isArray(snapshot.rankings) || !snapshot.rankings.length) return false;
  const capturedAt = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAt) || now.getTime() - capturedAt > maxAge || capturedAt > now.getTime()) {
    return false;
  }
  if (
    snapshot.providerFetchedAt &&
    currentProviderFetchedAt &&
    snapshot.providerFetchedAt === currentProviderFetchedAt
  ) {
    return false;
  }
  return snapshot.rankings.every(
    (entry) => typeof entry?.coinId === "string" && Number.isInteger(entry.rank) && entry.rank > 0,
  );
}

export function calculateRankChanges(currentTrending, snapshot) {
  const previous = Array.isArray(snapshot?.rankings) ? snapshot.rankings : [];
  const previousById = new Map(previous.map((coin) => [coin.coinId, coin.rank]));
  const currentById = new Map(currentTrending.map((coin) => [coin.id, coin]));
  const movements = currentTrending.flatMap((coin) => {
    const previousRank = previousById.get(coin.id);
    if (!Number.isInteger(previousRank) || !Number.isInteger(coin.trendingRank)) return [];
    const rankMovement = previousRank - coin.trendingRank;
    return [{
      ...coin,
      previousRank,
      rankMovement,
      status: rankMovement > 0 ? "rising" : rankMovement < 0 ? "cooling" : "stable",
    }];
  });
  const counts = {
    rising: movements.filter((coin) => coin.status === "rising").length,
    stable: movements.filter((coin) => coin.status === "stable").length,
    cooling: movements.filter((coin) => coin.status === "cooling").length,
  };
  return {
    counts,
    compared: movements.length,
    newCount: currentTrending.filter((coin) => !previousById.has(coin.id)).length,
    exitedCount: previous.filter((coin) => !currentById.has(coin.coinId)).length,
    observedAt: snapshot?.capturedAt ?? null,
    movers: movements
      .filter((coin) => coin.rankMovement !== 0)
      .sort((a, b) => Math.abs(b.rankMovement) - Math.abs(a.rankMovement))
      .slice(0, 4),
    movements,
  };
}

export function filterTrendingCategories(categories, selectedId = "all") {
  if (!Array.isArray(categories)) return [];
  if (selectedId === "all") return [...categories];
  return categories.filter((category) => category.id === selectedId);
}

export function shouldApplyTrendingResponse(requestId, activeRequestId) {
  return requestId === activeRequestId;
}
