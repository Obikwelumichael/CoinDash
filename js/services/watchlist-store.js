import { handleUnauthorized, subscribeAuth } from "./auth-store.js";

const API_URL = "/api/watchlist";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const listeners = new Set();
const pendingRequests = new Map();
let coinIds = new Set();
let isLoading = true;
let isLoaded = false;
let loadError = "";
let loadPromise;
let authRequired = false;

function isValidCoinId(id) {
  return typeof id === "string" && id.length <= 100 && ID_PATTERN.test(id);
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isValidCoinId))];
}

function notify() {
  const ids = [...coinIds];
  const state = {
    loading: isLoading,
    loaded: isLoaded,
    error: loadError,
    authRequired,
    pendingIds: new Set(pendingRequests.keys()),
  };
  listeners.forEach((listener) => {
    try {
      listener(ids, state);
    } catch (error) {
      console.error("Watchlist listener failed:", error);
    }
  });
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let data = {};
  try {
    data = await response.json();
  } catch {
    // The status code below still provides a useful error for non-JSON replies.
  }
  if (!response.ok) {
    if (response.status === 401) await handleUnauthorized();
    throw new Error(response.status === 401
      ? "Sign in to view your watchlist."
      : data.error || `Watchlist request failed (${response.status}).`);
  }
  return data;
}

export function loadWatchlist() {
  if (isLoaded && !loadError) {
    return Promise.resolve({ ok: true, ids: [...coinIds] });
  }
  if (loadPromise) return loadPromise;

  isLoading = true;
  loadError = "";
  notify();

  loadPromise = (async () => {
    try {
      const response = await requestJson(API_URL);
      if (!Array.isArray(response.watchlist)) {
        throw new Error("The watchlist response was invalid.");
      }

      const serverIds = new Set(normalizeIds(response.watchlist));
      coinIds = serverIds;
      isLoaded = true;
      isLoading = false;
      loadError = "";
      notify();
      return { ok: true, ids: [...coinIds] };
    } catch (error) {
      isLoaded = false;
      isLoading = false;
      loadError = error.message || "Unable to load the watchlist.";
      notify();
      return { ok: false, ids: [...coinIds], error: loadError };
    } finally {
      loadPromise = undefined;
    }
  })();

  return loadPromise;
}

export function getWatchlist() {
  return [...coinIds];
}

export function isInWatchlist(coinId) {
  return isValidCoinId(coinId) && coinIds.has(coinId);
}

export function isWatchlistLoaded() {
  return isLoaded;
}

export function isWatchlistPending(coinId) {
  return pendingRequests.has(coinId);
}

export function subscribeWatchlist(listener) {
  listeners.add(listener);
  listener([...coinIds], {
    loading: isLoading,
    loaded: isLoaded,
    error: loadError,
    authRequired,
    pendingIds: new Set(pendingRequests.keys()),
  });
  return () => listeners.delete(listener);
}

function setWatchlisted(coinId, shouldWatch) {
  if (!isValidCoinId(coinId)) {
    return Promise.resolve({ ok: false, ids: [...coinIds], error: "Invalid coin ID." });
  }
  if (authRequired) {
    return Promise.resolve({
      ok: false,
      ids: [...coinIds],
      signInRequired: true,
      error: "Sign in to save coins to your watchlist.",
    });
  }
  if (!isLoaded) {
    return Promise.resolve({ ok: false, ids: [...coinIds], error: "The watchlist is not ready yet." });
  }
  if (pendingRequests.has(coinId)) return pendingRequests.get(coinId);

  const wasWatched = coinIds.has(coinId);
  if (wasWatched === shouldWatch) return Promise.resolve({ ok: true, ids: [...coinIds] });

  if (shouldWatch) coinIds.add(coinId);
  else coinIds.delete(coinId);
  pendingRequests.set(coinId, null);
  loadError = "";
  notify();

  const url = shouldWatch
    ? API_URL
    : `${API_URL}/${encodeURIComponent(coinId)}`;
  const options = shouldWatch
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coinId }),
      }
    : { method: "DELETE" };

  const request = Promise.resolve()
    .then(() => requestJson(url, options))
    .then(() => {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        watchlistChannel?.postMessage({ coinId, watched: shouldWatch });
      }
      return { ok: true, ids: [...coinIds] };
    })
    .catch((error) => {
      if (wasWatched) coinIds.add(coinId);
      else coinIds.delete(coinId);
      loadError = error.message || "Unable to save this watchlist change.";
      return { ok: false, ids: [...coinIds], error: loadError };
    })
    .finally(() => {
      pendingRequests.delete(coinId);
      notify();
    });

  pendingRequests.set(coinId, request);
  return request;
}

export function addToWatchlist(coinId) {
  return setWatchlisted(coinId, true);
}

export function removeFromWatchlist(coinId) {
  return setWatchlisted(coinId, false);
}

export function toggleWatchlistCoin(coinId) {
  if (pendingRequests.has(coinId)) return pendingRequests.get(coinId);
  return setWatchlisted(coinId, !isInWatchlist(coinId));
}

const watchlistChannel = typeof window !== "undefined" && "BroadcastChannel" in window
  ? new BroadcastChannel("cryptodash-watchlist")
  : null;

subscribeAuth(({ authenticated, initialized, error }) => {
  if (!initialized) return;
  if (authenticated) {
    if (authRequired) {
      authRequired = false;
      loadError = "";
      loadWatchlist();
    }
    return;
  }
  if (error) {
    authRequired = false;
    loadError = "Account status could not be checked. Retry when your connection is available.";
    notify();
    return;
  }
  authRequired = true;
  coinIds = new Set();
  isLoaded = false;
  isLoading = false;
  loadError = "Sign in to view your watchlist.";
  notify();
});

watchlistChannel?.addEventListener("message", (event) => {
  const { coinId, watched } = event.data || {};
  if (!isValidCoinId(coinId) || typeof watched !== "boolean") return;
  if (watched) coinIds.add(coinId);
  else coinIds.delete(coinId);
  notify();
});

loadWatchlist();
