// Signs/verifies a compact session token proving who's logged in (via
// Google OAuth) and their role. Stateless — no server-side session store,
// just an HMAC-signed payload, the same trust model as everything else in
// this app (a shared secret checked server-side; see _auth.js). Sent as a
// header from localStorage, not a cookie, consistent with how the site
// password is already handled.

const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not configured");
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

// Returns the verified payload, or null if the token is missing, malformed,
// incorrectly signed, or expired.
function verify(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expectedSig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// Pulls the session user off a Netlify Function event, or null if there
// isn't a valid one. Endpoints that need per-user identity (tags, Studies
// writes, YouVersion connect) call this in addition to isAuthorized().
function getSessionUser(event) {
  const token = event.headers["x-session-token"] || event.headers["X-Session-Token"];
  return verify(token);
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function issueSession({ sub, email, name, picture, role }) {
  return sign({ sub, email, name, picture, role, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });
}

module.exports = { getSessionUser, issueSession };
