const { createUser, findUserByEmail } = require("./users");
const { hashPassword, validatePassword, verifyPassword } = require("./passwords");

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateRegistration({ email, password, displayName }) {
  const errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  if (typeof displayName !== "string" || displayName.trim().length < 2 || displayName.trim().length > 80) errors.displayName = "Display name must be 2–80 characters.";
  if (!validatePassword(password)) errors.password = "Password must be 12–128 characters.";
  return errors;
}

async function register({ email, password, displayName }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = typeof displayName === "string" ? displayName.trim() : "";
  const errors = validateRegistration({ email: normalizedEmail, password, displayName: normalizedName });
  if (Object.keys(errors).length) return { errors };
  if (await findUserByEmail(normalizedEmail)) return { duplicate: true };

  const passwordHash = await hashPassword(password);
  try {
    return { user: await createUser({ email: normalizedEmail, passwordHash, displayName: normalizedName }) };
  } catch (error) {
    if (error.code === "23505") return { duplicate: true };
    throw error;
  }
}

async function authenticate({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof password !== "string") return null;
  const user = await findUserByEmail(normalizedEmail);
  if (!user || !(await verifyPassword(user.password_hash, password))) return null;
  const { password_hash, ...safeUser } = user;
  safeUser.email_verified = Boolean(safeUser.email_verified_at);
  delete safeUser.email_verified_at;
  return safeUser;
}

module.exports = { authenticate, register };
