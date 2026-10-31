export function formatPrice(price) {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

export function formatChangePercent(value) {
  const change = Number(value);
  if (value === null || value === undefined || !Number.isFinite(change)) {
    return "—";
  }
  return `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
}

export function formatLargeNumber(number) {
  if (number >= 1e12) return `${(number / 1e12).toFixed(2)}T`;
  if (number >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
  if (number >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
  return number.toString();
}
