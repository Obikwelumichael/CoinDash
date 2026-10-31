const argon2 = require("argon2");

async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 12 && password.length <= 128;
}

module.exports = { hashPassword, validatePassword, verifyPassword };
