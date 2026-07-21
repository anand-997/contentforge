# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ContentForge is a Next.js 14 (App Router) + TypeScript app that runs a daily
content-generation pipeline for **any brand or niche** and serves a dashboard
to review/copy/publish the output. It is not tied to one brand — content
identity (name, pillars, voice) is user-configured data, not hardcoded.

The only outbound calls are to two LLM APIs:
- **Deepseek** (text) — via the `openai` npm package pointed at the Deepseek
  base URL (OpenAI-compatible API), not OpenAI.
- **OpenAI** (images, optional) — `models.imageEngine: "openai"` uses
  gpt-image-1; the default `"template"` engine renders deterministic branded
  PNGs locally with no image API key needed.

## Two deployment modes — read this before touching config/data code

- **Local mode** (default, `NEXT_PUBLIC_STORAGE_MODE` unset/`local`) —
  single-machine, single-brand, cron-scheduled. Runtime data lives in
  `lib/dataDir.ts`'s `DATA_DIR`, which defaults to
  `../social-media-config/contentforge` (a sibling of this app directory,
  **not** `process.cwd()`) and can be overridden with `CONTENTFORGE_DATA_DIR`.
  Never hardcode `process.cwd()` for data files — always route through
  `DATA_DIR`. Generated images are served via `app/api/images/[filename]`,
  not Next's `public/` (the data root is outside the app bundle).
- **Folder/Drive mode** (`NEXT_PUBLIC_STORAGE_MODE=folder`) — the true
  multi-visitor path. Each visitor's browser owns a folder (File System
  Access API) or Google Drive location (`lib/client/storage.ts`,
  `lib/client/driveStorage.ts`) holding their own credentials, workbook,
  images, and config — **nothing is stored on the server**, and no two
  visitors ever share config. `app/api/generate/route.ts` is fully
  stateless: it receives `config`/`domain`/`agentPrompts`/`theme`/`voice`/
  `material`/`history` in the POST body and validates each with
  `validateConfig`/`validateDomainConfig`/`validateAgentPrompts` — it must
  never call `readConfig()`/`readDomainConfig()`/`readAgentPrompts()`
  (the local-mode file readers) directly.

## Architecture: "what to create" vs "how to run"

Configuration is deliberately split across four files, all per-storage in
both modes (local: `DATA_DIR`; folder/Drive: the visitor's own
`readText`/`writeText` via `StorageProvider`):

- **`content-domain.json`** (`lib/domainConfig.ts`) — the creative identity:
  brand (name/handle/location/roles/expertise/mission/imageColors), content
  pillars (**free-form**, `PillarId` is `string`, not a fixed union),
  `enabledPlatforms` (per-platform on/off), `voiceSamples` (few-shot
  examples — user-pasted or AI-assist drafted), `hashtagUniverse`,
  `devtoTags`. The only code-shipped default is `GENERIC_DEFAULT_DOMAIN` —
  brand-neutral (blank name, zero pillars) — this is what seeds every
  brand-new visitor. **Never add niche-specific content back into source**;
  a specific brand's data belongs only in its own `content-domain.json` file,
  never in `lib/domainConfig.ts` or any other shipped code.
- **`contentforge.config.json`** (`lib/configManager.ts`) — technical run
  settings only: scheduler, model names/temperatures, knowledge ingestion,
  notifications, autoPost, platform posting times. No brand/pillar fields
  live here (they moved to `content-domain.json`).
- **`agent-prompts.json`** (`lib/promptConfig.ts`) — RICE-POT
  role/instructions/parameters/tone per agent stage (topic/brief/content)
  plus image-card knobs. `DEFAULT_PROMPTS` is brand-neutral by design (empty
  `role` fields — identity comes from `content-domain.json` via
  `buildBrandIntro`).
- **`weekly-plan.json`** (`lib/weeklyConfig.ts`) — per-weekday theme + brand
  voice rotation. Pillar references are free strings validated against
  whatever pillars the domain actually defines, not a hardcoded enum.

## Pipeline

`lib/pipeline.ts` → `runPipeline()` acquires a boolean mutex
(`lib/pipelineLock.ts`), then runs three agents in order (all in
`lib/agents.ts`), skipping completed steps based on today's Excel row status:

- **Agent 1** (`Pending`→) selects a content pillar (weighted rotation) and
  post structure (sequential rotation), generates a topic via Deepseek,
  appends an Excel row.
- **Agent 2** (`Writing`) makes **five separate Deepseek calls — one per
  platform, never combined** — LinkedIn, Medium, Instagram, YouTube, Dev.to.
  Disabled platforms (`domain.enabledPlatforms`) are skipped and treated as
  already "done" for resume purposes.
- **Agent 3** (`Imaging`) generates branded PNGs (template engine, no API
  key) or AI images (`imageEngine: "openai"`) and validates file size.

`resolveStartStep(status)` maps status
(`Pending`/`Writing`/`Imaging`/`Done`/`Error`) to the resume point. Every
agent reads from a single `RunContext` (`lib/runContext.ts`) —
`ctx.config`/`ctx.domain`/`ctx.prompts`/`ctx.excel`/`ctx.images`/
`ctx.briefStore` — never globals. `createLocalContext()` reads from
`DATA_DIR`; `createBufferContext()` is the stateless folder-mode constructor,
built from the request body in `app/api/generate/route.ts`.

**Excel is the single source of truth**, not a database. `lib/excelManager.ts`
(`ExcelManager`) owns all local-mode reads/writes through a serialized
`writeQueue`; `lib/excelSchema.ts`/`lib/excelBuffer.ts` mirror the same fixed
**32-column A–AF schema** for the stateless buffer path. If the schema ever
changes, update both deliberately (there's a comment to that effect in
`excelSchema.ts`). Pillar values in Excel/briefs are free strings now
(fallback `"general"` on a blank cell) — never re-introduce a fixed pillar
enum here.

**The voice engine is the quality lever** (`lib/voiceEngine.ts`). It builds
Agent 2's system prompt from `VOICE_RULES` (niche-neutral craft rules) +
`POST_STRUCTURE_DEFINITIONS[structure]` + few-shot examples resolved via
`resolveExamples()`: the domain's own `voiceSamples` (pillar-tagged first)
when any exist, else `GENERIC_VOICE_EXAMPLES`/`GENERIC_VOICE_EXAMPLES_HONEST`
(niche-neutral fallbacks — no specific brand's content, ever).

**Scheduler is a singleton** (`lib/scheduler.ts`, `node-cron`), started once
from `app/instrumentation.ts` (Node runtime only, local mode). `POST
/api/config` restarts it after a schedule change.

**UI never touches the filesystem directly.** All data flows through
`app/api/*` routes. The dashboard gets real-time updates from `GET
/api/stream` (SSE) with a 3s poll fallback. `POST /api/run` is fire-and-forget
(202, or 409 if locked) — never awaits the pipeline. A `LoadingProvider`
(`components/LoadingProvider.tsx`) shows a global "something is pending"
indicator across every async action in both modes, additive to existing
per-action spinners.

**Modals must be portaled.** Any full-screen `fixed inset-0` overlay
(Settings editors, etc.) must use `createPortal(jsx, document.body)` —
several ancestors (`Sidebar`'s `<aside>` has an active `transform`;
`FolderApp`'s `<header>` has `backdrop-blur`) establish a CSS containing
block that traps un-portaled `position: fixed` children inside that
ancestor's box instead of the viewport. See `components/TopicDetailModal.tsx`
for the reference pattern.

**Settings editors open read-only, not directly editable.** All four
(`components/ContentDomainEditor.tsx`, `AgentPromptsEditor.tsx`,
`WeeklyPlanEditor.tsx`, `CredentialsEditor.tsx`) mount with every field
disabled and an **Edit** button in the footer; clicking it unlocks the form
and swaps the footer to **Save**/**Cancel**. Implement this with
`<fieldset disabled={locked}>` wrapping the field group — it disables every
nested input/select/textarea/button in one shot, rather than tagging each
control individually. `WeeklyPlanEditor` scopes the fieldset to just the
fields *inside* an expanded weekday, not its accordion toggle, so browsing
days doesn't require unlocking first. Follow this pattern for any new
Settings form.

API keys (`credentials.env`) are edited as a proper labeled form
(`CredentialsEditor.tsx`), not a raw textarea — `lib/credentialsTemplate.ts`'s
`serializeCredentials()` writes values back into the full commented template
so the file's explanatory comments survive a save.

## Hard constraints (do not violate)

- **TypeScript strict mode, no `any` anywhere.**
- **No hardcoded brand/niche content in source** — anything specific to one
  brand belongs in that brand's own `content-domain.json`/`weekly-plan.json`
  data files, never in `lib/*.ts` defaults.
- **No database, no cloud storage** beyond Deepseek/OpenAI (local mode) or
  the visitor's own folder/Drive (folder mode).
- Agent 2 is **five distinct API calls**, not one.
- `client.chat.completions.create` calls always read model
  names/temperatures/base URL from config at call time — never hardcode them.
- Gitignored runtime artifacts: `.env`, and (local mode, if `DATA_DIR` is ever
  pointed back at this directory) `content_calendar.xlsx`, `content-domain.json`,
  `agent-prompts.json`, `weekly-plan.json`, `images/`, `logs/`.
- Logging goes to both console and `<DATA_DIR>/logs/pipeline.log` with
  rotation to `pipeline.log.bak` at 10MB (`lib/logger.ts`).

## Commands

```bash
npm install
npm run dev            # Next.js dev server → http://localhost:3000
npm run build
npm run lint
npm run typecheck
```

No test suite. Verify via `npm run typecheck && npm run lint && npm run build`
clean, plus a manual pass in the browser for any UI change (desktop + mobile).
