# Deploying ContentForge for many users (folder mode)

ContentForge has two run modes, chosen at build/run time by the env var
`NEXT_PUBLIC_STORAGE_MODE`:

| Mode | `NEXT_PUBLIC_STORAGE_MODE` | Data + keys live in | Use it for |
|------|----------------------------|---------------------|------------|
| **Local** (default) | unset or `local` | `social-media-config/contentforge/` (sibling to this app directory — see migration note below) + the cron scheduler | running it yourself on your own machine — unchanged from before |
| **Folder** (multi-user) | `folder` | a folder each visitor picks in their browser **or** their Google Drive | hosting one URL for many people |

## Data directory migration (local mode)

Local mode's runtime data — `contentforge.config.json`, `agent-prompts.json`,
`content-domain.json`, `weekly-plan.json`, `content_calendar.xlsx`, `images/`,
`knowledge/`, `data/` (briefs), and `logs/` — now lives in
`social-media-config/contentforge/` (a sibling directory to this app, outside
git-tracked app code), not under `contentforge/` at the app root. This keeps app
code and user-generated content/brand data separate, the same way folder/Drive
mode already keeps a visitor's data out of the app bundle. Override the location
with the `CONTENTFORGE_DATA_DIR` env var if you need a different layout (see
`lib/dataDir.ts`). `.env` (API keys) intentionally stays at the app root — it's a
deployment credential, not content data.

Local-mode-only history that predated this migration (an older
`content_calendar.xlsx`, `my_learnings/`, `data/briefs/`, `logs/`) was archived
rather than merged into the live dataset, under
`social-media-config/contentforge/_archive-local-mode/` — reference only, not
read by the app.

Generated images are served through `GET /api/images/[filename]` rather than
Next.js static `public/` hosting (they can no longer live under `public/` once
the data root moved outside the app directory). A rewrite in `next.config.js`
keeps any already-generated row that stores a legacy `/images/<file>` path
working without a data rewrite.

In **folder** mode each visitor chooses, at runtime, where their data lives:

- **Local folder** (Chrome/Edge desktop) — a folder on the current device.
- **Google Drive** (any browser/device) — a Drive folder, so the same content is
  reachable from any machine after signing in to Google. Only shown when the
  deployment is configured for Drive (see below).
- **Upload/download** fallback — for browsers without the folder API.

## How folder mode works

- Each visitor clicks **Choose folder** (Chrome/Edge desktop, File System Access
  API). ContentForge creates two files there if missing and reuses them if
  present:
  - `credentials.env` — the user pastes their own Deepseek/OpenAI keys.
  - `content_calendar.xlsx` — their generated posts + history (same 32-column schema).
  - plus an `images/` subfolder for generated PNGs.
- The browser keeps the workbook + keys. Clicking **Generate today** POSTs the
  keys + current workbook to `/api/generate`; the server runs the agents fully
  **in memory** and returns the updated workbook + images, which the browser
  writes back to the folder. The server stores nothing and never logs keys.
- Users with multiple accounts can **switch folders** anytime (top-right); each
  folder is independent. Recent folders are remembered for one-click reconnect
  (the browser asks once to re-grant access — a security requirement).
- Browsers without the folder API (Firefox/Safari/mobile) automatically get an
  **upload-at-start / download-when-done** fallback, so it works on any device.

## Google Drive mode

Drive uses the **same files and the same stateless `/api/generate` flow** as the
local folder — the only difference is where the browser stores the bytes. The user
clicks **Connect Google Drive** and signs in; ContentForge then finds-or-creates a
folder named **`ContentForge` at the root of My Drive** and seeds the full structure
inside it:

```
My Drive/ContentForge/
  content_calendar.xlsx     your posts + history (32-column schema)
  credentials.env           your own API keys
  weekly-plan.json          the week's themes and voices
  generation-log.json       history so repeat runs don't duplicate topics
  images/                   generated PNGs
  knowledge/                your source notes
    README.md
    .cache/                 extracted-text cache
    <one folder per knowledgeFiles entry in weekly-plan.json>
```

The `knowledge/` subfolders are derived from the `knowledgeFiles` entries in
`weekly-plan.json` (so they stay in sync when you edit the plan) and are created in
**both** local and Drive mode. Everything is find-or-create: reconnecting, or
connecting from another device, **reuses the existing folder and files** rather than
creating duplicates. API keys are edited in-app (Settings → **Edit API keys**) since a
`.env` file can't easily be opened in Drive's web UI.

Auth is fully client-side (`drive` scope via Google Identity Services) and **no
secret is held on the server**, preserving folder mode's privacy model.

### How files get into Drive

The app uses the full **`drive`** scope, so it reads and writes any file in the user's
Drive — including files added by **Google Drive desktop sync** or dragged into
`ContentForge/` through the Drive web UI. This is what lets the app use a folder the
user populated outside the app: point Drive desktop sync at (or upload) your existing
`content_calendar.xlsx`, `credentials.env`, `images/` and `knowledge/`, connect, and it
just works. If several `ContentForge` folders exist, the app binds to the one that
actually contains a `content_calendar.xlsx`.

**Settings → Import from local folder** remains as a convenience: pick a local folder
(e.g. `social-media-config/`) and the app copies the whole tree into Drive (workbook,
images, full `knowledge/` hierarchy; same-named files overwritten, `knowledge/.cache/`
skipped). Settings also offers **Choose a different Drive folder** (Google Picker) to
use a location other than `My Drive/ContentForge`.

**Scope trade-off.** `drive` is a Google *restricted* scope. In Testing mode it works
for the developer and up to 100 added test users with an "unverified app" notice; a
public, verified launch would require a Google CASA security assessment. To narrow back
to least-privilege, set `DRIVE_SCOPE` in `lib/client/driveAuth.ts` to
`https://www.googleapis.com/auth/drive.file` — but then only files the app itself
created are visible, and existing/synced files must be brought in via the import above.

### Who provides the Google credentials

**Each user supplies their own, in the app** — no deployment configuration is required.
When Drive isn't configured, the onboarding screen shows a **Set up Google Drive** form
with input fields, step-by-step instructions, and the exact origin to allow-list (read
from `window.location.origin`, so it's correct on localhost, previews and production).
Credentials are saved in that browser's `localStorage` and changeable any time from
**Settings → Google Drive setup**.

Only the **OAuth Client ID is required.** The Picker API key is optional and only needed
for the "Choose a different Drive folder" action — the default flow find-or-creates
`My Drive/ContentForge` through the Drive REST API and never opens the Picker.

Setting `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_API_KEY` is still supported
and acts as a **deployment-wide default** for users who haven't saved their own. Users'
saved credentials take precedence; removing them falls back to the default.

### One-time Google Cloud setup

Do this once at <https://console.cloud.google.com>:

1. **Create / select a project** (top-bar project selector → New Project).
2. **Enable APIs** (APIs & Services → Library): enable **Google Drive API** and
   **Google Picker API**.
3. **OAuth consent screen** (APIs & Services → OAuth consent screen):
   - User type **External**; fill app name + support/developer email.
   - Add the scope `https://www.googleapis.com/auth/drive` (needed so the app can use
     files you already keep in Drive). It's a *restricted* scope, so the console shows a
     warning and the sign-in shows an "unverified app" notice — expected in Testing.
   - While in **Testing**, add each user's Google address under **Test users**. Test
     users can use the app immediately (clicking through the unverified notice); a
     public, verified launch with the `drive` scope requires a Google CASA assessment.
4. **Create credentials** (APIs & Services → Credentials):
   - **OAuth client ID** → application type **Web application**. Under **Authorized
     JavaScript origins** add each origin the app is served from, e.g.
     `https://your-app.example.com` and `http://localhost:3000` for dev. Copy the
     **Client ID**.
   - **API key** → restrict it to the **Picker API**. Copy the **API key**.
5. **Paste the Client ID into the app** — onboarding → *Set up Google Drive*, or
   Settings → *Google Drive setup*. That's it; nothing to deploy.

   Optionally, to preconfigure Drive for **every** visitor of a deployment, set these
   two public env vars instead (they are not secrets — a client ID and a
   Picker-restricted API key are designed to be public and are protected by the
   authorized-origins allowlist):

   ```
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=<your OAuth client id>
   NEXT_PUBLIC_GOOGLE_API_KEY=<your Picker API key>
   ```

   Put them in `contentforge/.env.local` for dev and in the host's environment for
   deploy, then **rebuild** — `NEXT_PUBLIC_*` values are inlined at build time.

## Deploy steps

1. Set `NEXT_PUBLIC_STORAGE_MODE=folder` in the host's environment.
2. `npm install && npm run build && npm start` (or the host's Next.js preset).
3. Serve over **HTTPS** — both the File System Access API and Google OAuth require
   a secure context. For Google Drive, also complete the one-time Google Cloud setup
   above and set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + `NEXT_PUBLIC_GOOGLE_API_KEY`,
   adding the deployed origin to the OAuth client's authorized origins.
4. **Function timeout:** `/api/generate` runs several LLM calls and can take
   30–90s. It sets `maxDuration = 300`. On hosts with short serverless limits
   (e.g. Vercel Hobby = 10s), raise the limit or use a host with longer function
   timeouts. No server API keys are needed in folder mode — users bring their own.

## Notes

- **Web-research grounding (optional).** Add a [Tavily](https://tavily.com) key to
  ground posts in real, cite-able specifics instead of invented numbers: local mode
  reads `TAVILY_API_KEY` from `.env`; folder mode reads `TAVILY_API_KEY` from each
  user's `credentials.env`. With no key, generation falls back to the author's own
  material in **honest general mode** (no fabricated numbers/scenes).
- The daily cron scheduler only runs in local/single-tenant mode; folder mode is
  driven by the manual **Generate today** button (serverless has no per-user cron).
- The learnings knowledge base (`my_learnings/`, `npm run ingest`) is a local-mode
  feature; deployed folder users generate concept-level content unless real
  material is added to their workbook flow later.
