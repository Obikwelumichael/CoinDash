import { readConsent, writeConsent } from "../services/privacy-consent.js";

const storage = (() => {
  try { return window.localStorage; } catch { return null; }
})();
let savedConsent = readConsent(storage);
let preferencesOpen = false;
let lastSettingsTrigger = null;

const banner = document.createElement("aside");
banner.className = "cookie-consent";
banner.id = "cookie-settings";
banner.hidden = Boolean(savedConsent);
banner.setAttribute("aria-labelledby", "cookieConsentTitle");
banner.innerHTML = `
  <div class="cookie-consent-card">
    <div class="cookie-consent-header">
      <h2 id="cookieConsentTitle" tabindex="-1">Privacy &amp; storage choices</h2>
      <button class="cookie-close" type="button" aria-label="Close privacy choices" data-cookie-close>×</button>
    </div>
    <div data-cookie-intro>
      <p>CoinDash uses a necessary session cookie for sign-in and security. Your choice is saved in this browser’s localStorage (not a cookie). We do not currently use optional analytics, advertising, or marketing trackers.</p>
      <p class="cookie-consent-links"><a href="/privacy">Privacy Policy</a><span aria-hidden="true">·</span><a href="/privacy#cookies">Cookie information</a></p>
      <div class="cookie-consent-actions" aria-label="Privacy choices">
        <button class="cookie-choice" type="button" data-cookie-accept>Accept all</button>
        <button class="cookie-choice" type="button" data-cookie-reject>Reject optional</button>
        <button class="cookie-choice cookie-choice-customize" type="button" data-cookie-customize aria-expanded="false" aria-controls="cookiePreferences">Customize</button>
      </div>
    </div>
    <section class="cookie-preferences" id="cookiePreferences" aria-labelledby="cookiePreferencesTitle" hidden>
      <h3 id="cookiePreferencesTitle" tabindex="-1">Customize privacy preferences</h3>
      <div class="cookie-category">
        <label><input type="checkbox" checked disabled /> Strictly necessary <span>Always active</span></label>
        <p>The server-side session cookie supports account sign-in and security. It is HTTP-only and is not controlled by optional preferences.</p>
      </div>
      <p class="cookie-no-optional">No optional browser-storage, analytics, advertising, or marketing tools are currently active, so there are no optional categories to enable or disable.</p>
      <div class="cookie-consent-actions">
        <button class="cookie-choice" type="button" data-cookie-save>Save preferences</button>
        <button class="cookie-choice cookie-choice-customize" type="button" data-cookie-cancel>Cancel</button>
      </div>
    </section>
    <p class="cookie-consent-status" data-cookie-status role="status" aria-live="polite"></p>
  </div>`;
document.body.append(banner);

const intro = banner.querySelector("[data-cookie-intro]");
const preferences = banner.querySelector("#cookiePreferences");
const customizeButton = banner.querySelector("[data-cookie-customize]");
const status = banner.querySelector("[data-cookie-status]");
const title = banner.querySelector("#cookieConsentTitle");
const preferenceTitle = banner.querySelector("#cookiePreferencesTitle");

function getStorage() {
  try { return window.localStorage; } catch { return null; }
}

function showPreferences(open) {
  preferencesOpen = open;
  intro.hidden = open;
  preferences.hidden = !open;
  customizeButton.setAttribute("aria-expanded", String(open));
  if (open) preferenceTitle.focus();
  else title.focus();
}

function dismissBanner() {
  banner.hidden = true;
  preferencesOpen = false;
  intro.hidden = false;
  preferences.hidden = true;
  const focusTarget = lastSettingsTrigger?.isConnected
    ? lastSettingsTrigger
    : document.querySelector("[data-open-cookie-settings]");
  focusTarget?.focus();
}

function saveDecision(decision) {
  try {
    savedConsent = writeConsent(decision, getStorage());
    status.textContent = "";
    dismissBanner();
  } catch {
    status.textContent = "Your browser prevented saving this choice. Privacy settings will be shown again on your next visit.";
  }
}

banner.querySelector("[data-cookie-accept]").addEventListener("click", () => saveDecision("accepted_all"));
banner.querySelector("[data-cookie-reject]").addEventListener("click", () => saveDecision("rejected_optional"));
banner.querySelector("[data-cookie-save]").addEventListener("click", () => saveDecision("custom"));
customizeButton.addEventListener("click", () => showPreferences(true));
banner.querySelector("[data-cookie-cancel]").addEventListener("click", () => {
  showPreferences(false);
  if (savedConsent) dismissBanner();
});
banner.querySelector("[data-cookie-close]").addEventListener("click", dismissBanner);

document.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element
    ? event.target.closest("[data-open-cookie-settings]")
    : null;
  if (!trigger) return;
  event.preventDefault();
  lastSettingsTrigger = trigger;
  status.textContent = "";
  banner.hidden = false;
  intro.hidden = true;
  preferences.hidden = false;
  preferencesOpen = true;
  customizeButton.setAttribute("aria-expanded", "true");
  preferenceTitle.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !banner.hidden) {
    if (preferencesOpen && !savedConsent) showPreferences(false);
    else dismissBanner();
  }
});

