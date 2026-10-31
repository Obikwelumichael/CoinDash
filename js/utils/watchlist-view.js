export function isWatchlistNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function compareNumbers(left, right, key) {
  const leftValid = isWatchlistNumber(left[key]);
  const rightValid = isWatchlistNumber(right[key]);
  if (leftValid && rightValid) return Number(right[key]) - Number(left[key]);
  if (leftValid) return -1;
  if (rightValid) return 1;
  return left.name.localeCompare(right.name);
}

export function selectWatchlistCoins(coins, { query = "", filter = "all", sort = "name-asc" } = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  const selected = coins.filter((coin) => {
    const matchesQuery = !normalizedQuery
      || coin.name.toLocaleLowerCase().includes(normalizedQuery)
      || coin.symbol.toLocaleLowerCase().includes(normalizedQuery)
      || coin.id.toLocaleLowerCase().includes(normalizedQuery);
    const matchesFilter = filter === "all"
      || (filter === "gainers" && isWatchlistNumber(coin.change) && Number(coin.change) > 0)
      || (filter === "losers" && isWatchlistNumber(coin.change) && Number(coin.change) < 0);
    return matchesQuery && matchesFilter;
  });

  if (sort === "name-asc") return selected.sort((left, right) => left.name.localeCompare(right.name));
  const key = {
    "price-desc": "price",
    "change-desc": "change",
    "market-cap-desc": "marketCap",
    "volume-desc": "volume",
  }[sort];
  return key ? selected.sort((left, right) => compareNumbers(left, right, key)) : selected;
}

export function summarizeWatchlist(coins) {
  return {
    count: coins.length,
    gainers: coins.filter((coin) => isWatchlistNumber(coin.change) && Number(coin.change) > 0).length,
    losers: coins.filter((coin) => isWatchlistNumber(coin.change) && Number(coin.change) < 0).length,
  };
}
