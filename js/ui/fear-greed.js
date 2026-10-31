const panel = document.getElementById("sentimentPanel");
const section = document.getElementById("marketSentiment");

if (panel && section) {
  const navSentimentBadges = document.querySelectorAll(".nav-sentiment");
  const elements = {
    status: document.getElementById("sentimentStatus"),
    gauge: document.getElementById("sentimentGauge"),
    zones: document.getElementById("sentimentZones"),
    marker: document.getElementById("sentimentMarker"),
    value: document.getElementById("sentimentValue"),
    classification: document.getElementById("sentimentClassification"),
    change24h: document.getElementById("sentiment24h"),
    change7d: document.getElementById("sentiment7d"),
    breadth: document.getElementById("sentimentBreadth"),
    updated: document.getElementById("sentimentUpdated"),
  };

  const gaugeCenter = { x: 160, y: 165 };
  const gaugeRadius = 110;
  const sentimentRanges = [
    { start: 0, end: 25, name: "Extreme Fear", className: "fear-extreme" },
    { start: 25, end: 45, name: "Fear", className: "fear" },
    { start: 45, end: 56, name: "Neutral", className: "neutral" },
    { start: 56, end: 75, name: "Greed", className: "greed" },
    { start: 75, end: 100, name: "Extreme Greed", className: "greed-extreme" },
  ];
  let requestInProgress = false;

  function pointForScore(score, radius = gaugeRadius) {
    const angle = Math.PI - (score / 100) * Math.PI;
    return {
      x: gaugeCenter.x + Math.cos(angle) * radius,
      y: gaugeCenter.y - Math.sin(angle) * radius,
    };
  }

  function drawGaugeZones() {
    const fragment = document.createDocumentFragment();
    sentimentRanges.forEach((range) => {
      const start = pointForScore(range.start);
      const end = pointForScore(range.end);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        `M ${start.x} ${start.y} A ${gaugeRadius} ${gaugeRadius} 0 0 1 ${end.x} ${end.y}`,
      );
      path.setAttribute("class", `sentiment-zone ${range.className}`);
      path.setAttribute("aria-hidden", "true");
      fragment.appendChild(path);
    });
    elements.zones.replaceChildren(fragment);
  }

  function formatPercent(value) {
    return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  }

  function renderSentiment(data) {
    if (data.value === null || data.value === undefined || data.value === "") {
      throw new Error("Invalid Fear & Greed score");
    }
    const score = Number(data.value);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error("Invalid Fear & Greed score");
    }

    const range = sentimentRanges.find(({ name }) => name === data.classification);
    if (!range) throw new Error("Invalid Fear & Greed classification");
    const classification = range.name;
    const change24h = Number(data.weightedChange24h);
    const change7d = Number(data.weightedChange7d);
    const advancing = Number(data.advancing);
    const assets = Number(data.assets);
    if (
      !Number.isFinite(change24h) ||
      !Number.isFinite(change7d) ||
      !Number.isInteger(advancing) ||
      !Number.isInteger(assets) ||
      assets < 1 ||
      advancing < 0 ||
      advancing > assets
    ) {
      throw new Error("Invalid market breadth data");
    }

    navSentimentBadges.forEach((badge) => {
      const label = classification.replace("Extreme ", "");
      badge.dataset.sentiment = range.className;
      badge.setAttribute(
        "aria-label",
        `Today's overall crypto market sentiment: ${classification}, score ${score} out of 100`,
      );
      badge.querySelector(".nav-sentiment-value").textContent = `${label} · ${score}`;
      badge.querySelector(".nav-sentiment-fill").style.width = `${score}%`;
    });

    const markerPoint = pointForScore(score, gaugeRadius - 4);
    elements.marker.setAttribute("cx", markerPoint.x.toFixed(2));
    elements.marker.setAttribute("cy", markerPoint.y.toFixed(2));
    elements.marker.setAttribute("class", range?.className ?? "neutral");
    elements.marker.setAttribute("opacity", "1");
    elements.gauge.setAttribute(
      "aria-label",
      `Overall crypto market sentiment score ${score} out of 100: ${classification}`,
    );
    elements.value.textContent = String(score);
    elements.classification.textContent = classification;
    elements.classification.dataset.sentiment = range?.className ?? "neutral";
    elements.change24h.textContent = formatPercent(change24h);
    elements.change7d.textContent = formatPercent(change7d);
    elements.change24h.classList.toggle("positive", change24h >= 0);
    elements.change24h.classList.toggle("negative", change24h < 0);
    elements.change7d.classList.toggle("positive", change7d >= 0);
    elements.change7d.classList.toggle("negative", change7d < 0);

    const breadthRatio = advancing / assets;
    const breadthDirection = breadthRatio > 0.5 ? "up" : breadthRatio < 0.5 ? "down" : "steady";
    elements.breadth.className = `sentiment-trend ${breadthDirection}`;
    elements.breadth.textContent = `${advancing} of ${assets} top coins advancing`;

    const updatedAt = data.timestamp ? new Date(data.timestamp) : null;
    elements.updated.textContent = `Updated ${
      updatedAt && Number.isFinite(updatedAt.getTime())
        ? updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "—"
    }`;
    elements.status.textContent = `CoinDash index · ${assets} top coins`;
    panel.dataset.state = "ready";
    panel.setAttribute("aria-busy", "false");
  }

  async function loadSentiment() {
    if (requestInProgress) return;
    requestInProgress = true;
    panel.setAttribute("aria-busy", "true");

    try {
      const response = await fetch("/api/market-sentiment");
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      renderSentiment(await response.json());
    } catch (error) {
      console.error("Unable to load market sentiment:", error);
      navSentimentBadges.forEach((badge) => {
        badge.dataset.sentiment = "neutral";
        badge.setAttribute("aria-label", "Market sentiment data is unavailable");
        badge.querySelector(".nav-sentiment-value").textContent = "Unavailable";
        badge.querySelector(".nav-sentiment-fill").style.width = "50%";
      });
      elements.status.textContent = "Market sentiment unavailable. Try again later.";
      panel.dataset.state = "error";
      panel.setAttribute("aria-busy", "false");
    } finally {
      requestInProgress = false;
    }
  }

  drawGaugeZones();
  loadSentiment();
  window.setInterval(loadSentiment, 15 * 60 * 1000);
}
