// TEMPORARY: inspects the real Moments API response shape (endpoint path,
// pagination, reference format) so the real import function can be built
// against verified data instead of guessed documentation. Remove once the
// real import function is built and confirmed working.

const { getStore, connectLambda } = require("@netlify/blobs");

const YOUVERSION_APP_KEY = "Z8ou4eKH1jLzXHa8QOvlNnCgLQmXRtY2tyIfBg31o8omy0IO";
const TOKEN_ENDPOINT = "https://api.youversion.com/auth/token";
const TOKENS_KEY = "youversion-tokens.json";

function store() {
  return getStore("bible-study");
}

async function refreshTokens(tokens) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: YOUVERSION_APP_KEY,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`refresh failed: ${text}`);
  const json = JSON.parse(text);
  const updated = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (json.expires_in || 3599) * 1000,
    connected_at: tokens.connected_at,
  };
  await store().set(TOKENS_KEY, JSON.stringify(updated));
  return updated;
}

exports.handler = async (event) => {
  connectLambda(event);

  const raw = await store().get(TOKENS_KEY);
  if (!raw) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "not_connected" }) };
  }

  let tokens = JSON.parse(raw);
  if (Date.now() > tokens.expires_at - 30000) {
    try {
      tokens = await refreshTokens(tokens);
    } catch (err) {
      return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "refresh_failed", detail: String(err.message || err) }) };
    }
  }

  // Try a couple of plausible endpoint paths since the exact REST path for
  // listing moments isn't documented in detail anywhere accessible — report
  // back whichever responds, and the raw body/status of each attempt.
  const candidates = ["https://api.youversion.com/v1/moments", "https://api.youversion.com/moments"];
  const attempts = [];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const text = await res.text();
      attempts.push({ url, status: res.status, body: text.slice(0, 4000) });
      if (res.ok) break;
    } catch (err) {
      attempts.push({ url, error: String(err.message || err) });
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attempts }, null, 2),
  };
};
