const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const consentSource = readFileSync(require("node:path").join(__dirname, "../js/services/privacy-consent.js"), "utf8");
const consentModule = import(`data:text/javascript;base64,${Buffer.from(consentSource).toString("base64")}`);

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem() { return value; },
    setItem(_key, next) { value = next; },
  };
}

test("privacy choice is stored with version, timestamp, and necessary-only categories", async () => {
  const { readConsent, writeConsent, CONSENT_STORAGE_KEY } = await consentModule;
  const storage = memoryStorage();
  const now = new Date("2026-10-13T10:00:00.000Z");
  const saved = writeConsent("rejected_optional", storage, now);

  assert.equal(saved.version, 1);
  assert.equal(saved.decision, "rejected_optional");
  assert.equal(saved.updatedAt, now.toISOString());
  assert.deepEqual(saved.categories, {
    necessary: true,
    preferences: false,
    analytics: false,
    marketing: false,
  });
  assert.deepEqual(readConsent(storage), saved);
  assert.ok(CONSENT_STORAGE_KEY.includes("privacy-consent"));
});

test("malformed, unsupported, and optional-enabled records are ignored", async () => {
  const { readConsent } = await consentModule;
  assert.equal(readConsent(memoryStorage("not-json")), null);
  assert.equal(readConsent(memoryStorage(JSON.stringify({ version: 99 }))), null);
  assert.equal(readConsent(memoryStorage(JSON.stringify({
    version: 1,
    decision: "custom",
    updatedAt: new Date().toISOString(),
    categories: { necessary: true, preferences: false, analytics: true, marketing: false },
  }))), null);
});

test("storage failures do not manufacture a saved consent decision", async () => {
  const { readConsent, writeConsent } = await consentModule;
  assert.equal(readConsent(null), null);
  assert.throws(() => writeConsent("accepted_all", null), /storage is unavailable/);
  assert.throws(() => writeConsent("unknown", memoryStorage()), /Invalid privacy preference/);
});
