// List (and, via DELETE, remove) accounts for the app-manager dashboard's unified user view.
// Same ADMIN_SYNC_SECRET contract as admin-stats.js. This app has no admin allowlist beyond the
// single OWNER_GOOGLE_EMAIL env var, so these actions are gated on the shared secret alone.

const { connectLambda } = require("@netlify/blobs");
const { listSignups, deleteAccount } = require("./_users");

// Netlify routes /api/admin/users/:id here via a splat redirect (see netlify.toml), landing the
// id (Google sub) in the ?id= query param rather than event.path.
function idFromEvent(event) {
  return event.queryStringParameters && event.queryStringParameters.id;
}

exports.handler = async (event) => {
  connectLambda(event);

  const secret = process.env.ADMIN_SYNC_SECRET;
  const header = event.headers["x-admin-secret"] || event.headers["X-Admin-Secret"];
  if (!secret || header !== secret) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (event.httpMethod === "GET") {
    const signups = await listSignups();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ users: signups }),
    };
  }

  if (event.httpMethod === "DELETE") {
    const id = idFromEvent(event);
    if (!id) {
      return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing user id" }) };
    }
    await deleteAccount(id);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
