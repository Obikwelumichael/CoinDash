import { scoreNewsArticle, getNewsLabel } from "../utils/news-util.js";

const cryptoNewsContainer = document.getElementById("cryptoNews");
const DASHBOARD_NEWS_LIMIT = 10;

function showNewsMessage(message) {
  const status = document.createElement("p");

  status.className = "trending-message";
  status.textContent = message;

  cryptoNewsContainer.replaceChildren(status);
}

function formatNewsTime(pubDate) {
  if (!pubDate) {
    return "";
  }

  const date = new Date(pubDate);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function loadMarketNews() {
  try {
    if (!cryptoNewsContainer.children.length) {
      showNewsMessage("Loading latest crypto news...");
    }

    const response = await fetch(`/api/breaking?t=${Date.now()}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch breaking news: ${response.status}`);
    }

    const data = await response.json();

    const articles = Array.isArray(data.articles) ? data.articles : [];

    if (articles.length === 0) {
      showNewsMessage("No crypto news is available right now.");
      return;
    }

    renderMarketNews(articles);
  } catch (error) {
    console.error("Market news error:", error);

    showNewsMessage("Unable to load crypto news right now.");
  }
}

function renderMarketNews(articles) {
  cryptoNewsContainer.replaceChildren();

  const rankedArticles = [...articles]
    .sort((a, b) => scoreNewsArticle(b) - scoreNewsArticle(a))
    .slice(0, DASHBOARD_NEWS_LIMIT);

  rankedArticles.forEach((article, index) => {
    const card = document.createElement("a");

    card.className = "news-card";
    card.href = article.link;
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    const createImagePlaceholder = () => {
      const placeholder = document.createElement("div");
      placeholder.className = "news-image-placeholder";
      placeholder.setAttribute("role", "img");
      placeholder.setAttribute("aria-label", "Article image unavailable");
      placeholder.innerHTML = `
        <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <rect x="7" y="9" width="34" height="30" rx="5"></rect>
          <circle cx="18" cy="19" r="3"></circle>
          <path d="m11 34 10-10 7 7 5-5 5 8"></path>
        </svg>
        <span>Image unavailable</span>
      `;
      return placeholder;
    };

    if (article.imageUrl) {
      const image = document.createElement("img");

      image.src = article.imageUrl;
      image.alt = article.title || "Crypto news article";
      image.loading = "lazy";
      image.decoding = "async";
      image.className = "news-image";

      image.onerror = () => {
        image.replaceWith(createImagePlaceholder());
        card.classList.remove("has-image");
        card.classList.add("no-news-image");
      };

      card.classList.add("has-image");
      card.appendChild(image);
    } else {
      card.classList.add("no-news-image");
      card.appendChild(createImagePlaceholder());
    }

    const content = document.createElement("div");
    content.className = "news-content";

    const newsLabel = getNewsLabel(article, index === 0);

    if (newsLabel) {
      const label = document.createElement("span");

      label.className = "news-label";
      label.textContent = newsLabel;

      content.appendChild(label);
    }

    if (article.category) {
      const category = document.createElement("span");

      category.className = "news-category";
      category.textContent = article.category;

      content.appendChild(category);
    }

    const title = document.createElement("h3");

    title.textContent = article.title || "Untitled article";

    const description = document.createElement("p");

    description.textContent =
      article.description || "No description available.";

    const meta = document.createElement("div");

    meta.className = "news-meta";

    const source = document.createElement("span");

    source.textContent = article.source || "Unknown source";

    const date = document.createElement("span");

    date.textContent = article.timeAgo || formatNewsTime(article.pubDate);

    meta.append(source, date);

    const readMore = document.createElement("span");

    readMore.className = "news-read-more";
    readMore.textContent = "Read article →";

    content.append(title, description, meta, readMore);

    card.appendChild(content);

    cryptoNewsContainer.appendChild(card);
  });
}

let newsLoaded = false;

function startMarketNews() {
  if (newsLoaded) return;
  newsLoaded = true;
  loadMarketNews();

  // Refresh only after the feed has been requested for the first time.
  setInterval(loadMarketNews, 5 * 60 * 1000);
}

if ("IntersectionObserver" in window) {
  const newsObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    newsObserver.disconnect();
    startMarketNews();
  }, { rootMargin: "500px 0px" });
  newsObserver.observe(cryptoNewsContainer);
} else {
  startMarketNews();
}
