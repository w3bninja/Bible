const { getStore, connectLambda } = require("@netlify/blobs");
const { getSessionUser } = require("./_session");

const EMPTY = '{"tags":[],"verseTags":{}}';

function store() {
  return getStore("bible-study");
}

// Tags/notes are private per-user — one blob per account, keyed by the
// verified session's sub (never a client-supplied value, so one user can't
// read/write another's data by passing a different id).
function keyFor(sub) {
  return `tags-${sub}.json`;
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
      const data = await store().get(keyFor(user.sub));
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
