import { getCurrentUser, logoutUser, subscribeAuth } from "../services/auth-store.js";
import "./theme.js";

const isAuthPage = document.body.matches(".auth-page:not(.settings-page)");

if (!isAuthPage && !document.querySelector(".site-footer")) {
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.setAttribute("aria-labelledby", "footerBrandHeading");
  footer.innerHTML = `
    <div class="footer-container">
      <div class="footer-top">
        <section class="footer-brand" aria-labelledby="footerBrandHeading">
          <a class="logo footer-logo" href="/markets" aria-label="CoinDash market overview">Coin<span>Dash</span></a>
          <h2 id="footerBrandHeading">Your crypto market intelligence platform.</h2>
          <p>Track cryptocurrency markets, analyze price movements, discover trending assets, and manage your watchlist in one place.</p>
        </section>
        <nav class="footer-columns" aria-label="Footer navigation">
          <section class="footer-column" aria-labelledby="footerMarketsHeading">
            <h2 id="footerMarketsHeading">Markets</h2>
            <ul>
              <li><a href="/markets#market-table">Market Overview</a></li>
              <li><a href="/trending">Trending Coins</a></li>
              <li><a href="/watchlist">Watchlist</a></li>
              <li><a href="/markets#marketMovers">Gainers &amp; Losers</a></li>
              <li><a href="/markets#marketSentiment">Market Sentiment</a></li>
              <li><a href="/news">Cryptocurrency News</a></li>
            </ul>
          </section>
          <section class="footer-column" aria-labelledby="footerAccountHeading">
            <h2 id="footerAccountHeading">Account &amp; Tools</h2>
            <ul data-footer-account-links aria-live="polite" aria-busy="true">
              <li><span>Checking account…</span></li>
            </ul>
            <p class="footer-account-status" data-footer-status role="status" aria-live="polite"></p>
          </section>
          <section class="footer-column" aria-labelledby="footerResourcesHeading">
            <h2 id="footerResourcesHeading">Resources</h2>
            <ul>
              <li><a href="/news">Crypto News</a></li>
              <li><a href="/markets#data-attribution">Data Sources &amp; Credits</a></li>
            </ul>
          </section>
          <section class="footer-column" aria-labelledby="footerPoliciesHeading">
            <h2 id="footerPoliciesHeading">Policies</h2>
            <ul>
              <li><a href="/privacy">Privacy Policy</a></li>
              <li><a href="/terms">Terms of Use</a></li>
              <li><a href="#cookie-settings" data-open-cookie-settings>Cookie Settings</a></li>
            </ul>
          </section>
        </nav>
      </div>

  <section class="footer-attribution" aria-labelledby="data-attribution">
        <h2 id="data-attribution">Data &amp; Attribution</h2>
        <p><a href="https://www.coingecko.com/en/api" target="_blank" rel="noopener noreferrer">Data provided by CoinGecko</a> for market information.</p>
        <p>Intraday exchange candles are sourced from <a href="https://developers.binance.com/en/docs/products/spot/rest-api" target="_blank" rel="noopener noreferrer">Binance public market data</a>. CoinDash is independent and is not affiliated with or endorsed by Binance.</p>
        <p>Crypto news is provided by <a href="https://cryptocurrency.cv/" target="_blank" rel="noopener noreferrer">Cryptocurrency.cv</a>; articles link to their original publishers where available.</p>
        <p><a href="https://tradingview.github.io/lightweight-charts/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a> Copyright (c) 2025 TradingView, Inc. <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">https://www.tradingview.com/</a></p>
      </section>

      <div class="footer-bottom">
        <p class="footer-copyright">© <span data-footer-year></span> CoinDash. All rights reserved.</p>
        <p class="footer-risk">CoinDash provides market information for informational purposes only. Cryptocurrency prices are volatile, and information displayed on this platform may be delayed or incomplete. Nothing on this platform constitutes financial or investment advice.</p>
      </div>
    </div>`;

  document.body.append(footer);
  footer.querySelector("[data-footer-year]").textContent = String(new Date().getFullYear());
  if (window.location.hash === "#data-attribution") {
    requestAnimationFrame(() => footer.scrollIntoView());
  }

  const accountLinks = footer.querySelector("[data-footer-account-links]");
  const accountStatus = footer.querySelector("[data-footer-status]");

  function appendLink(label, href) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    item.append(link);
    accountLinks.append(item);
  }

  function renderAccountLinks({ authenticated, initialized, error }) {
    accountLinks.replaceChildren();
    accountLinks.setAttribute("aria-busy", String(!initialized));
    accountStatus.textContent = "";

    if (!initialized) {
      const item = document.createElement("li");
      item.textContent = "Checking account…";
      accountLinks.append(item);
      return;
    }
    if (error) {
      const item = document.createElement("li");
      item.textContent = "Account links are temporarily unavailable.";
      accountLinks.append(item);
      return;
    }
    if (!authenticated) {
      appendLink("Sign In", "/login");
      appendLink("Create Account", "/signup");
      return;
    }

    appendLink("My Watchlist", "/watchlist");
    appendLink("Price Alerts", "/settings#alertsTitle");
    appendLink("Notifications", "/settings#notificationsTitle");
    appendLink("Account Settings", "/settings");

    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "footer-logout";
    button.textContent = "Sign Out";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Signing out…";
      try {
        await logoutUser();
      } catch (logoutError) {
        button.disabled = false;
        button.textContent = "Sign Out";
        accountStatus.textContent = logoutError.message || "Unable to sign out. Please try again.";
      }
    });
    item.append(button);
    accountLinks.append(item);
  }

  subscribeAuth(renderAccountLinks);
  getCurrentUser();
}
