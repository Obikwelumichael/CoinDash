export const CONSENT_STORAGE_KEY = "cryptodash.privacy-consent";
export const CONSENT_VERSION = 1;

const validDecisions = new Set(["accepted_all", "rejected_optional", "custom"]);

export function readConsent(storage) {
  if (!storage) return null;
  try {
    const record = JSON.parse(storage.getItem(CONSENT_STORAGE_KEY));
    if (!record || record.version !== CONSENT_VERSION || !validDecisions.has(record.decision)
        || typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))
        || record.categories?.necessary !== true
        || record.categories?.preferences !== false
        || record.categories?.analytics !== false
        || record.categories?.marketing !== false) return null;
    return record;
  } catch {
    return null;
  }
}

export function writeConsent(decision, storage, now = new Date()) {
  if (!validDecisions.has(decision)) throw new TypeError("Invalid privacy preference decision.");
  if (!storage) throw new Error("Browser storage is unavailable.");
  const record = {
    version: CONSENT_VERSION,
    decision,
    categories: { necessary: true, preferences: false, analytics: false, marketing: false },
    updatedAt: now.toISOString(),
  };
  storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  return record;
}
