# ContentForge

ContentForge is a content-generation pipeline and dashboard for **any brand or
niche** — QA, beauty, finance, dev, anything. Each day it picks a topic, writes
platform-ready content for LinkedIn, Medium, Instagram, YouTube, and Dev.to,
generates branded cover images, and surfaces everything in a clean web
dashboard ready to copy and publish.

The only outbound network calls are to the two AI APIs it depends on:
**Deepseek** (text) and **OpenAI** (images, via gpt-image-1) or a built-in
deterministic template engine (no image API key required).

## Two ways to run it

| Mode | Who it's for | Where data lives |
|---|---|---|
| **Local** (default) | Running it yourself, one brand, one machine, with a daily scheduler | A local data directory (see below) |
| **Folder / Google Drive** (`NEXT_PUBLIC_STORAGE_MODE=folder`) | Hosting one URL for many people — each visitor brings their own keys and content lives in *their* folder/Drive, never on the server | Each visitor's own browser-picked folder or Google Drive |

Both modes share the same pipeline, voice engine, and Settings UI — see
`DEPLOY.md` for the full folder/Drive deployment story.

## Features

- One-click pipeline that drafts a daily topic and full content for five
  platforms, using a voice engine tuned to defeat generic AI writing patterns.
- **Brand & Content Settings** — define your niche, pillars, enabled
  platforms, and voice samples yourself (with an AI-assist draft to get
  started), instead of anything hardcoded to one brand.
- Branded image cards generated for Medium, LinkedIn, and Instagram.
- Daily scheduler (local mode) that runs automatically on your configured
  schedule.
- Live, real-time dashboard with status cards, a publish checklist, calendar,
  and Excel log — plus a global loading indicator so you always know when
  something's in flight.
- Per-field copy buttons so you can paste straight into each platform.
- Fully responsive — works on both mobile and desktop.
- Per-platform enable/disable — skip any of the five if it doesn't fit your
  niche.

---

## 1. Prerequisites

- **Node.js 20+** — check with `node --version`.
- **A Deepseek API key** — sign up and create one at https://platform.deepseek.com
- **An OpenAI API key** (optional) — only needed if you switch the image
  engine to `openai`; the default `template` engine needs no image API key.

A missing Deepseek key blocks the whole pipeline. A missing OpenAI key (with
`imageEngine: "openai"`) only skips images — text content still generates.

---

## 2. Installation

```bash
git clone https://github.com/anand-997/contentforge.git
cd contentforge
npm install
```

For **local mode**, add your keys to `.env` at this directory's root:

```env
DEEPSEEK_API_KEY=your_deepseek_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

For **folder/Drive mode**, keys are never set here — each visitor pastes
their own into `credentials.env` inside their chosen folder/Drive, from the
app's Settings menu.

---

## 3. Running

```bash
npm run dev
```

Then open http://localhost:3000. In local mode, the dashboard loads and the
daily scheduler starts automatically. In folder/Drive mode
(`NEXT_PUBLIC_STORAGE_MODE=folder`), you'll be prompted to connect a folder or
Google Drive first.

---

## 4. Your first run

1. **New here?** A first-time visitor (fresh local install, or a brand-new
   folder/Drive connection) lands on a blank slate — no pre-set brand or
   niche. Use **Settings → Brand, pillars, platforms & voice** to describe
   your niche (optionally with the AI-assist draft button) before generating.
2. Click **▶ Run Pipeline Now**. Watch the status cards update in real time
   as each agent runs — topic generation, then writing, then imaging.
3. When the status reads **Done**, open **Today's Content** to find your
   generated posts, articles, and images, each with copy buttons.

---

## 5. Where your files live

**Local mode** keeps everything in a data directory *outside* this app
folder — separate from app code, similar in spirit to how folder/Drive mode
keeps a visitor's data out of the app bundle:

| What | Location |
|---|---|
| Brand, pillars, platforms, voice | `content-domain.json` |
| Technical run settings (scheduler, models, knowledge) | `contentforge.config.json` |
| RICE-POT agent prompts | `agent-prompts.json` |
| Per-weekday theme/voice rotation | `weekly-plan.json` |
| Content data (the master spreadsheet) | `content_calendar.xlsx` |
| Generated images | `images/` |
| Runtime logs | `logs/pipeline.log` |

The data directory defaults to `../social-media-config/contentforge` (a
sibling of this app folder) and can be overridden with the
`CONTENTFORGE_DATA_DIR` environment variable.

**Folder/Drive mode** keeps the same set of files inside whichever folder or
Drive location each visitor picked — nothing is stored on the server.

---

## 6. Configuring

Everything is editable from the dashboard's **Settings**:

- **Brand, pillars, platforms & voice** — your brand identity, content
  pillars (free-form, not fixed), which of the 5 platforms to generate for,
  and voice samples (paste your own writing, or draft with AI-assist).
- **Agent prompts** — the RICE-POT role/instructions/tone layered into each
  generation stage.
- **Weekly plan** — per-weekday theme and brand voice rotation.
- **API keys** (folder/Drive mode) — a labeled form for Deepseek, OpenAI,
  Gemini, Tavily, and each publishing platform's key/token, instead of
  hand-editing `credentials.env`.
- **Configuration** (local mode) — Deepseek model and cron schedule, inline
  in the sidebar.

Every Settings form above opens **read-only** — click **Edit** to unlock its
fields, make your changes, then **Save**. This avoids accidentally changing a
saved value with a stray click.

---

## 7. Keeping it always-on (local mode)

```bash
pm2 start npm --name contentforge -- run dev
pm2 startup && pm2 save
```

---

## 8. Deploying

See `DEPLOY.md` for the full folder/Drive multi-visitor deployment guide
(Vercel + `NEXT_PUBLIC_STORAGE_MODE=folder`).

---

## 9. Troubleshooting

**Missing API key** — the Deepseek or OpenAI indicator shows a red badge and
the pipeline is blocked (or skips images). Confirm the key is set, then
restart the server.

**Excel file locked** — writes fail while the spreadsheet is open elsewhere.
Close it in any other application; ContentForge retries a locked write a few
times, but needs the file free to save.

**Corrupt or empty image** — status ends as **Error** with a file-size check
failure. Re-run the pipeline; it resumes from the imaging step.

**Missed scheduled run** — make sure the server was running at your scheduled
time (use the pm2 setup above), or click **Run Pipeline Now** to catch up.

---

## 10. Project structure

```
contentforge/
├── app/                      # Next.js App Router — dashboard page + API routes + scheduler hook
├── components/               # React UI components (sidebar, settings editors, tabs, copy buttons)
├── lib/                      # Pipeline logic — agents, voice engine, Excel manager, scheduler, logger
├── DEPLOY.md                 # Folder/Drive multi-visitor deployment guide
└── .env                      # Your API keys, local mode only (gitignored)
```
