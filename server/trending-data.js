function parseNumeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value.trim().replace(/[$,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTrendingPayload(payload, marketData = []) {
  const marketById = new Map(
    (Array.isArray(marketData) ? marketData : [])
      .filter((coin) => typeof coin?.id === "string")
      .map((coin) => [coin.id, coin]),
  );

  const coins = (Array.isArray(payload?.coins) ? payload.coins : [])
    .map((entry, index) => {
      const item = entry?.item;
      if (!item || typeof item.id !== "string" || !item.id.trim()) return null;
      const market = marketById.get(item.id);
      const data = item.data && typeof item.data === "object" ? item.data : {};
      const score = parseNumeric(item.score);
      const providerScore = Number.isInteger(score) && score >= 0 ? score : null;

      return {
        id: item.id,
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : null,
        symbol: typeof item.symbol === "string" && item.symbol.trim() ? item.symbol.trim() : null,
        image: item.large || item.small || item.thumb || null,
        trendingRank: providerScore === null ? null : providerScore + 1,
        providerScore,
        providerOrder: index + 1,
        marketRank: parseNumeric(item.market_cap_rank),
        price: parseNumeric(market?.current_price ?? data.price),
        change24h: parseNumeric(
          market?.price_change_percentage_24h ?? data.price_change_percentage_24h?.usd,
        ),
        marketCap: parseNumeric(market?.market_cap ?? data.market_cap),
        volume24h: parseNumeric(market?.total_volume ?? data.total_volume),
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
      const name = typeof category?.name === "string" ? category.name.trim() : "";
      if (!name) return null;
      const coinCount = parseNumeric(category.coins_count);
      const change1h = parseNumeric(category.market_cap_1h_change);
      return {
        id: String(category.id ?? category.slug ?? name),
        slug: typeof category.slug === "string" ? category.slug : null,
        name,
        trendingRank: index + 1,
        coinCount: coinCount !== null && coinCount >= 0 ? coinCount : null,
        marketCapChange1h: change1h,
        images: Array.isArray(category.top_3_coins_images)
          ? category.top_3_coins_images.filter((image) => typeof image === "string").slice(0, 3)
          : [],
      };
    })
    .filter(Boolean);

  return { coins, categories };
}

module.exports = { normalizeTrendingPayload, parseNumeric };
