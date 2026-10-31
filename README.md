# CoinDash

CoinDash is a full-stack cryptocurrency market dashboard. It provides live market views, interactive charts, trending assets and news, alongside secure accounts, saved watchlists, price alerts, and optional Telegram notifications.

## Features

- Live cryptocurrency market data, market sentiment, price charts, trending assets, and crypto news.
- Personal watchlists and market alerts stored per account.
- Secure account registration and sign-in with PostgreSQL-backed sessions.
- Password recovery, email verification, password changes, and optional two-factor authentication (TOTP with recovery codes).
- In-app, email, and optional Telegram alert delivery.
- Automatic Telegram market-feed alerts for notable price moves, volume spikes, and range breakouts.
- Responsive pages for Markets, Trending, Watchlist, News, Signals, and Account Settings.

## Tech stack

- Node.js and Express
- PostgreSQL with `node-postgres` and `node-pg-migrate`
- Vanilla JavaScript, HTML, and CSS
- WebSockets for live market updates
- Argon2id password hashing, server-side sessions, and TOTP two-factor authentication
- CoinGecko market data, Brevo transactional email, and the Telegram Bot API

## Requirements

- Node.js 24.15.0 or newer
- PostgreSQL
- npm

## Local setup

1. Clone the repository and enter the project folder.

   ```sh
   git clone https://github.com/Obikwelumichael/CoinDash.git
   cd CoinDash
   ```

2. Install dependencies.

   ```sh
   npm install
   ```

3. Create the PostgreSQL role and database. Choose a strong password; use letters and numbers to avoid URL-encoding it in the connection string.

   ```sh
   sudo -u postgres psql
   ```

   ```sql
   CREATE USER cryptodash_user WITH PASSWORD 'choose-a-strong-password';
   CREATE DATABASE cryptodash OWNER cryptodash_user;
   \q
   ```

4. Create your local environment file.

   ```sh
   cp .env.example .env
   ```

5. In `.env`, set the connection string and session secret.

   ```env
   DATABASE_URL=postgresql://cryptodash_user:choose-a-strong-password@localhost:5432/cryptodash
   SESSION_SECRET=replace-with-a-long-random-secret
   ```

   Generate a session secret with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   Keep `.env` private. Never commit passwords, API keys, session secrets, or Telegram tokens.

6. Run the database migrations.

   ```sh
   npm run migrate:up
   ```

7. Start the development server.

   ```sh
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000), then create an account at `/signup`.

## Scripts

```sh
npm run dev          # Start the development server with Nodemon
npm start            # Start the production server
npm run migrate:up   # Apply PostgreSQL migrations
npm run migrate:down # Revert the most recent migration
npm test             # Run the automated test suite
```

## Configuration

`DATABASE_URL` and `SESSION_SECRET` are required. The remaining values in `.env.example` support optional integrations:

- `BREVO_API_KEY`, `EMAIL_FROM_NAME`, and `EMAIL_FROM_EMAIL` enable verification, password-reset, welcome, and email-alert messages. The sender address must be verified in Brevo.
- `TOTP_ENCRYPTION_KEY` is required before enabling two-factor authentication. Use a base64-encoded 32-byte secret and store it safely; existing TOTP secrets cannot be decrypted without it.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and `TELEGRAM_WEBHOOK_SECRET` enable Telegram account linking and alerts.
- `COINGECKO_API_KEY` and `FREECRYPTO_API_KEY` configure the supported market-data providers when needed.

For production, use HTTPS, set `NODE_ENV=production`, set `APP_BASE_URL` to the public HTTPS URL, and set `DATABASE_SSL=true` when your PostgreSQL provider requires TLS.

## Security and account behaviour

Passwords are stored with Argon2id. Authentication uses opaque, `HttpOnly`, same-site cookies backed by PostgreSQL sessions; the browser never receives a password hash or session ID as application data. Account, alert, notification, and watchlist ownership is always resolved from the authenticated server session.

Two-factor authentication uses time-based one-time passwords (TOTP). Login challenges expire quickly, recovery codes are one-use hashes, and authentication/account-action endpoints are rate limited. Email verification is optional for current dashboard features.

## Telegram market feed

CoinDash can identify significant market movement from its shared market cache and queue optional Telegram alerts. The feed detects configured price changes, volume spikes, and range breakouts; it includes cooldowns, rate limits, and expiry rules to prevent repeated or stale notifications.

Telegram staging deployment and operational checks are documented in [docs/telegram-staging-runbook.md](docs/telegram-staging-runbook.md).

## Screenshots

### Markets dashboard

![CoinDash Markets dashboard](docs/images/markets-dashboard-hero.png)

The Markets dashboard provides a live market overview, market breadth, global context, and quick access to the asset table and market movers.

## License

This project is licensed under the ISC License. See [package.json](package.json) for the declared license.
