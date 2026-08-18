// Proxies GET /v1/highlights on the user's behalf — keeps their YouVersion
// access token server-side, same as every other YouVersion call this app
// makes. The upstream API only supports single-chapter passage_id values
// (e.g. "ROM.12", not "ROM.12.3" or a verse range) — see
// developers.youversion.com/api/highlights.
const { connectLambda } = require("@netlify/blobs");
const { getSessionUser } = require("./_session");
const { getValidAccessToken } = require("./_youversion-tokens");

const YOUVERSION_APP_KEY = "Z8ou4eKH1jLzXHa8QOvlNnCgLQmXRtY2tyIfBg31o8omy0IO";
const HIGHLIGHTS_ENDPOINT = "https://api.youversion.com/v1/highlights";

exports.handler = async (event) => {
  connectLambda(event);
  const user = getSessionUser(event);
  if (!user) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "no_session" }) };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { bible_id, passage_id } = event.queryStringParameters || {};
  if (!bible_id || !passage_id) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "missing_params", detail: "bible_id and passage_id (single chapter, e.g. ROM.12) are required" }),
    };
  }

  const accessToken = await getValidAccessToken(user.sub);
  if (!accessToken) {
    return { statusCode: 409, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "not_connected" }) };
  }

  try {
    const url = `${HIGHLIGHTS_ENDPOINT}?${new URLSearchParams({ bible_id, passage_id })}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-yvp-app-key": YOUVERSION_APP_KEY,
      },
    });

    // The upstream API returns 204 (no body) when the chapter has no
    // highlights — normalize that to an empty array so callers don't have
    // to special-case it.
    if (res.status === 204) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: [] }) };
    }

    const text = await res.text();
    if (!res.ok) {
      return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "highlights_fetch_failed", detail: text }) };
    }

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: text };
  } catch (err) {
    return { statusCode: 502, body: String(err.message || err) };
  }
};
