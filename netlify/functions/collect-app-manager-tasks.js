// Collect the user operations App Manager is holding for this app, and carry them out here.
//
// App Manager used to hold Anchor's admin secret and call its delete endpoint directly. Now it
// writes down what it wants and this app fetches its own work with its own token, so the
// deletion runs in the code that owns the blobs — which is where it always belonged.
//
// Scheduled rather than triggered: nothing needs a deletion to land within seconds, and a
// schedule means App Manager holds no way to make this app do anything on demand.
//
// v1 handler style with connectLambda, matching the rest of this directory — Blobs is not
// reachable without it, so an ESM v2 function here would fail at the first store access.

const { connectLambda } = require("@netlify/blobs");
const { deleteAccount } = require("./_users");

async function run(task) {
  switch (task.op) {
    case "delete_user":
      if (!task.payload || !task.payload.userId) throw new Error("userId is required");
      return deleteAccount(String(task.payload.userId));
    default:
      // Reported rather than ignored: an op this app has not implemented is worth seeing on the
      // dashboard, not a row that silently never completes.
      throw new Error(`Anchor does not implement ${task.op}`);
  }
}

exports.handler = async (event) => {
  connectLambda(event);

  const url = process.env.APP_MANAGER_URL;
  const token = process.env.APP_MANAGER_PULL_TOKEN;
  if (!url || !token) {
    console.error("collect-app-manager-tasks: App Manager is not configured, skipping");
    return { statusCode: 200, body: JSON.stringify({ skipped: "not configured" }) };
  }
  const base = url.replace(/\/$/, "");

  const res = await fetch(`${base}/api/apps/anchor/tasks`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`collect-app-manager-tasks: collect returned ${res.status}`);
    return { statusCode: 502, body: JSON.stringify({ error: `Collect failed: ${res.status}` }) };
  }

  const { tasks } = await res.json();
  if (!tasks || tasks.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ collected: 0, applied: 0 }) };
  }

  // One at a time, each reported individually. A batch would let one task about an account that
  // is already gone take the whole run's work with it.
  const results = [];
  for (const task of tasks) {
    try {
      await run(task);
      results.push({ id: task.id, ok: true });
    } catch (err) {
      results.push({ id: task.id, ok: false, error: err instanceof Error ? err.message : "Failed" });
    }
  }

  await fetch(`${base}/api/apps/anchor/tasks`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ results }),
  });

  const applied = results.filter((r) => r.ok).length;
  console.log(`collect-app-manager-tasks: applied ${applied}/${tasks.length}`);
  return {
    statusCode: 200,
    body: JSON.stringify({ collected: tasks.length, applied, failed: tasks.length - applied }),
  };
};
