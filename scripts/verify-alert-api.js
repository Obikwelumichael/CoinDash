require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { pool } = require("../server/db/pool");

const baseUrl = process.env.VERIFY_BASE_URL || "http://127.0.0.1:3199";

async function request(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

async function main() {
  const marker = randomUUID();
  const emails = [
    `phase41-api-a-${marker}@example.test`,
    `phase41-api-b-${marker}@example.test`,
  ];
  const cookies = [];
  try {
    for (let index = 0; index < emails.length; index += 1) {
      const created = await request("/api/auth/register", {
        method: "POST",
        body: {
          email: emails[index],
          password: `Phase41-safe-password-${index}!`,
          displayName: `Runtime User ${index + 1}`,
        },
      });
      if (created.response.status !== 201) throw new Error(`Registration failed with ${created.response.status}.`);
      cookies.push(created.response.headers.get("set-cookie").split(";")[0]);
    }

    const unauthorized = await request("/api/alerts");
    const invalid = await request("/api/alerts", {
      cookie: cookies[0],
      method: "POST",
      body: { coinId: "../bitcoin", alertType: "price", direction: "above", threshold: 100 },
    });
    const created = await request("/api/alerts", {
      cookie: cookies[0],
      method: "POST",
      body: { coinId: "bitcoin", alertType: "price", direction: "above", threshold: 100 },
    });
    const alertId = created.payload?.alert?.id;
    if (!alertId) throw new Error("Alert creation did not return an ID.");

    const ownerList = await request("/api/alerts", { cookie: cookies[0] });
    const otherList = await request("/api/alerts", { cookie: cookies[1] });
    const crossUserPatch = await request(`/api/alerts/${alertId}`, {
      cookie: cookies[1],
      method: "PATCH",
      body: { enabled: false },
    });
    const ownerPatch = await request(`/api/alerts/${alertId}`, {
      cookie: cookies[0],
      method: "PATCH",
      body: { threshold: 125, direction: "below" },
    });
    const crossUserDelete = await request(`/api/alerts/${alertId}`, {
      cookie: cookies[1],
      method: "DELETE",
    });
    const ownerDelete = await request(`/api/alerts/${alertId}`, {
      cookie: cookies[0],
      method: "DELETE",
    });

    const result = {
      unauthorized: unauthorized.response.status,
      invalidCreate: invalid.response.status,
      create: created.response.status,
      ownerList: ownerList.response.status,
      ownerCount: ownerList.payload?.alerts?.length,
      otherList: otherList.response.status,
      otherCount: otherList.payload?.alerts?.length,
      crossUserPatch: crossUserPatch.response.status,
      ownerPatch: ownerPatch.response.status,
      patchedThreshold: Number(ownerPatch.payload?.alert?.threshold),
      patchedDirection: ownerPatch.payload?.alert?.direction,
      crossUserDelete: crossUserDelete.response.status,
      ownerDelete: ownerDelete.response.status,
    };
    assertResults(result);
    console.log(JSON.stringify({ status: "passed", ...result }));
  } finally {
    await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]).catch(() => {});
    await pool.end();
  }
}

function assertResults(result) {
  const expected = {
    unauthorized: 401,
    invalidCreate: 400,
    create: 201,
    ownerList: 200,
    ownerCount: 1,
    otherList: 200,
    otherCount: 0,
    crossUserPatch: 404,
    ownerPatch: 200,
    patchedThreshold: 125,
    patchedDirection: "below",
    crossUserDelete: 404,
    ownerDelete: 204,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (result[key] !== value) throw new Error(`Expected ${key}=${value}; received ${result[key]}.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
