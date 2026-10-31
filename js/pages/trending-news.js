const cryptoNewsContainer = document.getElementById("cryptoNews");

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

async function loadCryptoNews() {
  try {
    showNewsMessage("Loading latest crypto news...");

    const response = await fetch("/api/news");

    if (!response.ok) {
      throw new Error(`Failed to fetch news: ${response.status}`);
    }

    const data = await response.json();

    const articles = Array.isArray(data.articles) ? data.articles : [];

    if (articles.length === 0) {
      showNewsMessage("No crypto news is available right now.");
      return;
    }

    renderCryptoNews(articles);
  } catch (error) {
    console.error("Crypto news error:", error);

    showNewsMessage("Unable to load crypto news right now.");
  }
}

function renderCryptoNews(articles) {
  cryptoNewsContainer.replaceChildren();
  ngro;

  articles.forEach((article) => {
    const card = document.createElement("a");

    card.className = "news-card";
    card.href = article.link;
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    // News image
    if (article.imageUrl) {
      const image = document.createElement("img");

      image.src = article.imageUrl;
      image.alt = article.title || "Crypto news article";
      image.loading = "lazy";
      image.className = "news-image";

      image.addEventListener("error", () => {
        image.remove();
        card.classList.remove("has-image");
      });

      card.classList.add("has-image");
      card.appendChild(image);
    }

    // Text content
    const content = document.createElement("div");
    content.className = "news-content";

    // Category
    if (article.category) {
      const category = document.createElement("span");

      category.className = "news-category";
      category.textContent = article.category;

      content.appendChild(category);
    }

    // Title
    const title = document.createElement("h3");
    title.textContent = article.title || "Untitled article";

    // Description
    const description = document.createElement("p");

    description.textContent =
      article.description || "No description available.";

    // Metadata
    const meta = document.createElement("div");
    meta.className = "news-meta";

    const source = document.createElement("span");
    source.textContent = article.source || "Unknown source";

    const date = document.createElement("span");
    date.textContent = formatNewsTime(article.pubDate);

    meta.append(source, date);

    // Read article indicator
    const readMore = document.createElement("span");

    readMore.className = "news-read-more";
    readMore.textContent = "Read article →";

    content.append(title, description, meta, readMore);

    card.appendChild(content);

    cryptoNewsContainer.appendChild(card);
  });
}
loadCryptoNews();
