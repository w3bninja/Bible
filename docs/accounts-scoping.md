# Feature Scoping: Multi-User Accounts

Status: scoping only, nothing implemented yet. Not scheduled — captured here so the design decisions already made aren't lost before this gets picked up.

## Decisions made so far

1. **Two-tier permission model**, not full multi-tenancy:
   - **Shared, owner-editable, everyone-viewable**: Topics, Studies, Insights (heatmap/tag graph/cross-ref graphs/timeline/map), cross-reference data. Topics/cross-refs/timeline/map are already read-only imported data, so no change needed there. Studies is the one that changes — it's currently open to anyone with the site password to create/edit/delete; that becomes owner-only, with everyone else browsing read-only (same treatment Topics already gets).
   - **Private per-user, fully editable by that user only**: tags + notes on verses (today's `data/tags.json` — `{tags, verseTags, links}`). Not visible to other users at all, not just non-editable.

2. **Login via "Sign in with YouVersion"** — reuses the PKCE OAuth flow already built and working (see `youversion-callback.html`, `netlify/functions/youversion-token.js`). No passwords to store, hash, or build reset flows for. The account's permanent ID is the `yvp_id` claim decoded from the JWT access token (confirmed present via the debug probe done this session — `yvp_id`, `email`, `name`, `profile_picture` are all in the token claims already, no extra API call needed).

## Why this is bigger than a normal feature

This touches the app's core data model and auth, not just a new screen:

- **Auth**: replaces `netlify/functions/_auth.js`'s single shared `SITE_PASSWORD` check with real session-based auth (signed cookie or JWT identifying the user + role) applied per-endpoint, with a read/write and owner/any-user permission distinction. Every existing Netlify function (`tags.js`, `categories.js`, `shares.js`, `share-view.js`) needs its auth check revisited.
- **Data model — tags/notes must become per-user**: `data/tags.json` is currently one global blob. Cleanest approach is one blob per user (e.g. `tags-<yvp_id>.json`) rather than one giant blob keyed internally by user, since Netlify Blobs is a plain key-value store and per-user keys avoid read/write contention as user count grows.
- **Data model — Studies stays shared but gets a write gate**: `data/categories.json` (`categories.js` function) stays one blob, but the POST handler needs an owner check added.
- **Frontend**: needs a real login screen (replacing the current site-password lock screen), a "current user" concept threaded through `app.js` state (today `tagsData`/`categoriesData` are module-level singletons with no user dimension at all), and UI changes to hide edit affordances (New Study, Edit, Delete on Studies) for non-owner users.
- **Existing single-tenant data needs a migration path**: today's `tags.json`/`categories.json` content (the owner's own data, accumulated all session) needs to end up attributed to the owner account once accounts exist, not orphaned or wiped.

## Open questions for whenever this gets picked up

- Does a signed-in non-owner user get their own **private Studies** too (a personal notebook, separate from the shared owner-curated ones), or is Study-creation strictly owner-only with regular users limited to tags/notes? (Leaning toward "no personal Studies in v1" based on the conversation, but not explicitly settled.)
- How is the owner account itself established — first person to sign in becomes owner automatically, or a manually-set `yvp_id` in an env var/config?
- Do shared links (`shares.js`) stay tied to the owner's tags only, or can any user's tags be shared? (Given tags become private per-user, this probably still works as-is — a share token already points at one specific tag by ID — but worth re-checking once tags are namespaced per user.)

## Rough effort

**L/XL** — no unresolved external dependency (YouVersion OAuth already works, JWT claims already confirmed), but it's a real architectural change touching auth, every data-backed Netlify function, and core frontend state — not a bolt-on feature.
