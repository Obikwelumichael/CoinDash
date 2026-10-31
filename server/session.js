const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const { pool } = require("./db/pool");
const { isSessionIdRevoked } = require("./session-revocation");

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set before starting CoinDash.");
}

const PgStore = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production";
const sessionStore = new PgStore({ pool, tableName: "session", createTableIfMissing: false });
const saveSession = sessionStore.set.bind(sessionStore);

sessionStore.set = (sessionId, value, callback) => {
  if (isSessionIdRevoked(sessionId)) return callback?.();
  return saveSession(sessionId, value, callback);
};

if (typeof sessionStore.touch === "function") {
  const touchSession = sessionStore.touch.bind(sessionStore);
  sessionStore.touch = (sessionId, value, callback) => {
    if (isSessionIdRevoked(sessionId)) return callback?.();
    return touchSession(sessionId, value, callback);
  };
}

const sessionMiddleware = session({
  store: sessionStore,
  name: "cryptodash.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
});

module.exports = { sessionMiddleware };
