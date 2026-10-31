const { findSafeUserById } = require("../auth/users");
const { isSessionIdRevoked } = require("../session-revocation");

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function preventAuthenticatedResponseCaching(res) {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  res.vary("Cookie");
}

function clearSessionCookie(res) {
  res.clearCookie("cryptodash.sid", SESSION_COOKIE_OPTIONS);
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    return req.session.destroy((error) => error ? reject(error) : resolve());
  });
}

function createAuthMiddleware({ findUserById = findSafeUserById } = {}) {
  async function authenticatedUser(req) {
    if (!req.session?.userId || isSessionIdRevoked(req.sessionID)) return null;
    return findUserById(req.session.userId);
  }

  async function rejectStaleSession(req, res) {
    if (req.session?.userId) await destroySession(req);
    clearSessionCookie(res);
  }

  async function requireAuth(req, res, next) {
    preventAuthenticatedResponseCaching(res);
    try {
      const user = await authenticatedUser(req);
      if (!user) {
        await rejectStaleSession(req, res);
        return res.status(401).json({ error: "Authentication is required." });
      }
      req.user = user;
      return next();
    } catch (error) { return next(error); }
  }

  async function requirePageAuth(req, res, next) {
    preventAuthenticatedResponseCaching(res);
    try {
      const user = await authenticatedUser(req);
      if (!user) {
        await rejectStaleSession(req, res);
        return res.redirect(303, "/login");
      }
      req.user = user;
      return next();
    } catch (error) { return next(error); }
  }

  return { requireAuth, requirePageAuth };
}

const { requireAuth, requirePageAuth } = createAuthMiddleware();

module.exports = {
  clearSessionCookie,
  createAuthMiddleware,
  destroySession,
  preventAuthenticatedResponseCaching,
  requireAuth,
  requirePageAuth,
};
