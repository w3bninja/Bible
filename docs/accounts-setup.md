# Setting Up Google Login (one-time)

The account system (Google sign-in, per-user tags/notes, owner-only Studies) is implemented, but needs real credentials from Google before it'll work — this is a manual setup step, same as it was for the YouVersion App Key.

## 1. Create a Google OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project (or use an existing one).
2. **APIs & Services → OAuth consent screen** — set it up (External is fine for personal use; add yourself and anyone else you're inviting as test users if it stays in "Testing" mode).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorized redirect URIs: add `https://<your-netlify-domain>/api/google/callback` (e.g. `https://saanctify.netlify.app/api/google/callback`).
4. Copy the **Client ID** and **Client Secret** it gives you.

## 2. Set Netlify environment variables

In Netlify → Site settings → Environment variables, add:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_SECRET` | the Client Secret from step 1 |
| `OWNER_GOOGLE_EMAIL` | your own Google account email — whoever signs in with this email becomes the owner (can edit Studies; everyone else is read-only there) |
| `SESSION_SECRET` | any long random string (e.g. generate one with `openssl rand -hex 32`) — used to sign login sessions |

## 3. Put the Client ID in the code

The Client ID itself is public (safe to commit, like the YouVersion App Key already in the code) — open [app.js](../app.js) and find:

```js
const GOOGLE_CLIENT_ID = "REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID";
```

Replace the placeholder with your real Client ID from step 1, then commit and deploy.

## 4. Test it

1. Visit the site, enter the site password (unchanged — still the outer gate).
2. You should now see a "Sign in with Google" screen instead of going straight into the app.
3. Sign in with the email you set as `OWNER_GOOGLE_EMAIL` — Settings should show "Owner" under your name, and Studies should show the full edit controls (+ New Study, Edit, Delete, etc.).
4. Sign in with a *different* Google account (or ask someone else to) — Studies should be visible but read-only for them, and their tags/notes should be completely separate from yours.

## What didn't need to change

- Local development (`npm start` via `.claude/server.ps1`) — no login screen there at all; it's treated as the owner automatically so Studies stays fully editable while testing locally, same as before accounts existed.
- The site password — still the same outer gate as before, unchanged.
- YouVersion "connect" — unrelated to login now; each signed-in account can independently connect/disconnect their own YouVersion account from the Tags page, same flow as before.
