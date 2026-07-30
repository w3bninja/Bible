// Shared auth check for all Netlify Functions in this app. This is a
// single-user personal app with no account system — a shared passphrase,
// checked server-side, is what actually prevents an anonymous visitor from
// reading or writing data via the API directly (a client-side-only check
// would be trivially bypassed by calling the endpoints directly).
//
// Fails closed: if SITE_PASSWORD isn't configured, every request is denied
// rather than silently allowed.

function isAuthorized(event) {
  const provided = event.headers["x-site-password"] || event.headers["X-Site-Password"];
  const expected = process.env.SITE_PASSWORD;
  return !!expected && provided === expected;
}

function unauthorizedResponse() {
  return {
    statusCode: 401,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: "unauthorized" }),
  };
}

module.exports = { isAuthorized, unauthorizedResponse };
