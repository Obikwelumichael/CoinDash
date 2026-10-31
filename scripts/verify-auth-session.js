const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");

require("dotenv").config({ quiet: true });

const { hashPassword } = require("../server/auth/passwords");
const { pool } = require("../server/db/pool");

const port = 31000 + Math.floor(Math.random() * 2000);
const baseUrl = `http://127.0.0.1:${port}`;
const unique = randomBytes(10).toString("hex");
const email = `auth-audit-${unique}@example.invalid`;
const password = `Audit-${randomBytes(18).toString("base64url")}!`;
let userId;
let serverProcess;

function sessionCookie(response) {
  const header = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie().find((value) => value.startsWith("cryptodash.sid="))
    : response.headers.get("set-cookie");
  assert.ok(header, "authentication response must set the session cookie");
  return header.split(";", 1)[0];
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess.exitCode !== null) throw new Error("The test server exited before becoming ready.");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The test server did not become ready.");
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      serverProcess.kill("SIGKILL");
      resolve();
    }, 5000);
    serverProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    serverProcess.kill("SIGTERM");
  });
}

async function run() {
  assert.ok(process.env.SESSION_SECRET, "SESSION_SECRET is required for integration verification");
  const inserted = await pool.query(
    "INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
    [email, await hashPassword(password), "Auth Audit"],
  );
  userId = inserted.rows[0].id;

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: require("node:path").join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      ALERT_SCHEDULER_DISABLED: "true",
      TELEGRAM_WORKER_DISABLED: "true",
      BREVO_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.resume();
  serverProcess.stderr.resume();
  await waitForServer();

  const anonymousPage = await fetch(`${baseUrl}/signals`, { redirect: "manual" });
  assert.equal(anonymousPage.status, 303);
  assert.equal(anonymousPage.headers.get("location"), "/login");

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const cookie = sessionCookie(login);

  const signalsPage = await fetch(`${baseUrl}/signals`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(signalsPage.status, 200);
  assert.match(signalsPage.headers.get("cache-control") || "", /no-store/);

  const signalsApi = await fetch(`${baseUrl}/api/alerts`, { headers: { Cookie: cookie } });
  assert.equal(signalsApi.status, 200);
  assert.match(signalsApi.headers.get("cache-control") || "", /no-store/);

  const activeSessions = await pool.query("SELECT count(*)::int AS count FROM session WHERE sess->>'userId' = $1", [userId]);
  assert.equal(activeSessions.rows[0].count, 1);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie, Accept: "application/json" },
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("cache-control") || "", /no-store/);
  assert.match(logout.headers.get("set-cookie") || "", /cryptodash\.sid=;/);

  const remainingSessions = await pool.query("SELECT count(*)::int AS count FROM session WHERE sess->>'userId' = $1", [userId]);
  assert.equal(remainingSessions.rows[0].count, 0);

  const rejectedApi = await fetch(`${baseUrl}/api/alerts`, { headers: { Cookie: cookie } });
  assert.equal(rejectedApi.status, 401);
  assert.match(rejectedApi.headers.get("cache-control") || "", /no-store/);

  for (const path of ["/signals", "/watchlist", "/settings", "/pages/signals.html"]) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal(response.status, 303, `${path} must reject the logged-out cookie`);
    assert.equal(response.headers.get("location"), "/login");
    assert.match(response.headers.get("cache-control") || "", /no-store/);
  }

  console.log("PASS real login and protected Signals access");
  console.log("PASS logout destroys the PostgreSQL session before completion");
  console.log("PASS logged-out cookie is rejected by protected API and HTML routes");
  console.log("PASS protected responses use Cache-Control: no-store");
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await stopServer();
  if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
  await pool.end().catch(() => {});
});
