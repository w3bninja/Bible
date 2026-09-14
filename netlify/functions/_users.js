// Records that an account exists. Nothing else in this app persists a user
// list — sessions are stateless (see _session.js) and every per-user blob
// (tags-${sub}.json, prefs-${sub}.json, ...) only exists once that specific
// feature has been touched, so none of them reliably enumerates every
// account. This is the one place that does, written once per sub the first
// time a session is minted (see google-callback.js).

const { getStore } = require("@netlify/blobs");

const STORE_NAME = "bible-study";
const KEY_PREFIX = "user-";
// Tombstones. Deleting an account removes every trace of it, which left the dashboard's
// deletions series permanently empty — there was nothing left to count. A tombstone keeps
// the one fact the account is gone, and deliberately not the person: a sub and two dates.
const DELETED_PREFIX = "deleted-";

function store() {
  return getStore(STORE_NAME);
}

function keyFor(sub) {
  return `${KEY_PREFIX}${sub}`;
}

// Only ever writes on first sight of a sub — repeat logins must not
// overwrite the original signup date.
async function recordSignupIfNew(sub, email) {
  const s = store();
  const key = keyFor(sub);
  const existing = await s.get(key, { type: "json" });
  if (existing) return;
  await s.setJSON(key, { sub, email: email || null, createdAt: new Date().toISOString() });
}

async function listSignups() {
  const s = store();
  const { blobs } = await s.list({ prefix: KEY_PREFIX });
  const entries = await Promise.all(
    blobs.map(async ({ key }) => s.get(key, { type: "json" }))
  );
  return entries.filter(Boolean);
}

// Admin-initiated delete, from the app-manager dashboard — no self-serve deletion exists in
// this app yet (see PLAN.md). Removes every per-user blob we know about: the signup record
// itself, tags, prefs, YouVersion tokens, and any share links they own. categories.js is
// deliberately excluded — categories aren't per-user.
async function listDeletions() {
  const s = store();
  const { blobs } = await s.list({ prefix: DELETED_PREFIX });
  const entries = await Promise.all(
    blobs.map(async ({ key }) => s.get(key, { type: "json" }))
  );
  return entries.filter(Boolean);
}

async function deleteAccount(sub) {
  const s = store();

  // Read the signup record and write the tombstone before deleting anything. Afterwards the
  // createdAt is gone, and a delete that fails halfway would otherwise leave an account
  // that is unusable but was never recorded as deleted.
  const existing = await s.get(keyFor(sub), { type: "json" });
  await s.setJSON(`${DELETED_PREFIX}${sub}`, {
    sub,
    createdAt: (existing && existing.createdAt) || null,
    deletedAt: new Date().toISOString(),
  });

  await Promise.all([
    s.delete(keyFor(sub)),
    s.delete(`tags-${sub}.json`),
    s.delete(`prefs-${sub}.json`),
    s.delete(`youversion-tokens-${sub}.json`),
  ]);

  const sharesRaw = await s.get("shares.json");
  if (sharesRaw) {
    const shares = JSON.parse(sharesRaw);
    let changed = false;
    for (const [token, share] of Object.entries(shares)) {
      if (share.ownerId === sub) {
        delete shares[token];
        changed = true;
      }
    }
    if (changed) await s.set("shares.json", JSON.stringify(shares));
  }
}

module.exports = { recordSignupIfNew, listSignups, listDeletions, deleteAccount };
