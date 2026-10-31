const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const { createAuthMiddleware } = require("../server/middleware/require-auth");
const { logout } = require("../server/auth/routes");
const { isSessionIdRevoked } = require("../server/session-revocation");

function responseDouble() {
  return {
    headers: new Map(),
    clearedCookies: [],
    set(name, value) { this.headers.set(name.toLowerCase(), value); return this; },
    vary(value) { this.headers.set("vary", value); return this; },
    clearCookie(name, options) { this.clearedCookies.push({ name, options }); return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, location) { this.statusCode = code; this.location = location; return this; },
    end() { this.ended = true; return this; },
  };
}

test("API and page authentication reject missing sessions without caching responses", async () => {
  let userLookupCount = 0;
  const middleware = createAuthMiddleware({ findUserById: async () => { userLookupCount += 1; } });

  const apiResponse = responseDouble();
  await middleware.requireAuth({}, apiResponse, assert.fail);
  assert.equal(apiResponse.statusCode, 401);
  assert.equal(apiResponse.headers.get("cache-control"), "no-store, private");
  assert.equal(apiResponse.headers.get("pragma"), "no-cache");
  assert.equal(apiResponse.headers.get("vary"), "Cookie");
  assert.equal(apiResponse.clearedCookies[0].name, "cryptodash.sid");

  const pageResponse = responseDouble();
  await middleware.requirePageAuth({}, pageResponse, assert.fail);
  assert.equal(pageResponse.statusCode, 303);
  assert.equal(pageResponse.location, "/login");
  assert.equal(pageResponse.headers.get("cache-control"), "no-store, private");
  assert.equal(userLookupCount, 0);
});

test("authentication middleware reloads valid users and destroys stale sessions before rejection", async () => {
  const validUser = { id: "user-1", email: "safe@example.com", display_name: "Safe User" };
  const valid = createAuthMiddleware({ findUserById: async () => validUser });
  const validRequest = { session: { userId: validUser.id } };
  const validResponse = responseDouble();
  let continued = false;
  await valid.requireAuth(validRequest, validResponse, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(validRequest.user, validUser);

  let releaseDestroy;
  const stale = createAuthMiddleware({ findUserById: async () => null });
  const staleRequest = {
    session: {
      userId: "deleted-user",
      destroy(callback) { releaseDestroy = callback; },
    },
  };
  const staleResponse = responseDouble();
  const pending = stale.requireAuth(staleRequest, staleResponse, assert.fail);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(staleResponse.statusCode, undefined, "must wait for server-side destruction");
  releaseDestroy();
  await pending;
  assert.equal(staleResponse.statusCode, 401);
});

test("logout waits for session-store destruction before clearing the cookie and completing", async () => {
  let finishDestroy;
  const sessionID = `logout-test-${Date.now()}`;
  const request = { sessionID, session: { cookie: {}, destroy(callback) { finishDestroy = callback; } } };
  const response = responseDouble();
  logout(request, response, assert.fail);
  assert.equal(response.ended, undefined);
  assert.equal(isSessionIdRevoked(sessionID), true);
  finishDestroy();
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.equal(response.clearedCookies[0].name, "cryptodash.sid");
  assert.equal(response.headers.get("cache-control"), "no-store, private");
});

test("revoked session IDs are rejected even if an overlapping request still has user data", async () => {
  const sessionID = `overlap-test-${Date.now()}`;
  const logoutRequest = { sessionID, session: { cookie: {}, destroy(callback) { callback(); } } };
  logout(logoutRequest, responseDouble(), assert.fail);

  let lookupCalled = false;
  const middleware = createAuthMiddleware({ findUserById: async () => { lookupCalled = true; return { id: "user-1" }; } });
  const request = { sessionID, session: { userId: "user-1", destroy(callback) { callback(); } } };
  const response = responseDouble();
  await middleware.requireAuth(request, response, assert.fail);
  assert.equal(response.statusCode, 401);
  assert.equal(lookupCalled, false);
});

test("all account-data APIs and protected HTML entry points retain server-side guards", () => {
  const server = read("server.js");
  const guardedRouters = [
    "server/account/routes.js",
    "server/alerts/routes.js",
    "server/notifications/routes.js",
    "server/preferences/routes.js",
  ];
  for (const file of guardedRouters) assert.match(read(file), /router\.use\(requireAuth\)/, file);
  assert.match(read("server/telegram/routes.js"), /accountRouter\.use\(requireAuth\)/);
  for (const route of ["watchlist", "signals", "settings"]) {
    assert.match(server, new RegExp(`\\[\"${route}\", \"${route}\\.html\"\\]`));
  }
  assert.match(server, /app\.get\(`\/\$\{route\}`.*, requirePageAuth/);
  assert.match(server, /app\.get\(`\/pages\/\$\{fileName\}`.*, requirePageAuth/);
  assert.match(read("server/middleware/require-auth.js"), /Cache-Control", "no-store, private"/);
});

test("protected-page history guard revalidates bfcache restores and logout replaces history", () => {
  const guard = read("js/services/protected-page.js");
  const authStore = read("js/services/auth-store.js");
  assert.match(guard, /window\.addEventListener\("pageshow"/);
  assert.match(guard, /if \(event\.persisted\) void verifyProtectedPageSession\(\)/);
  assert.match(guard, /window\.location\.replace\("\/login"\)/);
  assert.match(authStore, /await request\("\/api\/auth\/logout", \{ method: "POST" \}\)[\s\S]*?window\.location\.replace\("\/"\)/);
});

test("password copy protection is field-scoped and leaves paste and input behavior alone", async () => {
  const source = read("js/ui/password-fields.js");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const { protectPasswordFieldCopy } = await import(moduleUrl);
  const listeners = new Map();
  const input = {
    dataset: {},
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  protectPasswordFieldCopy({ querySelectorAll: (selector) => {
    assert.equal(selector, 'input[type="password"]');
    return [input];
  } });
  assert.deepEqual([...listeners.keys()].sort(), ["copy", "cut"]);
  for (const type of ["copy", "cut"]) {
    let prevented = false;
    listeners.get(type)({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  assert.equal(listeners.has("paste"), false);
  assert.equal(listeners.has("input"), false);

  const passwordPages = ["pages/login.html", "pages/signup.html", "pages/reset-password.html", "pages/settings.html"]
    .map(read).join("\n");
  assert.doesNotMatch(passwordPages, /type="password"(?![^>]*autocomplete=)/);
  for (const script of ["js/pages/auth.js", "js/pages/account-actions.js", "js/pages/settings.js"]) {
    assert.match(read(script), /protectPasswordFieldCopy\(\)/, script);
  }
});
