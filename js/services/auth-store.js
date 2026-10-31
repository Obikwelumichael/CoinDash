const listeners = new Set();
let currentUser = null;
let initialized = false;
let authError = "";
let currentUserRequest;

function notify() {
  const state = {
    user: currentUser,
    authenticated: Boolean(currentUser),
    initialized,
    error: authError,
  };
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error("Authentication listener failed:", error);
    }
  });
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    const error = new Error("Unable to reach CoinDash. Check your connection and try again.");
    error.network = true;
    throw error;
  }

  let data = {};
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      if (response.ok) throw new Error("CoinDash returned an unexpected response. Please try again.");
    }
  }
  if (!response.ok) {
    const error = new Error(typeof data.error === "string" ? data.error : "Authentication request failed. Please try again.");
    error.fields = data.fields && typeof data.fields === "object" ? data.fields : undefined;
    error.status = response.status;
    throw error;
  }
  return data;
}

function isSafeUser(user) {
  return user && typeof user.id === "string" && typeof user.email === "string"
    && typeof user.display_name === "string";
}

export async function getCurrentUser() {
  if (currentUserRequest) return currentUserRequest;
  currentUserRequest = (async () => {
    try {
      const data = await request("/api/auth/me", { headers: {} });
      if (data.authenticated !== true || !isSafeUser(data.user)) {
        throw new Error("CoinDash returned an unexpected account response.");
      }
      currentUser = data.user;
      authError = "";
    } catch (error) {
      if (error.status === 401) {
        currentUser = null;
        authError = "";
      } else {
        authError = error.message;
        if (!initialized) currentUser = null;
      }
    } finally {
      initialized = true;
      notify();
      currentUserRequest = undefined;
    }
    return currentUser;
  })();
  return currentUserRequest;
}

async function authenticate(path, values) {
  const data = await request(path, { method: "POST", body: JSON.stringify(values) });
  if (!isSafeUser(data.user)) throw new Error("CoinDash returned an unexpected account response. Please try again.");
  currentUser = data.user;
  authError = "";
  initialized = true;
  notify();
  return currentUser;
}

export function registerUser(values) {
  return authenticate("/api/auth/register", values);
}

export function loginUser(values) {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify(values) }).then((data) => {
    if (data.twoFactorRequired === true && typeof data.challenge === "string") return { twoFactorRequired: true, challenge: data.challenge };
    if (!isSafeUser(data.user)) throw new Error("CoinDash returned an unexpected account response. Please try again.");
    currentUser = data.user;
    authError = "";
    initialized = true;
    notify();
    return currentUser;
  });
}

export async function completeTwoFactorLogin(challenge, code) {
  const data = await request("/api/auth/login/verify", { method: "POST", body: JSON.stringify({ challenge, code }) });
  if (!isSafeUser(data.user)) throw new Error("CoinDash returned an unexpected account response. Please try again.");
  currentUser = data.user;
  authError = "";
  initialized = true;
  notify();
  return currentUser;
}

export async function logoutUser() {
  await request("/api/auth/logout", { method: "POST" });
  currentUser = null;
  authError = "";
  initialized = true;
  notify();
  window.location.replace("/");
}

export async function requestEmailVerification() {
  return request("/api/auth/verification/request", { method: "POST", body: "{}" });
}

export async function handleUnauthorized() {
  await getCurrentUser();
  return !currentUser;
}

export function isAuthenticated() {
  return Boolean(currentUser);
}

export function subscribeAuth(listener) {
  listeners.add(listener);
  listener({ user: currentUser, authenticated: Boolean(currentUser), initialized, error: authError });
  return () => listeners.delete(listener);
}
