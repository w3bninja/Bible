// Deliberately PUBLIC — no auth check. This is the read-only viewing
// endpoint for a share link. It only ever returns the single tag's name,
// hue, and verseTags entries (key + note) named by the token — never the
// full tags.json blob, so a share link can't be used to enumerate other
// tags or verses. Verse text/references are resolved client-side from the
// already-public data/bible.json, not sent from here.

const { getStore, connectLambda } = require("@netlify/blobs");

function store() {
  return getStore("bible-study");
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const token = event.queryStringParameters && event.queryStringParameters.t;
  if (!token) {
    return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "missing_token" }) };
  }

  try {
    const sharesRaw = await store().get("shares.json");
    const shares = sharesRaw ? JSON.parse(sharesRaw) : {};
    const share = shares[token];
    if (!share) {
      return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "not_found" }) };
    }

    share.viewCount = (share.viewCount || 0) + 1;
    share.lastViewedAt = Date.now();
    shares[token] = share;
    await store().set("shares.json", JSON.stringify(shares));

    // Tags are private per-account now — a share created before accounts
    // existed has no ownerId and can't be resolved anymore.
    if (!share.ownerId) {
      return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "not_found" }) };
    }

    const tagsRaw = await store().get(`tags-${share.ownerId}.json`);
    const tagsData = tagsRaw ? JSON.parse(tagsRaw) : { tags: [], verseTags: {} };
    const tag = (tagsData.tags || []).find((t) => t.id === share.tagId);

    const entries = Object.entries(tagsData.verseTags || {})
      .filter(([, e]) => (e.tagIds || []).includes(share.tagId))
      .map(([key, e]) => ({ key, note: e.note || "" }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tagName: tag ? tag.name : share.tagName,
        hue: tag ? tag.hue : 250,
        entries,
      }),
    };
  } catch (err) {
    return { statusCode: 502, body: String(err.message || err) };
  }
};
