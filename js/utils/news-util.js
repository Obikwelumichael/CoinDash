export function scoreNewsArticle(article) {
  const title = (article.title || "").toLowerCase();
  const description = (article.description || "").toLowerCase();

  const text = `${title} ${description}`;

  let score = 0;

  const majorCoins = [
    "bitcoin",
    "btc",
    "ethereum",
    "eth",
    "solana",
    "sol",
    "bnb",
    "xrp",
    "cardano",
    "ada",
    "dogecoin",
    "doge",
    "avalanche",
    "avax",
    "chainlink",
    "link",
    "polkadot",
    "dot",
  ];

  const mentionedCoins = majorCoins.filter((coin) => text.includes(coin));

  if (mentionedCoins.length > 0) {
    score += Math.min(mentionedCoins.length * 2, 6);
  }

  const highImpactKeywords = [
    "bitcoin",
    "btc",
    "ethereum",
    "eth",
    "etf",
    "fed",
    "interest rate",
    "regulation",
    "sec",
    "hack",
    "exploit",
    "liquidation",
    "exchange",
    "tariff",
    "ban",
    "approval",
    "outflow",
    "inflow",
  ];

  highImpactKeywords.forEach((keyword) => {
    if (text.includes(keyword)) {
      score += 3;
    }
  });

  const marketKeywords = [
    "crypto market",
    "market",
    "price",
    "trading",
    "volume",
    "funding",
    "valuation",
    "institutional",
  ];

  marketKeywords.forEach((keyword) => {
    if (text.includes(keyword)) {
      score += 1;
    }
  });

  if (article.pubDate) {
    const ageMinutes =
      (Date.now() - new Date(article.pubDate).getTime()) / (1000 * 60);

    if (ageMinutes < 30) {
      score += 4;
    } else if (ageMinutes < 60) {
      score += 3;
    } else if (ageMinutes < 180) {
      score += 2;
    }
  }

  if (typeof article.credibility === "number") {
    score += article.credibility * 2;
  }

  if (article.contentType === "news") {
    score += 1;
  }

  return score;
}

export function getNewsLabel(article, isTopStory) {
  if (isTopStory) {
    return "TOP STORY";
  }

  const score = scoreNewsArticle(article);

  if (score >= 8) {
    return "MARKET MOVING";
  }

  if (score >= 6) {
    return "MARKET WATCH";
  }

  return null;
}
