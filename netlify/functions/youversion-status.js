const { getStore, connectLambda } = require("@netlify/blobs");
const { getSessionUser } = require("./_session");

function store() {
  return getStore("bible-study");
}

function keyFor(sub) {
  return `youversion-tokens-${sub}.json`;
}

exports.handler = async (event) => {
  connectLambda(event);
  const user = getSessionUser(event);
  if (!user) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "no_session" }) };
  }
  const key = keyFor(user.sub);

  if (event.httpMethod === "GET") {
    try {
      const raw = await store().get(key);
      if (!raw) {
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connected: false }) };
      }
      const tokens = JSON.parse(raw);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connected: true, connectedAt: tokens.connected_at || null }),
      };
    } catch (err) {
      return { statusCode: 502, body: String(err.message || err) };
    }
  }

  if (event.httpMethod === "DELETE") {
    try {
      await store().delete(key);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 502, body: String(err.message || err) };
    }
  }

  return { statusCode: 405, body: "Method not allowed" };
};
