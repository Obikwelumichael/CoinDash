# CoinDash

Telegram staging deployment and operational checks are documented in
[docs/telegram-staging-runbook.md](docs/telegram-staging-runbook.md).

## Authentication and PostgreSQL setup

Use Node.js 24.15.0 or newer. CoinDash uses PostgreSQL for accounts, server-side sessions, user preferences, and user-owned watchlist rows. Market data, charts, and WebSockets remain independent of the account database.

1. Install dependencies: `npm install`.
2. Create a PostgreSQL database and a database user, for example: `createdb cryptodash`.
3. Copy `.env.example` to `.env`, then set `DATABASE_URL` and a long random `SESSION_SECRET`. Keep `.env` private.
4. Run the schema migrations: `npm run migrate:up`.
5. Start the app: `npm run dev` (or `npm start`).
6. Open `http://localhost:3000/signup`, create an account, and confirm that `GET /api/auth/me` returns the safe user object. Sign out and confirm it returns `401` and `/api/watchlist` returns `401`.

## Password recovery and email verification

Configure `BREVO_API_KEY`, `EMAIL_FROM_NAME`, and `EMAIL_FROM_EMAIL` in `.env`, and set `APP_BASE_URL` to the exact public origin (HTTPS in production). `EMAIL_FROM_EMAIL` must exactly match a sender registered and verified in Brevo. Recovery, verification, welcome, and alert email is sent through Brevo's transactional email API and is never simulated. The reset request always responds with the same generic message to avoid disclosing whether an address has an account.

Run `npm run migrate:up` after pulling schema changes. Migration `002_auth_email_tokens` adds nullable `users.email_verified_at` plus separate hashed, expiring, single-use token tables. A reset token expires after 30 minutes; a verification token expires after 24 hours. A password reset updates the password and deletes all stored sessions for that user in one transaction. Verification is optional for current CoinDash features: an unverified user can still sign in and use the watchlist, and becomes verified only after completing the emailed link.

Pages: `/forgot-password`, `/reset-password?token=…`, and `/verify-email?token=…`. Verification links can be re-sent from the account menu. Auth/recovery/verification requests have rate limits.

## Advanced account features

Run `npm run migrate:up` to apply `003_advanced_account_features`. It adds encrypted TOTP enrollment state, one-use recovery-code hashes, short-lived login challenges, persistent per-user notifications, market alerts, and a JSON notification-preference field. Install dependencies with `npm install`; TOTP follows RFC 6238 through `otplib`, with QR rendering by `qrcode`.

Set `TOTP_ENCRYPTION_KEY` to a base64-encoded 32-byte random key before enabling 2FA. Keep the key in a secret manager, back it up separately from PostgreSQL, and do not rotate it without a planned re-encryption process; existing encrypted authenticator secrets cannot be decrypted without it. The authenticator code is verified before 2FA is activated. Login returns a short-lived, one-use challenge after a correct password; five failures invalidate the challenge. Ten high-entropy recovery codes are displayed only once and are stored as hashes.

Authenticated APIs are mounted under `/api/account`, `/api/notifications`, and `/api/alerts`. Notifications and alert ownership are always derived from the verified session. Alert evaluation runs once per minute against the existing shared market cache and only refreshes that cache when it is stale; no CoinGecko request is created per alert. Each alert triggers once while its condition is met and rearms only after the condition clears. Each account is limited to 20 alerts. Email alerts are optional (`emailAlerts` preference) and use the shared Brevo configuration. In-app notification history remains persisted.

## Automatic Telegram market feed

Migrations `007_automatic_market_feed` and `008_adaptive_market_feed` add normalized top-100 market observations, persistent normal/major detector state, logical signal events, and a nullable event reference on notifications. Every genuinely fresh cache update is evaluated promptly, while the existing alert scheduler remains the bounded fallback. The implementation does not add CoinGecko requests: it reuses the existing cache refresh, notification outbox, Telegram queue, and Telegram worker.

Balanced defaults are a 1.5% move over a preferred five-minute comparison, rolling 24-hour provider volume at 2× the median of at least six recent observations, and a 0.5% break beyond the prior one-hour observed range with at least six observations. Existing refresh paths produce snapshots roughly every one to five minutes depending on active WebSocket traffic, API cache use, and fallback evaluation, so the detector accepts only a bounded three-minute-old comparison around the five-minute target. It never creates a fetch merely to fill that window.

Normal signals use a ten-minute cooldown. Major signals are separately classified at a 3% five-minute price move, 4× volume, or a 1.5% range breakout with 2× volume confirmation when a reliable volume baseline is available. A normal condition escalating to major can bypass the normal cooldown once; major state and a separate two-minute emergency cooldown prevent repeat overrides. At most five new global signals are admitted per scan. The Telegram worker additionally reserves no more than 20 market-feed deliveries globally and five per user in a rolling ten-minute window, prioritizing major events while leaving excess jobs durably queued. Queued automatic signals expire after 20 minutes; disabling a category cancels that category's queued/retry deliveries. Older preference rows remain opted out until the user enables each category on `/signals`.

All normal, major, cooldown, TTL, and delivery-rate values are configurable through the `MARKET_FEED_*` variables documented in `.env.example`. Market observations are CoinGecko USD snapshots: `current_price`, `total_volume` (rolling 24-hour USD volume), `market_cap`, and `market_cap_rank`. Missing, stale, malformed, duplicate, and non-finite values are not treated as observations.

The `/settings` page supports profile name, existing theme preference, email-alert preference, password change, TOTP management, market alerts, notifications, and account deletion. Password change, 2FA disable, and account deletion require the current password; when 2FA is active they also require an authenticator or recovery code. Deletion permanently cascades the user's watchlist, preferences, alerts, notifications, tokens, and security records and invalidates sessions.

Generate a session secret with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The migration creates these tables:

- `users`: UUID identity, normalized unique email, Argon2id password hash, display name, and timestamps.
- `watchlist`: UUID row with a foreign key to `users`, `coin_id`, timestamp, and a unique `(user_id, coin_id)` constraint.
- `user_preferences`: one optional minimal preferences row per user.
- `session`: PostgreSQL-backed Express session records with an expiry index.
- `password_reset_tokens` and `email_verification_tokens`: one-time token hashes with expiry and usage timestamps; raw tokens are only delivered to the user's email.

Authentication uses an opaque `HttpOnly`, same-site session cookie. The browser never receives a password hash, session ID, or a user ID to authorize requests. `requireAuth` reloads the user from the session on every protected request, and watchlist queries always use that server-resolved user ID. There is intentionally no cross-origin CORS policy: CoinDash's API is same-origin by default.

For production, set `NODE_ENV=production`, serve the app over HTTPS, use a managed PostgreSQL TLS connection if required (`DATABASE_SSL=true`), and set `APP_BASE_URL` to the public HTTPS URL.
