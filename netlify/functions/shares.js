// Authenticated: create, list, and revoke read-only share links. The actual
// public viewing endpoint is share-view.js, which deliberately has NO auth
// check (that's the whole point of a share link) but only ever exposes the
// one tag's verses named by the token, never a full tags blob.

const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");
const { getSessionUser } = require("./_session");

const KEY = "shares.json";

function store() {
  return getStore("bible-study");
}

async function readShares() {
  const raw = await store().get(KEY);
  return raw ? JSON.parse(raw) : {};
}

exports.handler = async (event) => {
  connectLambda(event);
  const user = getSessionUser(event);
  if (!user) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "no_session" }) };
  }

  if (event.httpMethod === "GET") {
    const shares = await readShares();
    // Each account only sees/manages its own share links now that tags are
    // per-user — a share record from before accounts existed (no ownerId)
    // is treated as belonging to nobody and won't show up for anyone.
    const own = Object.fromEntries(Object.entries(shares).filter(([, s]) => s.ownerId === user.sub));
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(own) };
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: "Invalid JSON" };
    }
    if (!body.tagId || !body.tagName) {
      return { statusCode: 400, body: "Missing tagId or tagName" };
    }

    const shares = await readShares();
    const token = crypto.randomBytes(16).toString("hex");
    shares[token] = { tagId: body.tagId, tagName: body.tagName, ownerId: user.sub, createdAt: Date.now() };
    await store().set(KEY, JSON.stringify(shares));

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) };
  }

  if (event.httpMethod === "DELETE") {
    const token = event.queryStringParameters && event.queryStringParameters.t;
    if (!token) return { statusCode: 400, body: "Missing token" };

    const shares = await readShares();
    if (shares[token] && shares[token].ownerId !== user.sub) {
      return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "not_your_share" }) };
    }
    delete shares[token];
    await store().set(KEY, JSON.stringify(shares));

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
