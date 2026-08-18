const { connectLambda } = require("@netlify/blobs");
const { getSessionUser } = require("./_session");
const { store, keyFor } = require("./_youversion-tokens");

// Public OAuth client_id — not a secret, safe to live in source. This is a
// PKCE (public client) flow, so no client secret exists anywhere.
const YOUVERSION_APP_KEY = "Z8ou4eKH1jLzXHa8QOvlNnCgLQmXRtY2tyIfBg31o8omy0IO";
const TOKEN_ENDPOINT = "https://api.youversion.com/auth/token";

exports.handler = async (event) => {
  connectLambda(event);
  const user = getSessionUser(event);
  if (!user) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "no_session" }) };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { code, code_verifier, redirect_uri } = body;
  if (!code || !code_verifier || !redirect_uri) {
    return { statusCode: 400, body: "Missing code, code_verifier, or redirect_uri" };
  }

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id: YOUVERSION_APP_KEY,
        code_verifier,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "token_exchange_failed", detail: text }) };
    }

    const json = JSON.parse(text);
    const expiresAt = Date.now() + (json.expires_in || 3599) * 1000;

    await store().set(
      keyFor(user.sub),
      JSON.stringify({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: expiresAt,
        connected_at: Date.now(),
      })
    );

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 502, body: String(err.message || err) };
  }
};
