# Feature Scoping: Multi-User Accounts

Status: **Implemented** (shipped across commits `ec29c74`, `fbd715e`, `c9fd4dc`, 2026-08). Kept here as the historical record of the design decisions, since most of them shipped as originally scoped — only the login provider changed from the original plan.

## Decisions made so far

1. **Two-tier permission model**, not full multi-tenancy:
   - **Shared, owner-editable, everyone-viewable**: Topics, Studies, Insights (heatmap/tag graph/cross-ref graphs/timeline/map), cross-reference data. Topics/cross-refs/timeline/map are already read-only imported data, so no change needed there. Studies is the one that changes — it's currently open to anyone with the site password to create/edit/delete; that becomes owner-only, with everyone else browsing read-only (same treatment Topics already gets). **Shipped**: `categories.js` GET is public/no-auth, POST requires `role === "owner"` (403 `owner_only` otherwise).
   - **Private per-user, fully editable by that user only**: tags + notes on verses (today's `data/tags.json` — `{tags, verseTags, links}`). Not visible to other users at all, not just non-editable. **Shipped**: one blob per user, `tags-<sub>.json`.

2. ~~**Login via "Sign in with YouVersion"**~~ — **superseded.** The shipped implementation uses **Google OAuth** (real "confidential client" auth-code flow) instead: `app.js`'s `connectGoogle()` redirects to Google's authorize endpoint, `netlify/functions/google-callback.js` exchanges the code server-side and mints a session. The account's permanent ID is the Google **`sub`** claim, not `yvp_id`. YouVersion remains in the app, but purely as an optional per-account integration reachable from Settings — unrelated to login, unchanged from before accounts existed except that its token storage is now per-user too (see below).

## What shipped, and where

- **Auth**: `netlify/functions/_auth.js` (the old shared `SITE_PASSWORD` check) was deleted outright — the site password gate is fully removed, the app is publicly browsable. In its place, `netlify/functions/_session.js` issues stateless, HMAC-signed session tokens (`SESSION_SECRET` env var), payload `{ sub, email, name, picture, role, iat, exp }`, 30-day TTL. Not a cookie — stored in `localStorage` (`bible-study:sessionToken`) and sent as an `X-Session-Token` header. Every data-backed function (`tags.js`, `categories.js`, `shares.js`, `share-view.js`, `youversion-token.js`, `youversion-status.js`) was revisited to check this session.
- **Tags/notes per-user**: `tags.js` keys blobs `tags-<sub>.json`. GET with no session returns an empty stub (browsing never errors); POST requires a session and can only ever write to the caller's own key, since it's derived server-side from the verified `sub` — never client-supplied.
- **Studies owner write gate**: `categories.js` stays one shared `categories.json` blob; POST checks `getSessionUser(event)?.role === "owner"`.
- **Frontend**: `app.js` has a module-level `currentUser` singleton (`{ sub, email, name, picture, role, exp }` or `null`) populated from the stored session token, and an `isOwner()` helper used throughout to gate owner-only UI (a `.owner-only` CSS class toggle, plus tag-chip edit affordances). No blocking login screen — browsing is public; a reactive "Sign in to save" modal appears only when an authenticated write 401s. A persistent sign-in button/avatar lives in the sidebar and in Settings.
- **Legacy data migration**: `tags.js` has a one-time fallback that copies the old shared `tags.json` content into the owner's new `tags-<sub>.json` key, gated on `role === "owner"` and only when the owner's per-user blob is still empty — so it fires exactly once and never clobbers real per-user data.

## Open questions — status

- **Personal Studies for non-owner users**: **not built.** Study-creation remains strictly owner-only; regular users are limited to tags/notes. Matches the original "leaning toward no personal Studies in v1."
- **How the owner account is established**: resolved as **manual env var** (`OWNER_GOOGLE_EMAIL` in Netlify) — whoever signs in with that email becomes owner. Not "first person to sign in."
- **Do shared links stay tied to one user's tags, or can any user's tags be shared?**: resolved as **any signed-in user's tags can be shared** — `shares.js` requires a session, scopes GET/DELETE to `ownerId === user.sub`, and `share-view.js` resolves a share's `ownerId` to fetch that specific user's `tags-<ownerId>.json`. Shares created before accounts existed (no `ownerId`) are orphaned — `share-view.js` returns 404 for those rather than guessing an owner.

## Setup

See [accounts-setup.md](accounts-setup.md) for the one-time Google OAuth credential setup needed to make this work in a live deployment.
