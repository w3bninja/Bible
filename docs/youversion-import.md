# YouVersion (Bible.com) Import

Status: scoped, not started. Blocked on developer registration (see "Next step" below).

## Direction

One-way import only: pull existing Highlights and Notes from the user's YouVersion account into
this app's `tagsData`. No writes back to YouVersion. Two-way sync and export-to-YouVersion are
explicitly out of scope for this round — see `docs/feature-scoping.md` conventions for why: this
is already a real scope jump (OAuth + backend token exchange) without adding write-path complexity
and conflict resolution on top.

## Why this is possible

YouVersion opened an official developer platform in April 2026: "Sign in with YouVersion" OAuth,
plus a REST API exposing the user's own **Moments** — their unified model for `NOTE`, `HIGHLIGHT`,
`BOOKMARK` (and a few other kinds not relevant here). This is the platform's intended use case
(preserving bookmarks/highlights/notes across third-party apps), not an unofficial scrape.

Sources: [developers.youversion.com](https://developers.youversion.com/api-usage),
[platform.youversion.com](https://platform.youversion.com/terms),
[Sign-in API docs](https://developers.youversion.com/sign-in-apis).

## Architecture impact

This app is currently a static site + one tiny Netlify Function (`tags.js`, reads/writes
`data/tags.json`). This feature requires expanding that:

1. **OAuth2 authorization-code flow.** User clicks "Connect YouVersion account" → redirected to
   YouVersion's own login/consent screen → redirected back with an authorization code.
2. **Server-side token exchange.** The code → access token (JWT) + refresh token exchange needs
   the app's registered App Key (client_id) and — depending on which OAuth client type YouVersion
   issues — possibly a client secret. If a secret is involved, this exchange **must** happen in a
   new Netlify Function, never in browser JS, to avoid exposing it. (Need to confirm during setup
   whether YouVersion issues confidential-client credentials or supports a public/PKCE flow that
   wouldn't need a secret at all — changes how thin this can be.)
3. **Token storage.** This app has no user-account system of its own (single shared `tags.json`
   blob, consistent with it being a personal single-user app) — the YouVersion access/refresh
   token would be stored the same way, server-side via Netlify Blobs, not in `localStorage`.
4. **New Netlify Function(s)** to: handle the OAuth callback/token exchange, refresh expired
   tokens, and fetch the user's Moments (paginated) using the stored access token — proxied
   through our backend rather than called directly from the browser.

## Data mapping (Moments → this app's model)

- **HIGHLIGHT** moment (verse reference + hex color) → a tag in `tagsData.tags`, hue mapped to the
  nearest existing `HUE_PRESETS` value (or a new preset added for exact color fidelity — TBD).
- **NOTE** moment (verse reference + content + labels) → `verseTags[key].note` = content;
  `labels` → one or more tags (auto-created if a same-named tag doesn't already exist).
- Reference format needs confirming against real API responses (likely USFM-style, e.g. `GEN.1.1`)
  and mapping to this app's `bookId-chapter-verse` key scheme — same category of work as the
  `BOOK_ALIASES` tables already built for the Nave's/persons importers, just a new alias table for
  YouVersion's specific book-code convention.
- **Idempotency:** re-running the import shouldn't duplicate tags/notes on verses already imported
  — needs a small `importedMomentIds` record (new field in `tags.json` or a sibling file) to skip
  moments already pulled in on a prior run, while still allowing genuinely new manual edits to
  coexist untouched.

## Open unknowns (need real API access to resolve, not guessable from docs alone)

- Exact Moments list endpoint shape, pagination, and filtering by kind.
- Exact reference string format in real responses.
- Rate limits.
- Whether the OAuth flow needs a client secret (confidential client) or supports PKCE (public
  client) — determines exactly how much backend surface is unavoidable.

## Progress (2026-07-29)

Developer registration is done: user registered at platform.youversion.com and got an App Key —
no client secret was issued, confirming this is a **PKCE (public client) flow**, verified against
[developers.youversion.com/sign-in-apis](https://developers.youversion.com/sign-in-apis):
authorize endpoint `https://api.youversion.com/auth/authorize`, token endpoint
`https://api.youversion.com/auth/token`, PKCE mandatory (`code_challenge`/`code_challenge_method=S256`).

Built and deployed (pending live test):
- `youversion-callback.html` — static callback page, verifies OAuth `state`, POSTs the
  authorization code + PKCE verifier to the backend, redirects to `/?yvConnect=success|error`.
- `netlify/functions/youversion-token.js` — server-side token exchange (PKCE, no secret needed),
  stores `access_token`/`refresh_token`/`expires_at` in Netlify Blobs (never sent to the browser).
- `netlify/functions/youversion-status.js` — connected/not-connected check + disconnect (DELETE).
- `netlify/functions/youversion-debug-moments.js` — **temporary**, fetches the Moments list using
  the stored token and tries a couple of plausible endpoint paths (`/v1/moments`, `/moments`),
  returning the raw response so the exact endpoint path, pagination, and reference-string format
  can be confirmed against real data before writing the real import/mapping logic. Delete once the
  real import function is built and confirmed working.
- Tags page gained a small YouVersion connection panel (status text, Connect/Disconnect buttons).

**Known limitation:** none of this is testable against the local dev server (`server.ps1`) — it's
a bare static file server, not the real Netlify runtime, so `@netlify/blobs` and the Functions
can't execute there. Testing requires the live deployed site.

## Bug fix: `missing_code` on login (2026-08-06)

Live testing surfaced `?yvConnect=error&reason=missing_code&detail=?state=...` — the callback
page's assumption of a plain 2-step OAuth flow (`/authorize` → straight to `code`) was wrong.
Per [developers.youversion.com/sign-in-apis](https://developers.youversion.com/sign-in-apis),
YouVersion actually uses a 3-step flow: `/authorize` redirects back to our `redirect_uri` with
only `state` (no `code` yet); the app must then hit YouVersion's own
`https://api.youversion.com/auth/callback` endpoint (authenticated via the session cookie set on
their domain during login), which 302-redirects back to our `redirect_uri` a second time — this
time with the real `code`.

Fixed in [`youversion-callback.html`](../youversion-callback.html): when the first landing has
`state` but no `code`, relay once to `/auth/callback` (passing through whatever query params
arrived) instead of failing immediately. A `sessionStorage` flag (`yv_relayed_callback`) prevents
looping if the second landing still lacks a code. Not yet verified against a real login — still
needs the live test below.

## Next step

Deploy to `saanctify.netlify.app`, click "Connect YouVersion account" on the Tags page, complete
the real YouVersion login/consent, and confirm the callback lands back with `?yvConnect=success`
(watch for a brief flash through `api.youversion.com` mid-flow — that's the new relay hop, expected).
Once connected, hit `/api/youversion/debug-moments` (e.g. via curl) to see the real Moments API
shape — that's what determines the actual import/mapping code, still to be written.
