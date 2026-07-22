const { getStore } = require("@netlify/blobs");

const DEFAULT_TAGS = { tags: [], verseTags: {} };

exports.handler = async (event) => {
  const store = getStore("bible-tags");

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
