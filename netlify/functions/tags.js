const { getStore, connectLambda } = require("@netlify/blobs");
const { getSessionUser } = require("./_session");

const EMPTY = '{"tags":[],"verseTags":{}}';
const LEGACY_KEY = "tags.json"; // the single shared blob from before accounts existed

function store() {
  return getStore("bible-study");
}

// Tags/notes are private per-user — one blob per account, keyed by the
// verified session's sub (never a client-supplied value, so one user can't
// read/write another's data by passing a different id).
function keyFor(sub) {
  return `tags-${sub}.json`;
}

// One-time migration: the owner's tags/notes from before accounts existed
// live under the old shared key. The first time the owner's own per-user
// blob is empty, pull that legacy data forward instead of returning
// nothing — and write it to the new key so this only ever runs once.
async function migrateLegacyDataIfOwner(user) {
  if (user.role !== "owner") return null;
  const legacy = await store().get(LEGACY_KEY);
  if (!legacy) return null;
  await store().set(keyFor(user.sub), legacy);
  return legacy;
}

exports.handler = async (event) => {
  connectLambda(event);
  const user = getSessionUser(event);

  if (event.httpMethod === "GET") {
    // Browsing (Studies/Topics/Insights, reading the Bible) doesn't require
    // being signed in — only having your own tags/notes does. An anonymous
    // request just gets an empty set rather than being turned away, so the
    // app itself never forces a login screen just to look around.
    if (!user) {
      return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: EMPTY };
    }
    try {
      let data = await store().get(keyFor(user.sub));
      if (!data) data = await migrateLegacyDataIfOwner(user);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: data || EMPTY,
      };
    } catch (err) {
      return { statusCode: 502, body: String(err.message || err) };
    }
  }

  if (event.httpMethod === "POST") {
    if (!user) {
      return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "no_session" }) };
    }

    let parsed;
    try {
      parsed = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: "Invalid JSON" };
    }

    try {
      await store().set(keyFor(user.sub), JSON.stringify(parsed));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: true }),
      };
    } catch (err) {
      return { statusCode: 502, body: String(err.message || err) };
    }
  }

  return { statusCode: 405, body: "Method not allowed" };
};
