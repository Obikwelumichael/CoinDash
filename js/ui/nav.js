import { getCurrentUser, logoutUser, requestEmailVerification, subscribeAuth } from "../services/auth-store.js";
import { syncThemeFromAccount } from "./theme.js";

const navToggle = document.getElementById("mobileNavToggle");
const primaryNav = document.getElementById("primaryNav");
const desktopAuth = document.querySelector("[data-auth-desktop]");
const mobileAuth = document.querySelector("[data-auth-mobile]");
const SIDEBAR_STATE_KEY = "cointrack.dashboard-sidebar-collapsed.v1";
const PENDING_SECTION_KEY = "cointrack.pending-section-scroll.v1";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const mobileMenuMedia = window.matchMedia("(max-width: 1000px)");
let sectionScrollRequest = 0;
let accountMenuSequence = 0;
let openAccountMenu = null;

const sidebarGroups = [
  {
    label: "Main",
    links: [
      { label: "Dashboard", href: "/", icon: "⌂" },
      { label: "Markets", href: "/markets", icon: "◫" },
      { label: "Trending", href: "/trending", icon: "↗" },
      { label: "Watchlist", href: "/watchlist", icon: "☆" },
      { label: "Signals", href: "/signals", icon: "⌁" },
    ],
  },
  {
    label: "Analytics",
    links: [
      { label: "Market overview", href: "/markets#marketOverview", icon: "◉" },
      { label: "Market breadth", href: "/markets#marketBreadthTitle", icon: "↔" },
      { label: "Market sentiment", href: "/#marketSentiment", icon: "◐" },
      { label: "Gainers & losers", href: "/#marketMovers", icon: "⇅" },
    ],
  },
  {
    label: "Information",
    links: [
      { label: "Market news", href: "/news", icon: "◇" },
    ],
  },
  {
    label: "Account",
    links: [
      { label: "Notifications", href: "/signals#recentActivity", icon: "○" },
      { label: "Settings", href: "/settings", icon: "⚙" },
    ],
  },
];

function createDashboardSidebar() {
  const header = document.querySelector(".navbar");
  const main = document.querySelector("main");
  if (primaryNav && !primaryNav.querySelector('a[href="/"]')) {
    primaryNav.prepend(createLink("Dashboard", "/", "mobile-nav-only"));
  }
  if (primaryNav && !primaryNav.querySelector('a[href="/signals"]')) {
    const mobileAuthHost = primaryNav.querySelector("[data-auth-mobile]");
    const signalsLink = createLink("Signals", "/signals");
    if (mobileAuthHost) mobileAuthHost.before(signalsLink);
    else primaryNav.append(signalsLink);
  }
  if (primaryNav && !primaryNav.querySelector('a[href="/news"]')) {
    const mobileAuthHost = primaryNav.querySelector("[data-auth-mobile]");
    const newsLink = createLink("News", "/news");
    if (mobileAuthHost) mobileAuthHost.before(newsLink);
    else primaryNav.append(newsLink);
  }
  if (!document.body.classList.contains("dashboard-shell-page")
      || !header || !main || document.querySelector(".dashboard-sidebar")) return;

  document.body.classList.add("dashboard-shell-page");
  main.classList.add("dashboard-main");
  const sidebar = document.createElement("aside");
  sidebar.className = "dashboard-sidebar";
  sidebar.setAttribute("aria-label", "Dashboard navigation");

  const sidebarToggle = document.createElement("button");
  sidebarToggle.className = "dashboard-sidebar-toggle";
  sidebarToggle.type = "button";
  sidebarToggle.innerHTML = '<span aria-hidden="true">‹</span><span class="sidebar-toggle-label">Collapse sidebar</span>';

  const setSidebarCollapsed = (collapsed, persist = true) => {
    document.body.classList.toggle("dashboard-sidebar-collapsed", collapsed);
    sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggle.setAttribute("aria-label", collapsed ? "Expand dashboard sidebar" : "Collapse dashboard sidebar");
    sidebarToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    sidebarToggle.querySelector('[aria-hidden="true"]').textContent = collapsed ? "›" : "‹";
    sidebar.querySelectorAll("a").forEach((link) => {
      link.title = collapsed ? link.textContent.trim() : "";
    });
    if (persist) {
      try {
        localStorage.setItem(SIDEBAR_STATE_KEY, String(collapsed));
      } catch {
        // The layout remains usable when browser storage is unavailable.
      }
    }
  };

  let sidebarCollapsed = false;
  try {
    sidebarCollapsed = localStorage.getItem(SIDEBAR_STATE_KEY) === "true";
  } catch {
    // Use the expanded default when browser storage is unavailable.
  }
  sidebarToggle.addEventListener("click", () => {
    setSidebarCollapsed(!document.body.classList.contains("dashboard-sidebar-collapsed"));
  });
  sidebar.append(sidebarToggle);

  const overview = document.createElement("div");
  overview.className = "sidebar-overview";
  overview.innerHTML = '<span class="sidebar-live-dot" aria-hidden="true"></span><div><strong>Market feed</strong><small>Updates every minute</small></div>';
  sidebar.append(overview);

  sidebarGroups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "sidebar-group";
    const heading = document.createElement("h2");
    heading.textContent = group.label;
    section.append(heading);
    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", `${group.label} navigation`);
    group.links.forEach((item) => {
      const link = document.createElement("a");
      link.href = item.href;
      link.innerHTML = `<span aria-hidden="true">${item.icon}</span><strong>${item.label}</strong>`;
      const target = new URL(item.href, window.location.origin);
      const samePath = target.pathname === window.location.pathname;
      const sameHash = !target.hash || target.hash === window.location.hash;
      if (samePath && sameHash) link.setAttribute("aria-current", "page");
      nav.append(link);
    });
    section.append(nav);
    sidebar.append(section);
  });

  header.insertAdjacentElement("afterend", sidebar);
  setSidebarCollapsed(sidebarCollapsed, false);
}

function createNotificationLink() {
  const link = createLink("", "/signals#recentActivity", "header-icon-link");
  link.setAttribute("aria-label", "Open notifications");
  link.title = "Notifications";
  link.innerHTML = '<span aria-hidden="true">○</span>';
  return link;
}

function createLink(label, href, className = "") {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  if (className) link.className = className;
  return link;
}

function createLogoutButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "account-menu-logout";
  button.setAttribute("role", "menuitem");
  button.innerHTML = '<span class="account-menu-item-icon" aria-hidden="true">↪</span><span><strong>Sign out</strong><small>End this secure session</small></span>';
  button.addEventListener("click", async () => {
    const status = button.closest(".account-menu-panel")?.querySelector("[data-account-menu-feedback]");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (status) status.textContent = "Signing out…";
    try {
      await logoutUser();
    } catch (error) {
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
      const message = error.message || "Unable to sign out. Try again.";
      if (status) status.textContent = message;
      const navStatus = document.querySelector("[data-auth-status]");
      if (navStatus) navStatus.textContent = message;
    }
  });
  return button;
}

function createVerificationButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "account-menu-item account-menu-verify";
  button.setAttribute("role", "menuitem");
  button.innerHTML = '<span class="account-menu-item-icon" aria-hidden="true">✓</span><span><strong>Verify email</strong><small>Confirm your account address</small></span>';
  button.addEventListener("click", async () => {
    const status = button.closest(".account-menu-panel")?.querySelector("[data-account-menu-feedback]");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (status) status.textContent = "Sending verification email…";
    try {
      const result = await requestEmailVerification();
      if (status) status.textContent = result.message || "Check your inbox for the verification link.";
    } catch (error) {
      if (status) status.textContent = error.message || "Email delivery is unavailable.";
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
    }
  });
  return button;
}

function accountInitials(displayName) {
  const initials = String(displayName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toUpperCase();
  return initials || "CD";
}

function createAccountAvatar(user, className = "") {
  const avatar = document.createElement("span");
  avatar.className = `account-menu-avatar${className ? ` ${className}` : ""}`;
  avatar.textContent = accountInitials(user.display_name);
  avatar.setAttribute("aria-hidden", "true");
  return avatar;
}

function createAccountMenuLink(label, description, href, icon) {
  const link = createLink("", href, "account-menu-item");
  link.setAttribute("role", "menuitem");
  link.innerHTML = `<span class="account-menu-item-icon" aria-hidden="true">${icon}</span><span><strong>${label}</strong><small>${description}</small></span>`;
  return link;
}

function setAccountMenuOpen(menu, shouldOpen, { focusMenu = false, restoreFocus = false } = {}) {
  if (!menu) return;
  if (shouldOpen && openAccountMenu && openAccountMenu !== menu) {
    setAccountMenuOpen(openAccountMenu, false);
  }
  const trigger = menu.querySelector(".account-menu-trigger");
  const panel = menu.querySelector(".account-menu-panel");
  menu.classList.toggle("is-open", shouldOpen);
  trigger.setAttribute("aria-expanded", String(shouldOpen));
  panel.setAttribute("aria-hidden", String(!shouldOpen));
  panel.inert = !shouldOpen;
  openAccountMenu = shouldOpen ? menu : (openAccountMenu === menu ? null : openAccountMenu);
  if (focusMenu && shouldOpen) {
    requestAnimationFrame(() => panel.querySelector('[role="menuitem"]:not([disabled])')?.focus());
  } else if (restoreFocus && !shouldOpen) {
    requestAnimationFrame(() => trigger.focus());
  }
}

function createAccountMenu(user, mobile = false) {
  const menu = document.createElement("div");
  menu.className = mobile ? "account-menu account-menu-mobile" : "account-menu";
  const menuId = `accountMenuPanel${++accountMenuSequence}`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "account-menu-trigger";
  trigger.setAttribute("aria-label", `Open account menu for ${user.display_name}`);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);
  const triggerName = document.createElement("span");
  triggerName.className = "account-menu-trigger-name";
  triggerName.textContent = user.display_name;
  const chevron = document.createElement("span");
  chevron.className = "account-menu-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";
  trigger.append(createAccountAvatar(user), triggerName, chevron);
  menu.append(trigger);

  const panel = document.createElement("div");
  panel.className = "account-menu-panel";
  panel.id = menuId;
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", "Account navigation");
  panel.setAttribute("aria-hidden", "true");
  panel.inert = true;

  const identity = document.createElement("div");
  identity.className = "account-menu-identity";
  identity.append(createAccountAvatar(user, "account-menu-avatar-large"));
  const identityCopy = document.createElement("span");
  const identityName = document.createElement("strong");
  identityName.textContent = user.display_name;
  const identityEmail = document.createElement("small");
  identityEmail.textContent = user.email;
  const identityStatus = document.createElement("em");
  identityStatus.className = user.email_verified ? "is-verified" : "is-unverified";
  identityStatus.textContent = user.email_verified ? "Email verified" : "Verification needed";
  identityCopy.append(identityName, identityEmail, identityStatus);
  identity.append(identityCopy);

  const navigation = document.createElement("div");
  navigation.className = "account-menu-navigation";
  navigation.setAttribute("role", "none");
  navigation.append(
    createAccountMenuLink("Watchlist", "Your saved assets", "/watchlist", "☆"),
    createAccountMenuLink("Account settings", "Profile and preferences", "/settings", "⚙"),
    createAccountMenuLink("Security", "Password and two-factor", "/settings#securityTitle", "◇"),
    createAccountMenuLink("Alerts & Telegram", "Rules and delivery settings", "/signals#deliverySettingsTitle", "⌁"),
  );

  panel.append(identity, navigation);
  if (!user.email_verified) panel.append(createVerificationButton());
  panel.append(createLogoutButton());
  const feedback = document.createElement("p");
  feedback.className = "account-menu-feedback";
  feedback.dataset.accountMenuFeedback = "";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  panel.append(feedback);
  menu.append(panel);

  trigger.addEventListener("click", () => {
    setAccountMenuOpen(menu, trigger.getAttribute("aria-expanded") !== "true");
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setAccountMenuOpen(menu, true, { focusMenu: true });
    if (event.key === "ArrowUp") {
      requestAnimationFrame(() => {
        const items = [...panel.querySelectorAll('[role="menuitem"]:not([disabled])')];
        items.at(-1)?.focus();
      });
    }
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("a")) setAccountMenuOpen(menu, false);
  });
  panel.addEventListener("keydown", (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...panel.querySelectorAll('[role="menuitem"]:not([disabled])')];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    if (event.key === "Home") items[0].focus();
    else if (event.key === "End") items.at(-1).focus();
    else if (event.key === "ArrowDown") items[(current + 1) % items.length].focus();
    else items[(current <= 0 ? items.length : current) - 1].focus();
  });
  return menu;
}

document.addEventListener("pointerdown", (event) => {
  if (openAccountMenu && !openAccountMenu.contains(event.target)) setAccountMenuOpen(openAccountMenu, false);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !openAccountMenu) return;
  event.preventDefault();
  setAccountMenuOpen(openAccountMenu, false, { restoreFocus: true });
});

function renderAuthNav({ user, authenticated, initialized, error }) {
  if (openAccountMenu) setAccountMenuOpen(openAccountMenu, false);
  [desktopAuth, mobileAuth].forEach((host) => {
    if (!host) return;
    host.replaceChildren();
    host.setAttribute("aria-busy", String(!initialized));
  });
  if (!initialized) return;

  if (authenticated) {
    if (desktopAuth) desktopAuth.append(createNotificationLink(), createAccountMenu(user));
    if (mobileAuth) mobileAuth.append(createAccountMenu(user, true));
  } else if (!error) {
    if (desktopAuth) desktopAuth.append(
      createLink("Sign In", "/login", "login-button auth-nav-link"),
      createLink("Sign Up", "/signup", "login-button auth-nav-link auth-nav-primary"),
    );
    if (mobileAuth) mobileAuth.append(
      createLink("Sign In", "/login", "auth-nav-mobile-link"),
      createLink("Sign Up", "/signup", "login-button mobile-menu-login auth-nav-mobile-primary"),
    );
  }

  const status = document.querySelector("[data-auth-status]");
  if (status) status.textContent = error ? "Account status is temporarily unavailable." : "";
  updatePrimaryNavState();
}

subscribeAuth(renderAuthNav);
getCurrentUser().then((user) => {
  if (user && !document.body.classList.contains("settings-page")) syncThemeFromAccount();
});
createDashboardSidebar();

function normalizedPath(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
}

function routePath(pathname) {
  const normalized = normalizedPath(pathname);
  const aliases = {
    "/index.html": "/",
    "/pages/markets.html": "/markets",
    "/pages/trending.html": "/trending",
    "/pages/watchlist.html": "/watchlist",
    "/pages/signals.html": "/signals",
    "/pages/news.html": "/news",
    "/pages/settings.html": "/settings",
  };
  return aliases[normalized] ?? normalized;
}

function updatePrimaryNavState() {
  if (!primaryNav) return;
  const currentPath = routePath(window.location.pathname);
  primaryNav.querySelectorAll("a[href]").forEach((link) => {
    if (link.classList.contains("nav-sentiment-mobile")) return;
    const target = new URL(link.href, window.location.origin);
    const isCurrent = target.origin === window.location.origin
      && !target.hash
      && routePath(target.pathname) === currentPath;
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function enhanceMobileNavigation() {
  if (!primaryNav) return;
  if (!primaryNav.querySelector(".mobile-nav-heading")) {
    const heading = document.createElement("div");
    heading.className = "mobile-nav-heading";
    heading.innerHTML = '<a class="mobile-nav-brand" href="/" aria-label="CoinDash dashboard">Coin<span>Dash</span></a><span>Navigation</span>';
    primaryNav.prepend(heading);
  }

  const icons = new Map([
    ["/", "⌂"],
    ["/markets", "◫"],
    ["/trending", "↗"],
    ["/watchlist", "☆"],
    ["/signals", "⌁"],
    ["/news", "◇"],
  ]);
  primaryNav.querySelectorAll(":scope > a[href]").forEach((link) => {
    if (link.classList.contains("nav-sentiment-mobile")
        || link.classList.contains("mobile-nav-brand")
        || link.querySelector(".mobile-nav-icon")) return;
    const icon = document.createElement("span");
    icon.className = "mobile-nav-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = icons.get(routePath(new URL(link.href, window.location.origin).pathname)) ?? "·";
    link.prepend(icon);
    link.classList.add("mobile-nav-item");
  });

  const sentiment = primaryNav.querySelector(".nav-sentiment-mobile");
  const authHost = primaryNav.querySelector("[data-auth-mobile]");
  if (sentiment && authHost) authHost.before(sentiment);
  updatePrimaryNavState();
}

enhanceMobileNavigation();

function getScrollOffset() {
  const navbar = document.querySelector(".navbar");
  return (navbar?.getBoundingClientRect().height || 0) + 18;
}

function waitForSectionLayout(target, timeout = 2400) {
  const startedAt = performance.now();
  let previousTop = null;
  let stableSamples = 0;

  return new Promise((resolve) => {
    const check = () => {
      const targetTop = target.getBoundingClientRect().top + window.scrollY;
      const pendingRegions = [...document.querySelectorAll('main [aria-busy="true"]')]
        .filter((region) => region === target
          || region.contains(target)
          || Boolean(region.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING));
      const positionStable = previousTop !== null && Math.abs(targetTop - previousTop) < 1;
      stableSamples = positionStable ? stableSamples + 1 : 0;
      previousTop = targetTop;

      if ((!pendingRegions.length && stableSamples >= 3) || performance.now() - startedAt >= timeout) {
        resolve();
        return;
      }
      window.setTimeout(check, 80);
    };
    requestAnimationFrame(check);
  });
}

async function scrollToSection(hash, { updateHistory = false } = {}) {
  const requestId = ++sectionScrollRequest;
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  const target = id ? document.getElementById(id) : null;
  if (!target) return false;

  if (updateHistory) history.pushState(null, "", `#${encodeURIComponent(id)}`);
  if (document.fonts?.ready) await document.fonts.ready;
  await waitForSectionLayout(target);
  if (requestId !== sectionScrollRequest) return false;
  const top = target.getBoundingClientRect().top + window.scrollY - getScrollOffset();
  window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion.matches ? "auto" : "smooth" });
  return true;
}

function storePendingSection(targetUrl) {
  try {
    sessionStorage.setItem(PENDING_SECTION_KEY, JSON.stringify({
      path: normalizedPath(targetUrl.pathname),
      hash: targetUrl.hash,
    }));
  } catch {
    // Navigation still works when session storage is unavailable.
  }
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    || link.target === "_blank" || link.hasAttribute("download")
    || link.hasAttribute("data-open-cookie-settings")) return;

  const targetUrl = new URL(link.href, window.location.href);
  if (targetUrl.origin !== window.location.origin || !targetUrl.hash) return;

  const samePage = normalizedPath(targetUrl.pathname) === normalizedPath(window.location.pathname)
    && targetUrl.search === window.location.search;
  if (samePage) {
    if (!document.getElementById(decodeURIComponent(targetUrl.hash.slice(1)))) return;
    event.preventDefault();
    scrollToSection(targetUrl.hash, { updateHistory: targetUrl.hash !== window.location.hash });
    return;
  }

  event.preventDefault();
  storePendingSection(targetUrl);
  window.location.assign(`${targetUrl.pathname}${targetUrl.search}`);
});

window.addEventListener("popstate", () => {
  if (window.location.hash) scrollToSection(window.location.hash);
});

try {
  const pendingSection = JSON.parse(sessionStorage.getItem(PENDING_SECTION_KEY) || "null");
  if (pendingSection?.hash && pendingSection.path === normalizedPath(window.location.pathname)) {
    sessionStorage.removeItem(PENDING_SECTION_KEY);
    scrollToSection(pendingSection.hash, { updateHistory: true });
  }
} catch {
  // Ignore malformed or unavailable session storage and keep native navigation usable.
}

// Warm the next document on intent so multi-page navigation keeps its native
// URLs and accessibility while avoiding an unnecessary cold load.
const prefetchedPages = new Set();
function prefetchPage(link) {
  if (!link || link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
  const target = `${link.pathname}${link.search}`;
  if (prefetchedPages.has(target)) return;
  prefetchedPages.add(target);
  const hint = document.createElement("link");
  hint.rel = "prefetch";
  hint.as = "document";
  hint.href = target;
  document.head.append(hint);
}

document.querySelectorAll('a[href^="/"]').forEach((link) => {
  link.addEventListener("pointerenter", () => prefetchPage(link), { once: true });
  link.addEventListener("focus", () => prefetchPage(link), { once: true });
});

if (navToggle && primaryNav) {
  const backdrop = document.createElement("div");
  backdrop.className = "mobile-nav-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  document.body.append(backdrop);
  let bodyOverflowBeforeMenu = "";

  const setMenuOpen = (isOpen, { returnFocus = false } = {}) => {
    const shouldOpen = Boolean(isOpen && mobileMenuMedia.matches);
    const wasOpen = document.body.classList.contains("mobile-nav-open");
    if (!shouldOpen && openAccountMenu) setAccountMenuOpen(openAccountMenu, false);
    if (shouldOpen && !wasOpen) {
      bodyOverflowBeforeMenu = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    } else if (!shouldOpen && wasOpen) {
      document.body.style.overflow = bodyOverflowBeforeMenu;
    }

    document.body.classList.toggle("mobile-nav-open", shouldOpen);
    navToggle.setAttribute("aria-expanded", String(shouldOpen));
    navToggle.setAttribute("aria-label", shouldOpen ? "Close navigation menu" : "Open navigation menu");
    primaryNav.classList.toggle("is-open", shouldOpen);
    backdrop.classList.toggle("is-open", shouldOpen);
    backdrop.setAttribute("aria-hidden", String(!shouldOpen));
    primaryNav.inert = mobileMenuMedia.matches && !shouldOpen;
    if (mobileMenuMedia.matches) primaryNav.setAttribute("aria-hidden", String(!shouldOpen));
    else primaryNav.removeAttribute("aria-hidden");
    if (!shouldOpen && returnFocus && mobileMenuMedia.matches) {
      requestAnimationFrame(() => navToggle.focus({ preventScroll: true }));
    }
  };

  const syncMenuViewport = () => {
    if (mobileMenuMedia.matches) setMenuOpen(false);
    else {
      setMenuOpen(false);
      primaryNav.inert = false;
      primaryNav.removeAttribute("aria-hidden");
    }
  };

  navToggle.addEventListener("click", (event) => {
    event.preventDefault();
    setMenuOpen(navToggle.getAttribute("aria-expanded") !== "true");
  });

  primaryNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenuOpen(false);
  });

  backdrop.addEventListener("click", () => setMenuOpen(false, { returnFocus: true }));

  document.addEventListener("keydown", (event) => {
    if (navToggle.getAttribute("aria-expanded") !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false, { returnFocus: true });
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [navToggle, ...primaryNav.querySelectorAll('a[href], summary, button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length && !element.closest("[hidden]"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  mobileMenuMedia.addEventListener("change", syncMenuViewport);
  syncMenuViewport();
}
