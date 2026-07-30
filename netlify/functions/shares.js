// Authenticated: create, list, and revoke read-only share links. The actual
// public viewing endpoint is share-view.js, which deliberately has NO auth
// check (that's the whole point of a share link) but only ever exposes the
// one tag's verses named by the token, never the full tags.json blob.

const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");
const { isAuthorized, unauthorizedResponse } = require("./_auth");

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
  if (!isAuthorized(event)) return unauthorizedResponse();

  if (event.httpMethod === "GET") {
    const shares = await readShares();
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(shares) };
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
    shares[token] = { tagId: body.tagId, tagName: body.tagName, createdAt: Date.now() };
    await store().set(KEY, JSON.stringify(shares));

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) };
  }

  if (event.httpMethod === "DELETE") {
    const token = event.queryStringParameters && event.queryStringParameters.t;
    if (!token) return { statusCode: 400, body: "Missing token" };

    const shares = await readShares();
    delete shares[token];
    await store().set(KEY, JSON.stringify(shares));

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
