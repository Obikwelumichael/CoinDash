import { applyThemePreference, normalizeTheme } from "../ui/theme.js";
import "../services/protected-page.js";
import { protectPasswordFieldCopy } from "../ui/password-fields.js";

protectPasswordFieldCopy();

const pageStatus = document.querySelector("[data-page-status]");
const overview = document.querySelector(".settings-overview");
let accountState;
let savedTheme = "dark";

function feedback(name, message, type = "") {
  const node = document.querySelector(`[data-feedback="${name}"]`);
  if (!node) return;
  node.textContent = message;
  node.className = `auth-feedback${type ? ` is-${type}` : ""}`;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch {
    throw new Error("Unable to reach CoinDash. Check your connection and try again.");
  }
  let data = {};
  if (response.status !== 204) {
    try { data = await response.json(); } catch {}
  }
  if (!response.ok) {
    const error = new Error(data.error || "This request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function json(method, values) { return { method, body: JSON.stringify(values) }; }

function setBusy(control, busy, pendingLabel) {
  const button = control.matches?.('button[type="button"]') ? control : control.querySelector('button[type="submit"]');
  control.setAttribute("aria-busy", String(busy));
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.textContent = pendingLabel;
  } else if (button.dataset.idleLabel) {
    button.textContent = button.dataset.idleLabel;
    delete button.dataset.idleLabel;
  }
  button.disabled = busy;
}

function initials(name) {
  const value = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return value || "CT";
}

function renderAccount(account) {
  document.getElementById("settingsDisplayName").value = account.displayName;
  document.getElementById("settingsEmail").value = account.email;
  document.querySelector("[data-account-name]").textContent = account.displayName;
  document.querySelector("[data-account-avatar]").textContent = initials(account.displayName);
  document.querySelector("[data-email]").textContent = account.email;
  const verified = account.emailVerified;
  const status = document.querySelector("[data-verification-status]");
  status.textContent = verified ? "✓ Email verified" : "! Email not verified";
  status.classList.toggle("is-positive", verified);
  status.classList.toggle("is-warning", !verified);
  document.querySelector("[data-email-verification-copy]").textContent = verified
    ? "Your sign-in email has been verified."
    : "Verify your email to confirm that security messages can reach you.";
  document.querySelector("[data-verify-email]").hidden = verified;
}

async function loadSecurity() {
  const status = document.querySelector("[data-two-factor-status]");
  const badge = document.querySelector("[data-two-factor-badge]");
  const begin = document.querySelector('[data-settings-form="two-factor-begin"]');
  const disableForm = document.querySelector('[data-settings-form="two-factor-disable"]');
  const data = await api("/api/account/2fa/status");
  accountState.security = data;
  status.textContent = data.enabled
    ? `Enabled · ${data.remainingRecoveryCodes} recovery codes remaining.`
    : "Not enabled. Add an authenticator to protect sign-in and sensitive account changes.";
  badge.textContent = data.enabled ? "✓ 2FA enabled" : "2FA not enabled";
  badge.classList.toggle("is-positive", data.enabled);
  badge.classList.toggle("is-muted", !data.enabled);
  begin.hidden = data.enabled;
  disableForm.hidden = !data.enabled;
}

async function loadSettings() {
  try {
    const [settings, preferences] = await Promise.all([api("/api/account/settings"), api("/api/preferences")]);
    accountState = settings;
    renderAccount(settings.account);
    savedTheme = applyThemePreference(preferences.preferences.theme);
    document.getElementById("settingsTheme").value = savedTheme;
    document.querySelector('[name="emailAlerts"]').checked = preferences.preferences.emailAlerts;
    await loadSecurity();
    pageStatus.textContent = "Manage your profile, security, and notification preferences.";
    overview.setAttribute("aria-busy", "false");
  } catch (error) {
    pageStatus.textContent = error.status === 401 ? "Sign in to manage account settings." : error.message;
    overview.setAttribute("aria-busy", "false");
    if (error.status === 401) window.location.assign("/login");
  }
}

document.querySelector('[data-settings-form="profile"]').addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const displayName = form.elements.displayName.value.trim();
  feedback("profile", "");
  setBusy(form, true, "Saving…");
  try {
    const result = await api("/api/account/profile", json("PATCH", { displayName }));
    accountState.account.displayName = result.account.displayName;
    renderAccount(accountState.account);
    feedback("profile", "Profile saved.", "success");
  } catch (error) { feedback("profile", error.message, "error"); }
  finally { setBusy(form, false); }
});

document.querySelector('[data-settings-form="preferences"]').addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  feedback("preferences", "");
  setBusy(form, true, "Saving…");
  try {
    const result = await api("/api/preferences", json("PUT", { theme: form.elements.theme.value, emailAlerts: form.elements.emailAlerts.checked }));
    savedTheme = applyThemePreference(result.preferences.theme);
    form.elements.theme.value = savedTheme;
    feedback("preferences", "Preferences saved.", "success");
  } catch (error) {
    form.elements.theme.value = savedTheme;
    applyThemePreference(savedTheme);
    feedback("preferences", error.message, "error");
  }
  finally { setBusy(form, false); }
});

document.getElementById("settingsTheme").addEventListener("change", async (event) => {
  const select = event.currentTarget;
  const theme = normalizeTheme(select.value);
  applyThemePreference(theme);
  select.disabled = true;
  select.setAttribute("aria-busy", "true");
  feedback("preferences", "Saving theme…");
  try {
    const result = await api("/api/preferences", {
      ...json("PUT", { theme }),
      keepalive: true,
    });
    savedTheme = applyThemePreference(result.preferences.theme);
    select.value = savedTheme;
    feedback("preferences", "Theme saved and applied across CoinDash.", "success");
  } catch (error) {
    select.value = savedTheme;
    applyThemePreference(savedTheme);
    feedback("preferences", error.message, "error");
  } finally {
    select.disabled = false;
    select.setAttribute("aria-busy", "false");
  }
});

document.querySelector("[data-verify-email]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  feedback("verification", "");
  setBusy(button, true, "Sending…");
  try {
    const result = await api("/api/auth/verification/request", json("POST", {}));
    feedback("verification", result.message || "Check your inbox for a verification link.", "success");
  } catch (error) { feedback("verification", error.message, "error"); }
  finally { setBusy(button, false); }
});

document.querySelector('[data-settings-form="two-factor-begin"]').addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  feedback("two-factor", "");
  setBusy(form, true, "Preparing…");
  try {
    const setup = await api("/api/account/2fa/setup", json("POST", { currentPassword: form.elements.currentPassword.value }));
    document.querySelector("[data-two-factor-qr]").src = setup.qrCode;
    document.querySelector("[data-two-factor-setup]").hidden = false;
    form.hidden = true;
    form.reset();
    feedback("two-factor", "Scan the code and enter a current authenticator code.");
  } catch (error) { feedback("two-factor", error.message, "error"); }
  finally { setBusy(form, false); }
});

document.querySelector('[data-settings-form="two-factor-confirm"]').addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  feedback("two-factor", "");
  setBusy(form, true, "Enabling…");
  try {
    const result = await api("/api/account/2fa/confirm", json("POST", { code: form.elements.code.value.trim() }));
    const list = document.querySelector("[data-recovery-list]");
    list.replaceChildren(...result.recoveryCodes.map((code) => { const item = document.createElement("li"); item.textContent = code; return item; }));
    document.querySelector("[data-recovery-codes]").hidden = false;
    document.querySelector("[data-two-factor-setup]").hidden = true;
    feedback("two-factor", "Two-factor authentication enabled. Store the recovery codes now.", "success");
    await loadSecurity();
  } catch (error) { feedback("two-factor", error.message, "error"); }
  finally { setBusy(form, false); }
});

document.querySelector('[data-settings-form="two-factor-disable"]').addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  feedback("two-factor-disable", "");
  setBusy(form, true, "Disabling…");
  try {
    await api("/api/account/2fa/disable", json("POST", values));
    form.reset();
    feedback("two-factor-disable", "Two-factor authentication disabled.", "success");
    await loadSecurity();
  } catch (error) { feedback("two-factor-disable", error.message, "error"); }
  finally { setBusy(form, false); }
});

document.querySelector('[data-settings-form="password"]').addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  if (values.newPassword.length < 12 || values.newPassword.length > 128) return feedback("password", "New password must be 12–128 characters.", "error");
  feedback("password", "");
  setBusy(form, true, "Changing…");
  let redirecting = false;
  try {
    await api("/api/account/password", json("PUT", values));
    redirecting = true;
    feedback("password", "Password changed. Returning to sign in…", "success");
    window.setTimeout(() => window.location.assign("/login"), 1000);
  } catch (error) { feedback("password", error.message, "error"); }
  finally { if (!redirecting) setBusy(form, false); }
});

document.querySelector('[data-settings-form="delete"]').addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!window.confirm("Permanently delete this account and all associated CoinDash data? This cannot be undone.")) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  feedback("delete", "");
  setBusy(form, true, "Deleting…");
  let redirecting = false;
  try {
    await api("/api/account/settings", json("DELETE", values));
    redirecting = true;
    pageStatus.textContent = "Account deleted. Redirecting…";
    window.setTimeout(() => window.location.assign("/signup"), 700);
  } catch (error) { feedback("delete", error.message, "error"); }
  finally { if (!redirecting) setBusy(form, false); }
});

const sectionLinks = [...document.querySelectorAll(".settings-nav a")];
const navigationSections = sectionLinks.map((link) => ({
  link,
  section: document.querySelector(link.hash)?.closest("section"),
})).filter((item) => item.section);
let sectionScrollFrame;

function setActiveSection(activeLink) {
  sectionLinks.forEach((link) => link.toggleAttribute("aria-current", link === activeLink));
}

function updateActiveSection() {
  sectionScrollFrame = undefined;
  const activationLine = Math.min(window.innerHeight * 0.32, 260);
  let active = navigationSections[0];
  for (const item of navigationSections) {
    if (item.section.getBoundingClientRect().top <= activationLine) active = item;
    else break;
  }
  if (active) setActiveSection(active.link);
}

sectionLinks.forEach((link) => link.addEventListener("click", () => setActiveSection(link)));
window.addEventListener("scroll", () => {
  if (sectionScrollFrame !== undefined) return;
  sectionScrollFrame = window.requestAnimationFrame(updateActiveSection);
}, { passive: true });
window.addEventListener("resize", updateActiveSection);
updateActiveSection();

loadSettings();
