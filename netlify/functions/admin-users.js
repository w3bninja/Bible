// View-only list for the app-manager dashboard's unified user view. Same ADMIN_SYNC_SECRET
// contract as admin-stats.js. No per-user action exists here — this app has no admin allowlist
// beyond the single OWNER_GOOGLE_EMAIL env var, and no per-user mutable state to toggle.

const { connectLambda } = require("@netlify/blobs");
const { listSignups } = require("./_users");

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const secret = process.env.ADMIN_SYNC_SECRET;
  const header = event.headers["x-admin-secret"] || event.headers["X-Admin-Secret"];
  if (!secret || header !== secret) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const signups = await listSignups();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ users: signups }),
  };
};
