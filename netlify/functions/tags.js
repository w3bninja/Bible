const { getStore } = require("@netlify/blobs");

const DEFAULT_TAGS = { tags: [], verseTags: {} };

function openStore() {
  // Automatic context injection is unreliable on some sites (a known Netlify
  // platform issue), so fall back to explicit siteID/token when provided.
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_AUTH_TOKEN;
  if (siteID && token) {
    return getStore("bible-tags", { siteID, token });
  }
  return getStore("bible-tags");
}

exports.handler = async (event) => {
  const store = openStore();

  if (event.httpMethod === "GET") {
    const data = await store.get("tags", { type: "json" });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || DEFAULT_TAGS),
    };
  }

  if (event.httpMethod === "POST") {
    let parsed;
    try {
      parsed = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: "Invalid JSON" };
    }
    await store.setJSON("tags", parsed);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
