/**
 * What App Manager says about this app.
 *
 * The direction here is the opposite of how this used to work. App Manager does not hold a key
 * to Anchor and push changes in; Anchor holds one token for itself and asks. A leak of that
 * token reads this app's own published roadmap and flag values. A leak of the admin secret it
 * replaces deleted accounts here.
 *
 * CommonJS to match the rest of this directory.
 */

const TTL_MS = 60_000;

let cached = null;
let inflight = null;

function config() {
  const url = process.env.APP_MANAGER_URL;
  const token = process.env.APP_MANAGER_PULL_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function appManagerConfigured() {
  return config() !== null;
}

/**
 * Never throws. App Manager being unreachable is not a reason for this app to fail — callers
 * fall back to what they already believed, which is what they did before any of this existed.
 * A stale manifest is preferred to nothing, since a minute-old flag beats no flag.
 */
async function getManifest() {
  const cfg = config();
  if (!cfg) return null;

  if (cached && Date.now() - cached.at < TTL_MS) return cached.manifest;

  // One fetch even if several invocations ask at once.
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch(`${cfg.url}/api/apps/anchor/manifest`, {
          headers: { authorization: `Bearer ${cfg.token}` },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) {
          console.error(`appManager: manifest returned ${res.status}`);
          return cached ? cached.manifest : null;
        }
        const manifest = await res.json();
        cached = { at: Date.now(), manifest };
        return manifest;
      } catch (err) {
        console.error("appManager: could not read the manifest", err);
        return cached ? cached.manifest : null;
      } finally {
        inflight = null;
      }
    })();
  }

  return inflight;
}

/**
 * Whether a flag is on, according to whoever decides it.
 *
 * A flag is only taken from the manifest when it says it is authoritative — otherwise the value
 * there is a mirror of what this app last reported, and trusting it would be reading our own
 * answer back to ourselves. The migration is per flag, so both kinds arrive together.
 */
async function isFeatureEnabled(key, fallback) {
  const manifest = await getManifest();
  if (!manifest) return fallback;

  const flag = (manifest.flags || []).find((f) => f.key === key && f.scope === "global");
  if (!flag || !flag.authoritative) return fallback;
  return flag.enabled;
}

/** The published roadmap, for showing people what is coming. Empty when unavailable. */
async function getRoadmap() {
  const manifest = await getManifest();
  return manifest ? manifest.roadmap || [] : [];
}

function resetManifestCache() {
  cached = null;
  inflight = null;
}

module.exports = {
  appManagerConfigured,
  getManifest,
  isFeatureEnabled,
  getRoadmap,
  resetManifestCache,
};
