const THEME_STORAGE_KEY = "cointrack.theme.v1";
const deviceTheme = window.matchMedia("(prefers-color-scheme: light)");
let selectedTheme = "dark";

export function normalizeTheme(theme) {
  return ["system", "dark", "light"].includes(theme) ? theme : "dark";
}

export function resolveTheme(theme) {
  const preference = normalizeTheme(theme);
  return preference === "system" ? (deviceTheme.matches ? "light" : "dark") : preference;
}

export function applyThemePreference(theme, { persist = true } = {}) {
  selectedTheme = normalizeTheme(theme);
  const resolved = resolveTheme(selectedTheme);
  const previousResolved = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = selectedTheme;
  if (document.body) {
    document.body.dataset.theme = resolved;
    document.body.dataset.themePreference = selectedTheme;
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f5f7fc" : "#070810");
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, selectedTheme); } catch {}
  }
  if (previousResolved && previousResolved !== resolved) {
    window.dispatchEvent(new CustomEvent("cointrack:theme-change", {
      detail: { preference: selectedTheme, theme: resolved },
    }));
  }
  return selectedTheme;
}

export function getStoredTheme() {
  try { return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY)); } catch { return "dark"; }
}

export async function syncThemeFromAccount() {
  try {
    const response = await fetch("/api/preferences", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) return selectedTheme;
    const data = await response.json();
    return applyThemePreference(data.preferences?.theme);
  } catch {
    return selectedTheme;
  }
}

deviceTheme.addEventListener("change", () => {
  if (selectedTheme === "system") applyThemePreference("system", { persist: false });
});

applyThemePreference(getStoredTheme(), { persist: false });
