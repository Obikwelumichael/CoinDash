const { pool } = require("../db/pool");
const { isMarketSnapshotFresh } = require("./evaluator");

const COIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SIGNAL_PREFERENCES = Object.freeze({
  price_movement: "market_price_movements",
  unusual_volume: "market_unusual_volume",
  breakout: "market_breakouts",
});
const DEFAULT_MARKET_FEED_CONFIG = Object.freeze({
  priceWindowMs: 5 * 60_000,
  priceThresholdPercent: 1.5,
  majorPriceThresholdPercent: 3,
  comparableObservationToleranceMs: 3 * 60_000,
  volumeBaselineWindowMs: 60 * 60_000,
  volumeBaselineSamples: 6,
  volumeMultiplier: 2,
  majorVolumeMultiplier: 4,
  breakoutLookbackMs: 60 * 60_000,
  breakoutMinimumSamples: 6,
  breakoutBufferPercent: 0.5,
  majorBreakoutPercent: 1.5,
  majorBreakoutVolumeMultiplier: 2,
  normalCooldownMs: 10 * 60_000,
  emergencyCooldownMs: 2 * 60_000,
  eventTtlMs: 20 * 60_000,
  maxSignalsPerScan: 5,
  observationRetentionMs: 24 * 60 * 60_000,
});

function positiveNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > minimum ? parsed : fallback;
}

function marketFeedConfig(env = process.env) {
  const priceWindowMinutes = Math.max(5, positiveNumber(env.MARKET_FEED_PRICE_WINDOW_MINUTES, 5));
  const priceThresholdPercent = positiveNumber(env.MARKET_FEED_PRICE_THRESHOLD_PERCENT, 1.5);
  const volumeMultiplier = positiveNumber(env.MARKET_FEED_VOLUME_MULTIPLIER, 2, 1);
  const breakoutBufferPercent = positiveNumber(env.MARKET_FEED_BREAKOUT_BUFFER_PERCENT, 0.5);
  return {
    ...DEFAULT_MARKET_FEED_CONFIG,
    priceWindowMs: priceWindowMinutes * 60_000,
    priceThresholdPercent,
    majorPriceThresholdPercent: Math.max(priceThresholdPercent, positiveNumber(env.MARKET_FEED_MAJOR_PRICE_THRESHOLD_PERCENT, 3)),
    volumeMultiplier,
    majorVolumeMultiplier: Math.max(volumeMultiplier, positiveNumber(env.MARKET_FEED_MAJOR_VOLUME_MULTIPLIER, 4, 1)),
    breakoutLookbackMs: positiveNumber(env.MARKET_FEED_BREAKOUT_LOOKBACK_MINUTES, 60) * 60_000,
    breakoutBufferPercent,
    majorBreakoutPercent: Math.max(breakoutBufferPercent, positiveNumber(env.MARKET_FEED_MAJOR_BREAKOUT_PERCENT, 1.5)),
    majorBreakoutVolumeMultiplier: positiveNumber(env.MARKET_FEED_MAJOR_BREAKOUT_VOLUME_MULTIPLIER, 2, 1),
    normalCooldownMs: positiveNumber(env.MARKET_FEED_COOLDOWN_MINUTES, 10) * 60_000,
    emergencyCooldownMs: positiveNumber(env.MARKET_FEED_EMERGENCY_COOLDOWN_MINUTES, 2) * 60_000,
    eventTtlMs: positiveNumber(env.MARKET_FEED_EVENT_TTL_MINUTES, 20) * 60_000,
  };
}

function selectEligibleMarkets(markets, limit = 100) {
  const byId = new Map();
  for (const coin of Array.isArray(markets) ? markets : []) {
    const id = String(coin?.id || "");
    const rank = Number(coin?.market_cap_rank);
    const price = Number(coin?.current_price);
    const marketCap = Number(coin?.market_cap);
    const volume = coin?.total_volume === null || coin?.total_volume === undefined ? null : Number(coin.total_volume);
    if (!COIN_ID_PATTERN.test(id) || byId.has(id) || !coin?.name || !coin?.symbol) continue;
    if (!Number.isInteger(rank) || rank < 1 || !Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(marketCap) || marketCap <= 0) continue;
    byId.set(id, {
      id,
      name: String(coin.name).slice(0, 120),
      symbol: String(coin.symbol).toUpperCase().slice(0, 30),
      rank,
      price,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
      marketCap,
    });
  }
  return [...byId.values()]
    .sort((a, b) => a.rank - b.rank || b.marketCap - a.marketCap || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentChange(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous > 0
    ? ((current - previous) / previous) * 100
    : null;
}

function evaluateCoinSignals(current, history, observedAt, config = DEFAULT_MARKET_FEED_CONFIG) {
  const nowMs = new Date(observedAt).getTime();
  const previous = (Array.isArray(history) ? history : [])
    .map((item) => ({
      observedAt: new Date(item.observed_at ?? item.observedAt).getTime(),
      price: Number(item.current_price ?? item.price),
      volume: item.total_volume === null || item.volume === null ? null : Number(item.total_volume ?? item.volume),
    }))
    .filter((item) => Number.isFinite(item.observedAt) && item.observedAt < nowMs && Number.isFinite(item.price) && item.price > 0)
    .sort((a, b) => a.observedAt - b.observedAt);
  const candidates = [];

  const target = nowMs - config.priceWindowMs;
  const comparable = previous
    .filter((item) => item.observedAt <= target && item.observedAt >= target - config.comparableObservationToleranceMs)
    .at(-1);
  if (comparable) {
    const changePercent = percentChange(current.price, comparable.price);
    for (const direction of ["up", "down"]) {
      const directionalMove = direction === "up" ? changePercent : -changePercent;
      candidates.push({
        signalType: "price_movement",
        direction,
        valid: true,
        active: directionalMove >= config.priceThresholdPercent,
        major: directionalMove >= config.majorPriceThresholdPercent,
        severityMetric: Math.abs(changePercent),
        severity: directionalMove / config.priceThresholdPercent,
        majorReason: "major_price_acceleration",
        details: {
          currentPrice: current.price,
          previousPrice: comparable.price,
          changePercent,
          windowMinutes: config.priceWindowMs / 60_000,
          comparisonObservedAt: new Date(comparable.observedAt).toISOString(),
        },
      });
    }
  }

  const volumeHistory = previous
    .filter((item) => item.observedAt >= nowMs - config.volumeBaselineWindowMs && Number.isFinite(item.volume) && item.volume > 0)
    .slice(-Math.max(config.volumeBaselineSamples, 12));
  const baselineVolume = volumeHistory.length >= config.volumeBaselineSamples
    ? median(volumeHistory.map((item) => item.volume))
    : null;
  const volumeMultiple = Number.isFinite(current.volume) && current.volume > 0 && baselineVolume > 0
    ? current.volume / baselineVolume
    : null;
  if (volumeMultiple !== null) {
    candidates.push({
      signalType: "unusual_volume",
      direction: "up",
      valid: true,
      active: volumeMultiple >= config.volumeMultiplier,
      major: volumeMultiple >= config.majorVolumeMultiplier,
      severityMetric: volumeMultiple,
      severity: volumeMultiple / config.volumeMultiplier,
      majorReason: "major_volume_acceleration",
      details: {
        currentPrice: current.price,
        currentVolume: current.volume,
        baselineVolume,
        volumeMultiple,
        volumeChangePercent: percentChange(current.volume, baselineVolume),
        baselineSamples: volumeHistory.length,
      },
    });
  }

  const range = previous.filter((item) => item.observedAt >= nowMs - config.breakoutLookbackMs);
  if (range.length >= config.breakoutMinimumSamples) {
    const priorHigh = Math.max(...range.map((item) => item.price));
    const priorLow = Math.min(...range.map((item) => item.price));
    const changes = { up: percentChange(current.price, priorHigh), down: percentChange(current.price, priorLow) };
    for (const direction of ["up", "down"]) {
      const rangeMovePercent = changes[direction];
      const directionalMove = direction === "up" ? rangeMovePercent : -rangeMovePercent;
      const volumeAvailable = volumeMultiple !== null;
      const volumeConfirmed = volumeAvailable ? volumeMultiple >= config.majorBreakoutVolumeMultiplier : null;
      candidates.push({
        signalType: "breakout",
        direction,
        valid: true,
        active: directionalMove >= config.breakoutBufferPercent,
        major: directionalMove >= config.majorBreakoutPercent && (volumeConfirmed !== false),
        severityMetric: Math.abs(rangeMovePercent),
        severity: directionalMove / config.breakoutBufferPercent,
        majorReason: volumeConfirmed === true ? "confirmed_major_breakout" : "material_major_breakout",
        details: {
          currentPrice: current.price,
          priorHigh,
          priorLow,
          rangeMovePercent,
          lookbackMinutes: config.breakoutLookbackMs / 60_000,
          volumeMultiple,
          volumeConfirmation: volumeConfirmed === null ? "unavailable" : volumeConfirmed ? "confirmed" : "not_confirmed",
        },
      });
    }
  }
  return candidates;
}

function signalStateDecision(candidate, state = {}, observedAt, config = DEFAULT_MARKET_FEED_CONFIG) {
  if (!candidate?.valid) {
    return {
      normalTrigger: false,
      majorTrigger: false,
      nextNormalActive: Boolean(state.condition_active),
      nextMajorActive: Boolean(state.major_condition_active),
      overrideReason: null,
    };
  }
  const observedTime = new Date(observedAt).getTime();
  const lastNormal = state.last_triggered_at ? new Date(state.last_triggered_at).getTime() : 0;
  const lastMajor = state.last_major_triggered_at ? new Date(state.last_major_triggered_at).getTime() : 0;
  const normalCooldownOpen = !lastNormal || observedTime - lastNormal >= config.normalCooldownMs;
  const emergencyCooldownOpen = !lastMajor || observedTime - lastMajor >= config.emergencyCooldownMs;
  let normalTrigger = candidate.active && !state.condition_active && normalCooldownOpen;
  const majorTrigger = candidate.major && !state.major_condition_active && emergencyCooldownOpen;
  if (majorTrigger) normalTrigger = false;
  const normalWasBlocking = candidate.major && (state.condition_active || !normalCooldownOpen);
  return {
    normalTrigger,
    majorTrigger,
    nextNormalActive: candidate.active,
    // A reset major event inside the emergency cooldown stays pending and may fire when that cooldown opens.
    nextMajorActive: candidate.major && (Boolean(state.major_condition_active) || majorTrigger),
    overrideReason: majorTrigger
      ? { code: normalWasBlocking ? "normal_to_major_escalation" : candidate.majorReason, priorClass: normalWasBlocking ? "normal" : "none" }
      : null,
  };
}

function signalMessage(signal) {
  const symbol = signal.coin.symbol;
  const prefix = signal.severityClass === "major" ? "MAJOR: " : "";
  if (signal.signalType === "price_movement") {
    return `${prefix}${symbol} price moved ${signal.direction} ${Math.abs(signal.details.changePercent).toFixed(2)}% in ${signal.details.windowMinutes} minutes.`;
  }
  if (signal.signalType === "unusual_volume") {
    return `${prefix}${symbol} trading volume reached ${signal.details.volumeMultiple.toFixed(2)}× its recent baseline.`;
  }
  return `${prefix}${symbol} made a ${signal.direction === "up" ? "bullish" : "bearish"} breakout from its recent range.`;
}

async function hasEnabledAutomaticMarketFeed(database = pool) {
  const result = await database.query(
    `SELECT EXISTS(
       SELECT 1 FROM user_preferences p JOIN telegram_links l ON l.user_id = p.user_id
       WHERE COALESCE((p.notification_preferences->>'telegram_alerts')::boolean, FALSE) = TRUE
         AND (COALESCE((p.notification_preferences->>'market_price_movements')::boolean, FALSE) = TRUE
           OR COALESCE((p.notification_preferences->>'market_unusual_volume')::boolean, FALSE) = TRUE
           OR COALESCE((p.notification_preferences->>'market_breakouts')::boolean, FALSE) = TRUE)
     ) AS found`,
  );
  return result.rows[0].found;
}

function createAutomaticMarketScanner({ database = pool, config = marketFeedConfig(), now = () => Date.now(), onError = () => console.error("Automatic market-feed scan failed.") } = {}) {
  let running = false;
  return async function scanAutomaticMarketFeed(snapshot) {
    if (running) return { status: "skipped_overlap", observed: 0, detected: 0, major: 0, queued: 0 };
    const markets = Array.isArray(snapshot) ? snapshot : snapshot?.markets;
    const observedAt = Array.isArray(snapshot) ? now() : snapshot?.observedAt;
    if (!isMarketSnapshotFresh(observedAt, now())) return { status: "skipped_stale", observed: 0, detected: 0, major: 0, queued: 0 };
    const coins = selectEligibleMarkets(markets);
    if (!coins.length) return { status: "skipped_empty", observed: 0, detected: 0, major: 0, queued: 0 };

    running = true;
    let client;
    try {
      client = await database.connect();
      await client.query("BEGIN");
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('cointrack.market_feed_scan')) AS acquired");
      if (lock.rows[0]?.acquired !== true) {
        await client.query("ROLLBACK");
        return { status: "skipped_concurrent", observed: 0, detected: 0, major: 0, queued: 0 };
      }
      const observedDate = new Date(observedAt);
      const inserted = await client.query(
        `INSERT INTO market_signal_observations
           (coin_id, observed_at, coin_name, symbol, market_cap_rank, current_price, total_volume, market_cap, source)
         SELECT id, $2, name, symbol, rank, price, volume, market_cap, 'coingecko'
         FROM jsonb_to_recordset($1::jsonb) AS x(
           id varchar(100), name varchar(120), symbol varchar(30), rank integer,
           price numeric, volume numeric, market_cap numeric)
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(coins.map((coin) => ({ ...coin, market_cap: coin.marketCap }))), observedDate],
      );
      if (!inserted.rowCount) {
        await client.query("ROLLBACK");
        return { status: "skipped_duplicate", observed: 0, detected: 0, major: 0, queued: 0 };
      }
      const oldestNeeded = new Date(observedDate.getTime() - Math.max(config.volumeBaselineWindowMs, config.breakoutLookbackMs, config.priceWindowMs + config.comparableObservationToleranceMs));
      const historyResult = await client.query(
        `SELECT coin_id, observed_at, current_price, total_volume
         FROM market_signal_observations WHERE observed_at >= $1 AND observed_at <= $2
         ORDER BY coin_id, observed_at`,
        [oldestNeeded, observedDate],
      );
      const historyByCoin = new Map();
      for (const row of historyResult.rows) {
        if (!historyByCoin.has(row.coin_id)) historyByCoin.set(row.coin_id, []);
        historyByCoin.get(row.coin_id).push(row);
      }
      const candidates = coins.flatMap((coin) => evaluateCoinSignals(coin, historyByCoin.get(coin.id) || [], observedDate, config).map((signal) => ({ ...signal, coin })));
      const statesResult = await client.query(
        `SELECT coin_id, signal_type, direction, condition_active, last_triggered_at,
                major_condition_active, last_major_triggered_at, last_normal_metric, last_major_metric
         FROM market_signal_states WHERE coin_id = ANY($1::varchar[])`,
        [coins.map((coin) => coin.id)],
      );
      const states = new Map(statesResult.rows.map((state) => [`${state.coin_id}:${state.signal_type}:${state.direction}`, state]));
      const decisions = candidates.map((candidate) => {
        const state = states.get(`${candidate.coin.id}:${candidate.signalType}:${candidate.direction}`) || {};
        return { candidate, state, decision: signalStateDecision(candidate, state, observedDate, config) };
      });
      const triggerable = decisions.flatMap(({ candidate, decision }) => {
        if (decision.majorTrigger) return [{ ...candidate, severityClass: "major", overrideReason: decision.overrideReason }];
        if (decision.normalTrigger) return [{ ...candidate, severityClass: "normal", overrideReason: null }];
        return [];
      }).sort((a, b) => (b.severityClass === "major") - (a.severityClass === "major") || b.severity - a.severity || a.coin.rank - b.coin.rank)
        .slice(0, config.maxSignalsPerScan);
      const selected = new Map(triggerable.map((signal) => [`${signal.coin.id}:${signal.signalType}:${signal.direction}`, signal.severityClass]));

      const stateRows = decisions.filter(({ candidate }) => candidate.valid).map(({ candidate, state, decision }) => {
        const key = `${candidate.coin.id}:${candidate.signalType}:${candidate.direction}`;
        const selectedClass = selected.get(key);
        const unselectedNormal = decision.normalTrigger && selectedClass !== "normal";
        const unselectedMajor = decision.majorTrigger && selectedClass !== "major";
        return {
          coin_id: candidate.coin.id,
          signal_type: candidate.signalType,
          direction: candidate.direction,
          condition_active: unselectedNormal ? false : decision.nextNormalActive,
          major_condition_active: unselectedMajor ? false : decision.nextMajorActive,
          last_triggered_at: selectedClass === "normal" ? observedDate.toISOString() : state.last_triggered_at || null,
          last_major_triggered_at: selectedClass === "major" ? observedDate.toISOString() : state.last_major_triggered_at || null,
          last_normal_metric: candidate.active ? candidate.severityMetric : state.last_normal_metric || null,
          last_major_metric: candidate.major ? candidate.severityMetric : state.last_major_metric || null,
        };
      });
      if (stateRows.length) {
        await client.query(
          `INSERT INTO market_signal_states
             (coin_id, signal_type, direction, condition_active, major_condition_active,
              last_triggered_at, last_major_triggered_at, last_normal_metric, last_major_metric, last_observed_at)
           SELECT coin_id, signal_type, direction, condition_active, major_condition_active,
             last_triggered_at, last_major_triggered_at, last_normal_metric, last_major_metric, $2
           FROM jsonb_to_recordset($1::jsonb) AS x(
             coin_id varchar(100), signal_type varchar(30), direction varchar(10),
             condition_active boolean, major_condition_active boolean, last_triggered_at timestamptz,
             last_major_triggered_at timestamptz, last_normal_metric numeric, last_major_metric numeric)
           ON CONFLICT (coin_id, signal_type, direction) DO UPDATE SET
             condition_active = EXCLUDED.condition_active,
             major_condition_active = EXCLUDED.major_condition_active,
             last_triggered_at = EXCLUDED.last_triggered_at,
             last_major_triggered_at = EXCLUDED.last_major_triggered_at,
             last_normal_metric = EXCLUDED.last_normal_metric,
             last_major_metric = EXCLUDED.last_major_metric,
             last_observed_at = EXCLUDED.last_observed_at,
             updated_at = CURRENT_TIMESTAMP`,
          [JSON.stringify(stateRows), observedDate],
        );
      }

      let queued = 0;
      for (const signal of triggerable) {
        const expiresAt = new Date(observedDate.getTime() + config.eventTtlMs);
        const preferenceKey = SIGNAL_PREFERENCES[signal.signalType];
        const payload = {
          source: "automatic_market_feed",
          preferenceKey,
          severityClass: signal.severityClass,
          overrideReason: signal.overrideReason,
          coinId: signal.coin.id,
          coinName: signal.coin.name,
          coinSymbol: signal.coin.symbol,
          alertType: signal.signalType,
          direction: signal.direction,
          observedValue: signal.coin.price,
          observedAt: observedDate.toISOString(),
          expiresAt: expiresAt.toISOString(),
          provider: "CoinGecko",
          ...signal.details,
          delivery: { inApp: "recorded", email: "not_requested", telegram: "queued" },
        };
        const event = await client.query(
          `INSERT INTO market_signal_events
             (coin_id, signal_type, direction, observed_at, expires_at, severity_class, override_reason, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           ON CONFLICT (coin_id, signal_type, direction, observed_at) DO NOTHING RETURNING id`,
          [signal.coin.id, signal.signalType, signal.direction, observedDate, expiresAt, signal.severityClass, signal.overrideReason?.code || null, JSON.stringify(payload)],
        );
        if (!event.rowCount) continue;
        const recipients = await client.query(
          `SELECT p.user_id, l.id AS telegram_link_id FROM user_preferences p
           JOIN telegram_links l ON l.user_id = p.user_id
           WHERE COALESCE((p.notification_preferences->>'telegram_alerts')::boolean, FALSE) = TRUE
             AND COALESCE((p.notification_preferences->>$1)::boolean, FALSE) = TRUE`,
          [preferenceKey],
        );
        for (const recipient of recipients.rows) {
          const notification = await client.query(
            `INSERT INTO notifications (user_id, notification_type, message, payload, market_signal_event_id)
             VALUES ($1, 'market_signal', $2, $3::jsonb, $4)
             ON CONFLICT (user_id, market_signal_event_id) DO NOTHING RETURNING id`,
            [recipient.user_id, signalMessage(signal), JSON.stringify(payload), event.rows[0].id],
          );
          if (!notification.rowCount) continue;
          await client.query(
            `INSERT INTO telegram_deliveries (notification_id, user_id, telegram_link_id)
             VALUES ($1, $2, $3) ON CONFLICT (notification_id) DO NOTHING`,
            [notification.rows[0].id, recipient.user_id, recipient.telegram_link_id],
          );
          queued += 1;
        }
      }
      await client.query("DELETE FROM market_signal_observations WHERE observed_at < $1", [new Date(observedDate.getTime() - config.observationRetentionMs)]);
      await client.query("COMMIT");
      return {
        status: "completed",
        observed: inserted.rowCount,
        detected: triggerable.length,
        major: triggerable.filter((signal) => signal.severityClass === "major").length,
        queued,
      };
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      onError(error);
      return { status: "error", observed: 0, detected: 0, major: 0, queued: 0 };
    } finally {
      client?.release();
      running = false;
    }
  };
}

module.exports = {
  DEFAULT_MARKET_FEED_CONFIG,
  SIGNAL_PREFERENCES,
  createAutomaticMarketScanner,
  evaluateCoinSignals,
  hasEnabledAutomaticMarketFeed,
  marketFeedConfig,
  median,
  percentChange,
  selectEligibleMarkets,
  signalStateDecision,
  signalMessage,
};
