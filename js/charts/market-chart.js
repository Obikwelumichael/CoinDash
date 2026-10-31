import { formatPrice, formatLargeNumber } from "../utils/formatters.js";

const priceChartContainer = document.getElementById("priceChart");
const volumeChartContainer = document.getElementById("volumeChart");
const rsiChartContainer = document.getElementById("rsiChart");
const rsiValue = document.getElementById("rsiValue");
const chartReadout = {
  open: document.getElementById("chartOpen"),
  high: document.getElementById("chartHigh"),
  low: document.getElementById("chartLow"),
  close: document.getElementById("chartClose"),
};
const chartStatus = document.getElementById("chartStatus");
const chartDataSource = document.getElementById("chartDataSource");

let currentChart = null;
let currentVolumeChart = null;
let currentRsiChart = null;
let currentCandleSeries = null;
let currentEmaSeries = null;
let currentRsiSeries = null;
let currentCandles = [];
let currentCoinId = null;
let chartGeneration = 0;
const chartCache = {};
const chartRequests = {};
const CACHE_DURATIONS = {
  "1m": 20 * 1000,
  "5m": 30 * 1000,
  "1h": 60 * 1000,
  "4h": 60 * 1000,
  default: 5 * 60 * 1000,
};

export async function loadChart(coin, timeframe) {
  const range = typeof timeframe === "object" ? timeframe : { days: timeframe };
  const cacheKey = `${coin.id}-${range.interval ?? `${range.days}d`}`;
  if (chartRequests[cacheKey]) return;

  const requestGeneration = ++chartGeneration;
  const cachedData = chartCache[cacheKey];

  const cacheDuration = CACHE_DURATIONS[range.interval] ?? CACHE_DURATIONS.default;
  if (cachedData && Date.now() - cachedData.timestamp < cacheDuration) {
    chartStatus.textContent = "";
    try {
      chartDataSource.textContent = cachedData.source;
      createCharts(coin, cachedData.ohlc, cachedData.volumes);
    } catch (error) {
      console.error("Unable to render TradingView chart:", error);
      chartStatus.textContent = "Unable to render chart.";
    }
    return;
  }

  chartStatus.textContent = "Loading chart...";
  chartRequests[cacheKey] = requestGeneration;

  try {
    const params = new URLSearchParams(
      range.interval
        ? { interval: range.interval, symbol: String(coin.symbol ?? "") }
        : { days: String(range.days) },
    );
    const response = await fetch(`/api/coins/${coin.id}/chart?${params}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 429) {
        throw new Error("Too many requests. Please wait a moment.");
      }
      throw new Error(errorData.error ?? `API error: ${response.status}`);
    }

    const data = await response.json();
    if (requestGeneration !== chartGeneration) return;

    chartCache[cacheKey] = {
      ohlc: data.ohlc,
      volumes: data.volumes,
      source: data.source ?? "CoinGecko",
      timestamp: Date.now(),
    };
    chartStatus.textContent = "";
    chartDataSource.textContent = data.source ?? "CoinGecko";
    createCharts(coin, data.ohlc, data.volumes);
  } catch (error) {
    console.error("Error loading chart data:", error);
    if (requestGeneration === chartGeneration) {
      chartStatus.textContent = error.message || "Unable to load chart data.";
    }
  } finally {
    if (chartRequests[cacheKey] === requestGeneration) {
      delete chartRequests[cacheKey];
    }
  }
}

export function clearChart() {
  chartGeneration += 1;
  Object.keys(chartRequests).forEach((cacheKey) => delete chartRequests[cacheKey]);
  destroyCharts();
  chartStatus.textContent = "";
  chartDataSource.textContent = "CoinGecko";
  rsiValue.textContent = "—";
  rsiValue.classList.remove("positive", "negative");

  Object.values(chartReadout).forEach((value) => {
    value.textContent = "—";
    value.classList.remove("positive", "negative");
  });
}

function destroyCharts() {
  currentChart?.remove();
  currentVolumeChart?.remove();
  currentRsiChart?.remove();
  currentChart = null;
  currentVolumeChart = null;
  currentRsiChart = null;
  currentCandleSeries = null;
  currentEmaSeries = null;
  currentRsiSeries = null;
  currentCandles = [];
  currentCoinId = null;
}

function chartPalette() {
  const light = document.documentElement.dataset.theme === "light";
  return light
    ? {
        background: "#eef1f8",
        text: "#4f5872",
        gridVertical: "rgba(45, 52, 85, 0.055)",
        gridHorizontal: "rgba(45, 52, 85, 0.1)",
        crosshair: "rgba(8, 127, 123, 0.48)",
        crosshairSoft: "rgba(8, 127, 123, 0.36)",
        crosshairLabel: "#087f7b",
        border: "rgba(45, 52, 85, 0.18)",
        ema: "#7053dc",
        rsi: "#087f7b",
      }
    : {
        background: "#0b0d19",
        text: "#b7bdd8",
        gridVertical: "rgba(158, 168, 255, 0.045)",
        gridHorizontal: "rgba(158, 168, 255, 0.08)",
        crosshair: "rgba(62, 233, 220, 0.45)",
        crosshairSoft: "rgba(62, 233, 220, 0.35)",
        crosshairLabel: "#21243a",
        border: "rgba(158, 168, 255, 0.14)",
        ema: "#a98aff",
        rsi: "#3ee9dc",
      };
}

function chartAppearance() {
  const library = window.LightweightCharts;
  const palette = chartPalette();
  return {
    layout: {
      background: { type: library.ColorType.Solid, color: palette.background },
      textColor: palette.text,
      fontFamily: '"DM Mono", monospace',
      fontSize: 12,
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: palette.gridVertical },
      horzLines: { color: palette.gridHorizontal },
    },
    crosshair: {
      vertLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshairLabel },
      horzLine: { color: palette.crosshairSoft, labelBackgroundColor: palette.crosshairLabel },
    },
    rightPriceScale: { textColor: palette.text, borderColor: palette.border },
    timeScale: { borderColor: palette.border },
  };
}

function applyCurrentChartTheme() {
  if (!window.LightweightCharts) return;
  const appearance = chartAppearance();
  [currentChart, currentVolumeChart, currentRsiChart].forEach((chart) => chart?.applyOptions(appearance));
  const palette = chartPalette();
  currentChart?.priceScale("right").applyOptions({ textColor: palette.text });
  currentEmaSeries?.applyOptions({ color: palette.ema });
  currentRsiSeries?.applyOptions({ color: palette.rsi });
}

export function updateLiveChart(update) {
  if (
    !currentCandleSeries ||
    currentCoinId !== update?.id ||
    !Number.isFinite(Number(update.price)) ||
    currentCandles.length === 0
  ) return;

  const lastCandle = currentCandles.at(-1);
  const price = Number(update.price);
  const liveCandle = {
    ...lastCandle,
    high: Math.max(lastCandle.high, price),
    low: Math.min(lastCandle.low, price),
    close: price,
  };
  currentCandles[currentCandles.length - 1] = liveCandle;
  currentCandleSeries.update(liveCandle);
  updateReadout(liveCandle);
}

function updateReadout(candle) {
  if (!candle) return;
  const isUp = candle.close >= candle.open;
  Object.entries({
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }).forEach(([key, value]) => {
    chartReadout[key].textContent = `$${formatPrice(value)}`;
    chartReadout[key].classList.toggle("positive", isUp);
    chartReadout[key].classList.toggle("negative", !isUp);
  });
}

function calculateEma(candles, period = 20) {
  const multiplier = 2 / (period + 1);
  let ema = null;
  return candles.flatMap((candle, index) => {
    ema = ema === null ? candle.close : (candle.close - ema) * multiplier + ema;
    return index >= period - 1 ? [{ time: candle.time, value: ema }] : [];
  });
}

function calculateRsi(candles, period = 14) {
  let averageGain = 0;
  let averageLoss = 0;
  const values = new Map();

  for (let index = 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (index <= period) {
      averageGain += gain / period;
      averageLoss += loss / period;
    } else {
      averageGain = (averageGain * (period - 1) + gain) / period;
      averageLoss = (averageLoss * (period - 1) + loss) / period;
    }

    if (index >= period) {
      const value =
        averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
      values.set(candles[index].time, { time: candles[index].time, value });
    }
  }

  return candles.map((candle) => values.get(candle.time) ?? { time: candle.time });
}

function nearestVolume(timestamp, volumes) {
  if (!volumes.length) return 0;
  return volumes.reduce(
    (nearest, point) =>
      Math.abs(point[0] - timestamp) < Math.abs(nearest[0] - timestamp)
        ? point
        : nearest,
    volumes[0],
  )[1];
}

function chartOptions({ showTime = false, priceFormatter, priceScaleWidth = 64 } = {}) {
  return {
    autoSize: true,
    ...chartAppearance(),
    rightPriceScale: {
      ...chartAppearance().rightPriceScale,
      visible: true,
      minimumWidth: priceScaleWidth,
      ticksVisible: true,
      entireTextOnly: true,
    },
    timeScale: {
      ...chartAppearance().timeScale,
      timeVisible: showTime,
      secondsVisible: false,
      rightOffset: 3,
      barSpacing: 12,
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    localization: priceFormatter ? { priceFormatter } : undefined,
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
  };
}

function createCharts(coin, ohlc, volumes) {
  const library = window.LightweightCharts;
  if (!library) throw new Error("Lightweight Charts failed to load.");
  if (!Array.isArray(ohlc) || ohlc.length === 0) {
    throw new Error("CoinGecko returned no OHLC data.");
  }

  destroyCharts();

  const candles = ohlc.map((candle) => ({
    time: Math.floor(candle[0] / 1000),
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
  }));
  currentCoinId = coin.id;
  currentCandles = candles;
  const volumePoints = Array.isArray(volumes) ? volumes : [];
  const rsiData = calculateRsi(candles);
  const latestRsi = rsiData.at(-1)?.value;

  rsiValue.textContent =
    latestRsi === undefined ? "Not enough history" : latestRsi.toFixed(1);
  rsiValue.classList.toggle("positive", latestRsi >= 50);
  rsiValue.classList.toggle("negative", latestRsi < 50);
  updateReadout(candles.at(-1));

  currentChart = library.createChart(
    priceChartContainer,
    chartOptions({
      showTime: true,
      priceFormatter: (price) => `$${formatPrice(price)}`,
      priceScaleWidth: 88,
    }),
  );
  const candleSeries = currentChart.addSeries(library.CandlestickSeries, {
    upColor: "#089981",
    downColor: "#f23645",
    borderVisible: false,
    wickUpColor: "#089981",
    wickDownColor: "#f23645",
    priceLineVisible: true,
    lastValueVisible: true,
  });
  currentCandleSeries = candleSeries;
  candleSeries.setData(candles);
  currentChart.priceScale("right").applyOptions({
    visible: true,
    minimumWidth: 96,
    textColor: chartPalette().text,
    ticksVisible: true,
    scaleMargins: { top: 0.05, bottom: 0.08 },
  });

  const emaSeries = currentChart.addSeries(library.LineSeries, {
    color: chartPalette().ema,
    lineWidth: 2,
    title: "EMA 20",
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  currentEmaSeries = emaSeries;
  emaSeries.setData(calculateEma(candles));

  currentVolumeChart = library.createChart(
    volumeChartContainer,
    chartOptions({ priceFormatter: (value) => formatLargeNumber(value) }),
  );
  const volumeSeries = currentVolumeChart.addSeries(library.HistogramSeries, {
    priceFormat: { type: "volume" },
    priceLineVisible: false,
    lastValueVisible: false,
  });
  volumeSeries.setData(
    candles.map((candle) => ({
      time: candle.time,
      value: nearestVolume(candle.time * 1000, volumePoints),
      color:
        candle.close >= candle.open
          ? "rgba(8, 153, 129, 0.62)"
          : "rgba(242, 54, 69, 0.58)",
    })),
  );
  currentVolumeChart.priceScale("right").applyOptions({
    scaleMargins: { top: 0.08, bottom: 0 },
  });

  currentRsiChart = library.createChart(
    rsiChartContainer,
    chartOptions({ priceFormatter: (value) => value.toFixed(0) }),
  );
  const rsiSeries = currentRsiChart.addSeries(library.LineSeries, {
    color: chartPalette().rsi,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  currentRsiSeries = rsiSeries;
  rsiSeries.setData(rsiData);
  [30, 70].forEach((level) => {
    rsiSeries.createPriceLine({
      price: level,
      color: "rgba(255, 113, 142, 0.38)",
      lineWidth: 1,
      lineStyle: library.LineStyle.Dashed,
      axisLabelVisible: false,
      title: String(level),
    });
  });

  currentChart.subscribeCrosshairMove((event) => {
    const candle = event.seriesData.get(candleSeries);
    if (candle) updateReadout(candle);
  });

  if (candles.length > 120) {
    currentChart.timeScale().setVisibleLogicalRange({
      from: candles.length - 120,
      to: candles.length + 3,
    });
  } else {
    currentChart.timeScale().fitContent();
  }
  const visibleRange = currentChart.timeScale().getVisibleLogicalRange();
  if (visibleRange) {
    currentVolumeChart.timeScale().setVisibleLogicalRange(visibleRange);
    currentRsiChart.timeScale().setVisibleLogicalRange(visibleRange);
  }
  synchronizeTimeScales([
    currentChart,
    currentVolumeChart,
    currentRsiChart,
  ]);
}

function synchronizeTimeScales(charts) {
  let synchronizing = false;
  charts.forEach((sourceChart) => {
    sourceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || synchronizing) return;
      synchronizing = true;
      charts.forEach((targetChart) => {
        if (targetChart !== sourceChart) {
          targetChart.timeScale().setVisibleLogicalRange(range);
        }
      });
      synchronizing = false;
    });
  });
}

const closeDetailsButton = document.getElementById("closeDetails");
const coinDetailsPanel = document.getElementById("coinDetails");

window.addEventListener("cointrack:theme-change", applyCurrentChartTheme);

if (closeDetailsButton && coinDetailsPanel) {
  closeDetailsButton.addEventListener("click", () => {
    coinDetailsPanel.style.display = "none";
    clearChart();
  });
}
