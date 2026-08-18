// TEMPORARY — for manually testing whether the highlights permission works
// against /v1/highlights. Returns the signed-in user's own raw YouVersion
// access token so it can be copied into a curl command. Delete this file
// once that test is done; it must never ship.
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

  try {
    const raw = await store().get(keyFor(user.sub));
    if (!raw) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connected: false }) };
    }
    const tokens = JSON.parse(raw);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connected: true,
        access_token: tokens.access_token,
        expires_at: tokens.expires_at,
      }),
    };
  } catch (err) {
    return { statusCode: 502, body: String(err.message || err) };
  }
};
