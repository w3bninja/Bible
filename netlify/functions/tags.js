const GITHUB_API = "https://api.github.com";
const OWNER = "w3bninja";
const REPO = "Bible";
const BRANCH = "master";
const FILE_PATH = "data/tags.json";

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    "User-Agent": "bible-study-tags-function",
  };
}

async function getFile() {
  const res = await fetch(
    `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    { headers: ghHeaders() }
  );
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status} ${await res.text()}`);
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    try {
      const file = await getFile();
      const content = Buffer.from(file.content, "base64").toString("utf-8");
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: content };
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
      const current = await getFile();
      const putRes = await fetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`,
        {
          method: "PUT",
          headers: { ...ghHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Update tags.json via Bible Study app",
            content: Buffer.from(JSON.stringify(parsed)).toString("base64"),
            sha: current.sha,
            branch: BRANCH,
          }),
        }
      );
      if (!putRes.ok) throw new Error(`GitHub write failed: ${putRes.status} ${await putRes.text()}`);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      };
    } catch (err) {
      return { statusCode: 502, body: String(err.message || err) };
    }
  }

  return { statusCode: 405, body: "Method not allowed" };
};
