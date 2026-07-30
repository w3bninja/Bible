const { getStore, connectLambda } = require("@netlify/blobs");
const { isAuthorized, unauthorizedResponse } = require("./_auth");

const TOKENS_KEY = "youversion-tokens.json";

function store() {
  return getStore("bible-study");
}

exports.handler = async (event) => {
  connectLambda(event);
  if (!isAuthorized(event)) return unauthorizedResponse();

  if (event.httpMethod === "GET") {
    try {
      const raw = await store().get(TOKENS_KEY);
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
      await store().delete(TOKENS_KEY);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 502, body: String(err.message || err) };
    }
  }

  return { statusCode: 405, body: "Method not allowed" };
};
