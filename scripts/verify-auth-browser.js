const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");

require("dotenv").config({ quiet: true });

const { hashPassword } = require("../server/auth/passwords");
const { pool } = require("../server/db/pool");

const appPort = 33000 + Math.floor(Math.random() * 1000);
const driverPort = 34000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${appPort}`;
const externalDriverUrl = process.env.WEBDRIVER_URL;
const driverUrl = externalDriverUrl || `http://127.0.0.1:${driverPort}`;
const unique = randomBytes(10).toString("hex");
const email = `browser-auth-audit-${unique}@example.invalid`;
const password = `Browser-${randomBytes(18).toString("base64url")}!`;
let userId;
let appProcess;
let driverProcess;
let sessionId;

function spawnQuiet(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: path.join(__dirname, ".."), env, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function waitFor(url, processHandle) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle && processHandle.exitCode !== null) throw new Error("A browser-test process exited before becoming ready.");
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("A browser-test process did not become ready.");
}

async function webdriver(method, endpoint, body) {
  const response = await fetch(`${driverUrl}${endpoint}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.value?.error) throw new Error(data.value?.message || `WebDriver HTTP ${response.status}`);
  return data.value;
}

const wd = (method, endpoint, body) => webdriver(method, `/session/${sessionId}${endpoint}`, body);
const execute = (script, args = []) => wd("POST", "/execute/sync", { script, args });
const executeAsync = (script, args = []) => wd("POST", "/execute/async", { script, args });

async function find(selector) {
  const value = await wd("POST", "/element", { using: "css selector", value: selector });
  return value["element-6066-11e4-a52e-4f735466cecf"];
}

async function sendKeys(elementId, text) {
  await wd("POST", `/element/${elementId}/value`, { text });
}

async function click(elementId) {
  await wd("POST", `/element/${elementId}/click`, {});
}

async function navigate(url) {
  await wd("POST", "/url", { url });
}

async function currentUrl() {
  return wd("GET", "/url");
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.once("error", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

async function run() {
  assert.ok(process.env.SESSION_SECRET, "SESSION_SECRET is required for browser verification");
  const inserted = await pool.query(
    "INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
    [email, await hashPassword(password), "Browser Auth Audit"],
  );
  userId = inserted.rows[0].id;

  appProcess = spawnQuiet(process.execPath, ["server.js"], {
    ...process.env,
    PORT: String(appPort),
    ALERT_SCHEDULER_DISABLED: "true",
    TELEGRAM_WORKER_DISABLED: "true",
    BREVO_API_KEY: "",
  });
  await waitFor(`${baseUrl}/api/health`, appProcess);

  if (!externalDriverUrl) driverProcess = spawnQuiet("geckodriver", ["--port", String(driverPort)]);
  await waitFor(`${driverUrl}/status`, driverProcess);
  const created = await webdriver("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "firefox", "moz:firefoxOptions": { args: ["-headless"] } } },
  });
  sessionId = created.sessionId;
  await wd("POST", "/window/rect", { width: 390, height: 844 });

  await navigate(`${baseUrl}/login`);
  await click(await find("[data-cookie-reject]"));
  const emailInput = await find("#loginEmail");
  const passwordInput = await find("#loginPassword");
  assert.equal(await wd("GET", `/element/${passwordInput}/attribute/type`), "password");
  assert.equal(await wd("GET", `/element/${passwordInput}/attribute/autocomplete`), "current-password");

  const typedValue = `typed-${randomBytes(8).toString("hex")}`;
  await sendKeys(passwordInput, typedValue);
  const clipboardEvents = await execute(`
    const input = document.getElementById('loginPassword');
    const result = {};
    for (const type of ['copy', 'cut', 'paste']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      result[type] = event.defaultPrevented;
    }
    result.valueUnchanged = input.value === arguments[0];
    return result;
  `, [typedValue]);
  assert.deepEqual(clipboardEvents, { copy: true, cut: true, paste: false, valueUnchanged: true });

  const toggle = await find('[data-password-toggle="loginPassword"]');
  await click(toggle);
  assert.equal(await wd("GET", `/element/${passwordInput}/attribute/type`), "text");
  await click(toggle);
  assert.equal(await wd("GET", `/element/${passwordInput}/attribute/type`), "password");

  await wd("POST", "/window/rect", { width: 1280, height: 900 });
  await wd("POST", `/element/${passwordInput}/clear`, {});
  await sendKeys(emailInput, email);
  await sendKeys(passwordInput, password);
  await click(await find('button[type="submit"]'));
  await waitUntil(async () => (await currentUrl()).endsWith("/markets"), "Login did not reach Markets.");

  await navigate(`${baseUrl}/signals`);
  await waitUntil(async () => (await currentUrl()).endsWith("/signals"), "Signals did not load.");
  const apiBeforeLogout = await executeAsync(`
    const done = arguments[arguments.length - 1];
    fetch('/api/alerts').then((response) => done(response.status)).catch(() => done(0));
  `);
  assert.equal(apiBeforeLogout, 200);

  await click(await find("[data-auth-desktop] .account-menu-trigger"));
  await click(await find("[data-auth-desktop] .account-menu-logout"));
  await waitUntil(async () => new URL(await currentUrl()).pathname === "/", "Logout did not replace the page with home.");
  const apiAfterLogout = await executeAsync(`
    const done = arguments[arguments.length - 1];
    fetch('/api/alerts').then((response) => done(response.status)).catch(() => done(0));
  `);
  assert.equal(apiAfterLogout, 401);

  await wd("POST", "/back", {});
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.notEqual(new URL(await currentUrl()).pathname, "/signals");
  await wd("POST", "/forward", {});
  await new Promise((resolve) => setTimeout(resolve, 400));
  const apiAfterHistory = await executeAsync(`
    const done = arguments[arguments.length - 1];
    fetch('/api/alerts').then((response) => done(response.status)).catch(() => done(0));
  `);
  assert.equal(apiAfterHistory, 401);

  await navigate(`${baseUrl}/signals`);
  await waitUntil(async () => new URL(await currentUrl()).pathname === "/login", "Manual Signals navigation was not rejected.");

  console.log("PASS Firefox logout redirects Signals to public home");
  console.log("PASS Firefox Back and Forward do not restore authenticated access");
  console.log("PASS Firefox protected API access changes from 200 to 401 after logout");
  console.log("PASS Firefox password masking, visibility toggle, copy/cut blocking, paste, autocomplete, and mobile viewport");
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  if (sessionId) await webdriver("DELETE", `/session/${sessionId}`).catch(() => {});
  await stopProcess(driverProcess);
  await stopProcess(appProcess);
  if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
  await pool.end().catch(() => {});
});
