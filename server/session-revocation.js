const revokedSessionIds = new Map();

function pruneRevokedSessions(now = Date.now()) {
  for (const [sessionId, expiresAt] of revokedSessionIds) {
    if (expiresAt <= now) revokedSessionIds.delete(sessionId);
  }
}

function revokeSessionId(sessionId, expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000) {
  if (typeof sessionId !== "string" || !sessionId) return;
  pruneRevokedSessions();
  revokedSessionIds.set(sessionId, Number.isFinite(expiresAt) ? expiresAt : Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function isSessionIdRevoked(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) return false;
  const expiresAt = revokedSessionIds.get(sessionId);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    revokedSessionIds.delete(sessionId);
    return false;
  }
  return true;
}

module.exports = { isSessionIdRevoked, revokeSessionId };
