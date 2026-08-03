const { getStore, connectLambda } = require("@netlify/blobs");
const { isAuthorized, unauthorizedResponse } = require("./_auth");

const KEY = "categories.json";
const EMPTY = '{"categories":[]}';

function store() {
  return getStore("bible-study");
}

exports.handler = async (event) => {
  connectLambda(event);
  if (!isAuthorized(event)) return unauthorizedResponse();

  if (event.httpMethod === "GET") {
    try {
      const data = await store().get(KEY);
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
    let parsed;
    try {
      parsed = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: "Invalid JSON" };
    }

    try {
      await store().set(KEY, JSON.stringify(parsed));
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
