// Meant to be polled by the app-manager dashboard, not a signed-in user — authenticates with a
// shared secret header instead of a session token (same ADMIN_SYNC_SECRET contract used by
// draftr/haven/Movies), since this is a server-to-server poll, not an interactive login.

const { connectLambda } = require("@netlify/blobs");
const { listSignups } = require("./_users");

function dayKey(iso) {
  return iso.slice(0, 10);
}

function countsByDay(dates) {
  const counts = new Map();
  for (const iso of dates) {
    const key = dayKey(iso);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

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
    body: JSON.stringify({
      signups: countsByDay(signups.map((s) => s.createdAt)),
      // No account-deletion flow exists in this app yet — always empty until one is built.
      deletions: [],
      activeUsers: signups.length,
    }),
  };
};
