// Google OAuth redirect target. Registered directly as the redirect_uri
// (no client-side relay page needed, unlike YouVersion's PKCE public-client
// flow — this is a confidential client, so the whole exchange happens here
// server-side using GOOGLE_CLIENT_SECRET) — Google redirects the browser
// straight here with ?code=..., we exchange it, mint a session, and bounce
// back to the app with the session token in the URL.

const { connectLambda } = require("@netlify/blobs");
const { issueSession } = require("./_session");
const { recordSignupIfNew } = require("./_users");

// Public value, not a secret — same one hardcoded in app.js for the
// authorize-redirect step. Both sides of the exchange need it; only
// GOOGLE_CLIENT_SECRET is actually sensitive and lives in an env var.
const GOOGLE_CLIENT_ID = "207642071914-gaplnloqc7bi2be69ocbc45b9vee56f5.apps.googleusercontent.com";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

function decodeIdTokenClaims(idToken) {
  // The ID token was retrieved directly from Google's token endpoint over a
  // server-to-server HTTPS request (not supplied by the client), so the
  // transport itself is the trust boundary — decoding without re-verifying
  // the RS256 signature is standard practice for this flow (see e.g. how
  // most OAuth client libraries handle the auth-code flow's ID token).
  const payloadB64 = idToken.split(".")[1];
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
}

function redirectWithError(reason, detail) {
  const q = new URLSearchParams({ googleConnect: "error", reason });
  if (detail) q.set("detail", detail.slice(0, 300));
  return {
    statusCode: 302,
    headers: { Location: `/?${q.toString()}` },
  };
}

exports.handler = async (event) => {
  connectLambda(event);

  const code = event.queryStringParameters && event.queryStringParameters.code;
  const error = event.queryStringParameters && event.queryStringParameters.error;
  if (error) return redirectWithError(error);
  if (!code) return redirectWithError("missing_code");

  const redirectUri = `https://${event.headers.host}/api/google/callback`;

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
      }),
    });

    const text = await res.text();
    if (!res.ok) return redirectWithError("token_exchange_failed", text);

    const json = JSON.parse(text);
    const claims = decodeIdTokenClaims(json.id_token);

    const ownerEmail = (process.env.OWNER_GOOGLE_EMAIL || "").toLowerCase();
    const role = claims.email && claims.email.toLowerCase() === ownerEmail ? "owner" : "user";

    await recordSignupIfNew(claims.sub, claims.email);

    const sessionToken = issueSession({
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      role,
    });

    return {
      statusCode: 302,
      headers: { Location: `/?sessionToken=${encodeURIComponent(sessionToken)}` },
    };
  } catch (err) {
    return redirectWithError("fetch_error");
  }
};
