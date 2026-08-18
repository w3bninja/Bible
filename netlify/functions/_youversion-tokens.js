// Shared storage + refresh logic for a user's YouVersion tokens. Access
// tokens are short-lived (~1hr per the JWT `exp` claim) — anything that
// needs to call the YouVersion API on a user's behalf should go through
// getValidAccessToken() rather than reading the stored access_token
// directly, so it transparently refreshes when needed.
const { getStore } = require("@netlify/blobs");

const YOUVERSION_APP_KEY = "Z8ou4eKH1jLzXHa8QOvlNnCgLQmXRtY2tyIfBg31o8omy0IO";
const TOKEN_ENDPOINT = "https://api.youversion.com/auth/token";

function store() {
  return getStore("bible-study");
}

function keyFor(sub) {
  return `youversion-tokens-${sub}.json`;
}

async function readTokens(sub) {
  const raw = await store().get(keyFor(sub));
  return raw ? JSON.parse(raw) : null;
}

// Refresh a little before actual expiry so a request that's mid-flight
// doesn't get a token that expires before it lands.
const EXPIRY_BUFFER_MS = 60 * 1000;

// Returns a valid access token for this user (refreshing first if it's
// expired or about to be), or null if they aren't connected, have no
// refresh token on file, or the refresh itself fails (e.g. it was revoked).
async function getValidAccessToken(sub) {
  const tokens = await readTokens(sub);
  if (!tokens) return null;

  if (tokens.expires_at - Date.now() > EXPIRY_BUFFER_MS) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) return null;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: YOUVERSION_APP_KEY,
    }),
  });
  if (!res.ok) return null;

  const json = await res.json();
  const refreshed = {
    access_token: json.access_token,
    // Not every provider rotates the refresh token on use — keep the old
    // one unless a new one actually comes back.
    refresh_token: json.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (json.expires_in || 3599) * 1000,
    connected_at: tokens.connected_at,
  };
  await store().set(keyFor(sub), JSON.stringify(refreshed));
  return refreshed.access_token;
}

module.exports = { store, keyFor, readTokens, getValidAccessToken };
