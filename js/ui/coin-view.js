import { formatPrice, formatChangePercent, formatLargeNumber } from "../utils/formatters.js";
import { createFavoriteButton } from "./watchlist-control.js";

const coinGrid = document.getElementById("coinGrid");
const coinTableBody = document.getElementById("coinTableBody");

export function updateCoinUI(update, changed) {
  const coinCard = document.querySelector(`.coin-card[data-coin-id="${update.id}"]`);
  if (coinCard) {
    const price = coinCard.querySelector(".coin-price-value");
    const change = coinCard.querySelector(".coin-change-value");
    const marketCap = coinCard.querySelector(".coin-market-cap-value");
    if (changed.price && price) {
      price.textContent = `$${formatPrice(update.price)}`;
      price.classList.remove("price-flash");
      void price.offsetWidth;
      price.classList.add("price-flash");
    }
    if (changed.change && change) {
      change.textContent = formatChangePercent(update.change);
      change.classList.toggle("positive", update.change !== null && update.change >= 0);
      change.classList.toggle("negative", update.change !== null && update.change < 0);
    }
    if (changed.marketCap && marketCap) marketCap.textContent = formatLargeNumber(update.marketCap);
  }

  const row = document.querySelector(`tr[data-coin-id="${update.id}"]`);
  if (row) {
    const price = row.querySelector(".table-price");
    const change = row.querySelector(".table-change-24h");
    const marketCap = row.querySelector(".table-market-cap");
    const volume = row.querySelector(".table-volume");
    const change1h = row.querySelector(".table-change-1h");
    const change7d = row.querySelector(".table-change-7d");
    const rank = row.querySelector(".table-rank");
    const sparkline = row.querySelector(".table-sparkline");
    [
      ["price", "price"],
      ["change", "change"],
      ["marketCap", "marketCap"],
      ["volume", "volume"],
      ["change1h", "change1h"],
      ["change7d", "change7d"],
      ["rank", "default"],
    ].forEach(([changedKey, dataKey]) => {
      if (changed[changedKey]) row.dataset[dataKey] = update[changedKey] === null || update[changedKey] === undefined ? "" : String(update[changedKey]);
    });
    if (changed.price && price) {
      price.textContent = `$${formatPrice(update.price)}`;
      price.classList.remove("price-flash");
      void price.offsetWidth;
      price.classList.add("price-flash");
    }
    if (changed.change && change) {
      change.textContent = formatChangePercent(update.change);
      change.classList.toggle("positive", update.change !== null && update.change >= 0);
      change.classList.toggle("negative", update.change !== null && update.change < 0);
    }
    if (changed.marketCap && marketCap) marketCap.textContent = `$${formatLargeNumber(update.marketCap)}`;
    if (changed.volume && volume) volume.textContent = `$${formatLargeNumber(update.volume)}`;
    if (changed.change1h && change1h) {
      change1h.textContent = formatChangePercent(update.change1h);
      change1h.className = `table-change table-change-1h ${getChangeClass(update.change1h)}`;
    }
    if (changed.change7d && change7d) {
      change7d.textContent = formatChangePercent(update.change7d);
      change7d.className = `table-change table-change-7d ${getChangeClass(update.change7d)}`;
    }
    if (changed.rank && rank) rank.textContent = update.rank ?? "—";
    if (changed.sparkline && sparkline) {
      sparkline.innerHTML = createSparkline({
        sparkline: update.sparkline,
        change7d: update.change7d,
      });
    }
  }
}

function getChangeClass(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "";
  }
  return Number(value) >= 0 ? "positive" : "negative";
}

function createSparkline(coin) {
  const values = Array.isArray(coin.sparkline)
    ? coin.sparkline.map(Number).filter(Number.isFinite)
    : [];
  if (values.length < 2) {
    return '<span class="table-sparkline-empty">Unavailable</span>';
  }

  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 29 - ((value - min) / range) * 25;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const lineClass = Number(coin.change7d) >= 0 ? "positive" : "negative";

  return `<svg class="market-sparkline ${lineClass}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

export function displayCoins(coinsToDisplay, onSelectCoin) {
  coinGrid.innerHTML = "";
  if (coinsToDisplay.length === 0) {
    coinGrid.innerHTML = '<p class="no-results">No cryptocurrencies found.</p>';
    return;
  }

  coinsToDisplay.forEach((coin) => {
    const coinCard = document.createElement("article");
    coinCard.classList.add("coin-card");
    coinCard.tabIndex = -1;
    coinCard.dataset.coinId = coin.id;
    coinCard.addEventListener("click", () => onSelectCoin(coin));
    coinCard.innerHTML = `
      <div class="coin-header">
        <div class="coin-icon"><img src="${coin.image}" alt="${coin.name}" loading="lazy" decoding="async"></div>
        <div><h3>${coin.name}</h3><p>${coin.symbol}</p></div>
      </div>
      <div class="coin-price">
        <h2 class="coin-price-value">$${formatPrice(coin.price)}</h2>
        <span class="coin-change-value ${coin.change === null || coin.change === undefined ? "" : coin.change >= 0 ? "positive" : "negative"}">${formatChangePercent(coin.change)}</span>
      </div>
      <p class="coin-market-cap">Market Cap $<span class="coin-market-cap-value">${formatLargeNumber(coin.marketCap)}</span></p>
    `;
    coinCard.appendChild(createFavoriteButton(coin));
    coinGrid.appendChild(coinCard);
  });
}

export function displayCoinTable(coinsToDisplay, onSelectCoin) {
  coinTableBody.innerHTML = "";
  if (coinsToDisplay.length === 0) {
    coinTableBody.innerHTML = '<tr><td colspan="12">No cryptocurrencies found.</td></tr>';
    return;
  }

  coinsToDisplay.forEach((coin, index) => {
    const tableRow = document.createElement("tr");
    tableRow.dataset.coinId = coin.id;
    Object.entries({
      default: coin.rank,
      price: coin.price,
      change1h: coin.change1h,
      change: coin.change,
      change7d: coin.change7d,
      high24h: coin.high24h,
      low24h: coin.low24h,
      marketCap: coin.marketCap,
      volume: coin.volume,
      circulatingSupply: coin.circulatingSupply,
    }).forEach(([key, value]) => {
      tableRow.dataset[key] = value === null || value === undefined ? "" : String(value);
    });
    if (onSelectCoin) {
      tableRow.tabIndex = 0;
      tableRow.setAttribute("aria-label", `Show ${coin.name} chart`);
      tableRow.addEventListener("click", () => onSelectCoin(coin));
      tableRow.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelectCoin(coin);
      });
    }
    const rank = coin.rank ?? index + 1;
    tableRow.innerHTML = `
      <td class="table-rank">${rank}</td>
      <td class="table-coin"><img src="${coin.image}" alt="" loading="lazy" decoding="async"><strong>${coin.name}</strong><span>${coin.symbol}</span></td>
      <td class="table-price">$${formatPrice(coin.price)}</td>
      <td class="table-change table-change-1h ${getChangeClass(coin.change1h)}">${formatChangePercent(coin.change1h)}</td>
      <td class="table-change table-change-24h ${getChangeClass(coin.change)}">${formatChangePercent(coin.change)}</td>
      <td class="table-change table-change-7d ${getChangeClass(coin.change7d)}">${formatChangePercent(coin.change7d)}</td>
      <td class="table-high">${coin.high24h === null || coin.high24h === undefined ? "—" : `$${formatPrice(coin.high24h)}`}</td>
      <td class="table-low">${coin.low24h === null || coin.low24h === undefined ? "—" : `$${formatPrice(coin.low24h)}`}</td>
      <td class="table-market-cap">$${formatLargeNumber(coin.marketCap)}</td>
      <td class="table-volume">$${formatLargeNumber(coin.volume)}</td>
      <td class="table-supply">${coin.circulatingSupply === null || coin.circulatingSupply === undefined ? "—" : formatLargeNumber(coin.circulatingSupply)} ${coin.symbol}</td>
      <td class="table-sparkline">${createSparkline(coin)}</td>
    `;
    tableRow.querySelector(".table-coin").appendChild(createFavoriteButton(coin));
    coinTableBody.appendChild(tableRow);
  });
}
