import {
  isInWatchlist,
  isWatchlistLoaded,
  isWatchlistPending,
  loadWatchlist,
  subscribeWatchlist,
  toggleWatchlistCoin,
} from "../services/watchlist-store.js";

function showStatus(message, allowRetry = false, signInPrompt = false) {
  let status = document.getElementById("watchlistActionStatus");
  if (!status) {
    status = document.createElement("div");
    status.id = "watchlistActionStatus";
    status.className = "watchlist-action-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    document.body.append(status);
  }
  status.replaceChildren(document.createTextNode(message));
  if (signInPrompt) {
    const signIn = document.createElement("a");
    signIn.href = "/login";
    signIn.textContent = "Sign in";
    const signUp = document.createElement("a");
    signUp.href = "/signup";
    signUp.textContent = "Create an account";
    status.append(" ", signIn, " · ", signUp);
  }
  if (allowRetry) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "watchlist-status-retry";
    retry.textContent = "Retry";
    retry.addEventListener("click", loadWatchlist);
    status.append(" ", retry);
  }
  status.hidden = !message;
}

function updateFavoriteButtons(ids, state) {
  const watched = new Set(ids);
  document.querySelectorAll(".watchlist-favorite[data-coin-id]").forEach((button) => {
    const coinId = button.dataset.coinId;
    const active = watched.has(coinId);
    const pending = state.pendingIds.has(coinId);
    button.classList.toggle("is-favorite", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "Remove from watchlist" : "Add to watchlist");
    button.setAttribute("aria-busy", String(pending || state.loading));
    button.disabled = pending || (!state.loaded && !state.authRequired);
    button.title = state.authRequired
      ? "Sign in to save coins to your watchlist"
      : state.loaded
      ? active ? "Remove from watchlist" : "Add to watchlist"
      : "Watchlist is loading or unavailable";
    button.textContent = button.classList.contains("chart-watchlist-button")
      ? active ? "★ In watchlist" : "☆ Add to watchlist"
      : button.classList.contains("watchlist-remove-button")
        ? active ? "Remove" : "Add"
        : active ? "★" : "☆";
  });

  if (state.authRequired) {
    showStatus("");
  } else if (state.error) {
    showStatus(state.error, !state.loaded && !state.authRequired, state.authRequired);
  }
  else if (state.loaded) showStatus("");
}

export function createFavoriteButton(coin, { labeled = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "watchlist-favorite";
  if (labeled) button.classList.add("chart-watchlist-button");
  button.dataset.coinId = coin.id;
  button.textContent = labeled
    ? isInWatchlist(coin.id) ? "★ In watchlist" : "☆ Add to watchlist"
    : isInWatchlist(coin.id) ? "★" : "☆";
  button.setAttribute("aria-pressed", String(isInWatchlist(coin.id)));
  button.setAttribute("aria-label", isInWatchlist(coin.id) ? "Remove from watchlist" : "Add to watchlist");
  const authRequired = document.documentElement.dataset.watchlistAuthRequired === "true";
  button.disabled = isWatchlistPending(coin.id) || (!isWatchlistLoaded() && !authRequired);
  button.title = authRequired
    ? "Sign in to save coins to your watchlist"
    : button.disabled ? "Watchlist is loading or unavailable" : "Toggle watchlist";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isWatchlistPending(coin.id)) return;
    const wasFavorite = isInWatchlist(coin.id);
    const result = await toggleWatchlistCoin(coin.id);
    if (!result.ok) {
      showStatus(
        result.signInRequired
          ? result.error
          : `${result.error || "Could not save your watchlist change."} Try the favorite button again.`,
        false,
        result.signInRequired,
      );
      return;
    }
    showStatus(wasFavorite ? `${coin.name} removed from watchlist.` : `${coin.name} added to watchlist.`);
  });
  button.addEventListener("keydown", (event) => event.stopPropagation());
  return button;
}

subscribeWatchlist((ids, state) => {
  document.documentElement.dataset.watchlistReady = String(state.loaded);
  document.documentElement.dataset.watchlistAuthRequired = String(state.authRequired);
  updateFavoriteButtons(ids, state);
});
