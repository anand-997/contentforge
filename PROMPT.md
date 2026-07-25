# ContentForge — Build Specification

> Create everything inside the `contentforge/` folder only.
> API keys for Deepseek and Gemini will be provided separately as a `.env.local` file.
> No Groq. No cloud storage. No database. Local machine only.

Build a local, vibe-coded **React + TypeScript** application called **ContentForge** —
an automated content-generation pipeline with a web dashboard. Single-machine,
runs locally, no cloud services except the two APIs listed below. Prioritize a
clean, working end-to-end build over abstractions.

---

## Stack

| Layer           | Technology                          | Notes                                         |
| --------------- | ----------------------------------- | --------------------------------------------- |
| Runtime         | Node.js 20+                         | Required                                      |
| Framework       | Next.js 14 (App Router)             | Full-stack                                    |
| Language        | TypeScript 5+ strict mode           | No `any` permitted anywhere                 |
| UI              | React + Tailwind CSS                | Dashboard only                                |
| LLM — Text     | `openai` npm package              | Pointed at Deepseek base URL — NOT OpenAI    |
| LLM — Images   | `@google/genai`                   | Gemini image generation                       |
| Spreadsheet     | `exceljs`                         | Read/write `content_calendar.xlsx`          |
| Scheduler       | `node-cron`                       | Daily 9:00 AM IST trigger                     |
| Env config      | `dotenv`                          | Built-in Next.js — keys from `.env.local`  |
| Markdown        | `react-markdown`                  | Render Medium and dev.to content in dashboard |
| Process manager | `pm2` (documented in README only) | Keep server alive — not a code dependency    |

### Deepseek API Setup

Deepseek exposes an OpenAI-compatible REST API. Use the `openai` package — no
separate Deepseek SDK needed:

```typescript
import OpenAI from "openai"

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
})
```

The model is read from `contentforge.config.json` at runtime — never hardcoded.

### Gemini Image Setup

```typescript
import { GoogleGenAI } from "@google/genai"

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
```

Model name is read from `contentforge.config.json`. Gemini returns base64-encoded
image data — decode it and save as PNG:

```typescript
const base64 = response.candidates[0].content.parts
  .find(p => p.inlineData)?.inlineData?.data ?? ""
await fs.writeFile(outputPath, Buffer.from(base64, "base64"))
```

---

## Keys in `.env.local`

```env
DEEPSEEK_API_KEY=your_deepseek_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## Runtime Configuration File

All non-secret runtime values live in `contentforge.config.json` at project root.
Read and written by `lib/configManager.ts`. Never hardcode any of these values.

```json
{
  "scheduler": {
    "cronSchedule": "0 9 * * *",
    "timezone": "Asia/Kolkata"
  },
  "models": {
    "deepseekModel": "deepseek-chat",
    "geminiModel": "gemini-2.0-flash-preview-image-generation",
    "deepseekBaseUrl": "https://api.deepseek.com",
    "maxTokensPerCall": 4000,
    "temperatureContent": 0.7,
    "temperatureTopic": 0.9
  },
  "contentPillars": [
    {
      "id": "career",
      "name": "QA Career & Growth",
      "weight": 30,
      "keywords": ["interview", "salary", "SDET role", "career switch", "portfolio", "resume"],
      "toneHint": "mentor who has conducted 100+ QA interviews — direct, no sympathy, genuinely helpful"
    },
    {
      "id": "ai-tools",
      "name": "AI Testing Tools",
      "weight": 30,
      "keywords": ["LLM", "AI Agents", "MCP", "DeepEval", "LangChain", "n8n", "LangFlow", "RAG"],
      "toneHint": "engineer who has run these in production — specific, opinionated, gives real numbers and real failure modes"
    },
    {
      "id": "automation",
      "name": "Automation Engineering",
      "weight": 25,
      "keywords": ["Playwright", "Selenium", "RestAssured", "API testing", "CI/CD", "flaky tests"],
      "toneHint": "senior SDET who has debugged this at 2am — practical, zero theory, talks about what breaks in production"
    },
    {
      "id": "industry",
      "name": "Industry Takes",
      "weight": 15,
      "keywords": ["QA trends", "testing culture", "shift left", "AI replacing testers"],
      "toneHint": "someone with opinions the QA community needs to hear but avoids saying publicly"
    }
  ],
  "postStructures": ["story", "contrast", "hot-take", "numbered-insight", "question-led"],
  "structureRotation": "sequential",
  "pillarRotation": "weighted",
  "lastUsedPillar": "",
  "lastUsedStructure": "",
  "keywords": [
    "QA", "MCP", "RAG", "LLM", "AI Agents", "n8n", "LangFlow",
    "Crew AI", "DeepEval", "LangChain", "AI Harness", "LLM Eval",
    "API Automation", "Postman", "Selenium", "RestAssured", "Playwright"
  ],
  "brand": {
    "name": "QA Walah",
    "handle": "@qawalah",
    "location": "Mumbai, India",
    "timezone": "Asia/Kolkata",
    "devtoSeries": "QA Walah Weekly",
    "mediumHandle": "qawalah",
    "imageColors": {
      "background": "#0d1117",
      "accent": "#00d4aa",
      "secondaryAccent": "#f0a500",
      "text": "#ffffff",
      "subtext": "#8b949e"
    }
  },
  "platformPostingTimes": {
    "linkedin": "08:00",
    "instagram": "09:00",
    "youtube": "10:00",
    "medium": "11:00",
    "devto": "12:00"
  },
  "notifications": {
    "channel": "",
    "telegramChatId": "",
    "notifyOnComplete": false,
    "notifyOnError": false
  },
  "autoPost": {
    "enabled": false,
    "platforms": {
      "linkedin": { "enabled": false, "accessToken": "" },
      "devto": { "enabled": false, "apiKey": "" },
      "medium": { "enabled": false, "integrationToken": "" },
      "instagram": { "enabled": false, "accessToken": "" },
      "youtube": { "enabled": false, "refreshToken": "" }
    }
  }
}
```

---

## Data Model

### Local Excel File

**File:** `content_calendar.xlsx` (project root — gitignored)
**Sheet:** `Content Calendar`
**Auto-created** on first run if missing, with all column headers in row 1.

### TypeScript Interface

```typescript
// lib/types.ts

export type StatusEnum =
  | "Pending"
  | "Writing"
  | "Imaging"
  | "Done"
  | "Error"

export type PillarId = "career" | "ai-tools" | "automation" | "industry"

export type PostStructure =
  | "story"
  | "contrast"
  | "hot-take"
  | "numbered-insight"
  | "question-led"

export interface ContentRow {
  // Core — Agent 1
  date: string                    // Col A — YYYY-MM-DD
  topic: string                   // Col B
  pillar: PillarId               // Col C
  postStructure: PostStructure   // Col D
  status: StatusEnum             // Col E

  // LinkedIn — Agent 2
  linkedin: string               // Col F — post body ~150-200 words
  linkedinHashtags: string       // Col G — for first comment, NOT post body

  // Medium — Agent 2
  medium: string                 // Col H — full article ~3000 words Markdown
  mediumTitle: string            // Col I — creative headline
  mediumSlug: string             // Col J — SEO URL slug
  mediumSubtitle: string         // Col K — one-sentence kicker
  mediumMetaDesc: string         // Col L — 155-char SEO meta description

  // Instagram — Agent 2
  instagram: string              // Col M — full caption with hook+content+CTA+hashtags

  // YouTube — Agent 2
  youtube: string                // Col N — full script with timestamps
  youtubeTitle1: string          // Col O — title option 1
  youtubeTitle2: string          // Col P — title option 2
  youtubeTitle3: string          // Col Q — title option 3
  youtubeDescription: string     // Col R — full YT description with chapters

  // Dev.to — Agent 2
  devto: string                  // Col S — full article ~2000 words with frontmatter

  // Images — Agent 3
  imageMedium: string            // Col T — /images/YYYY-MM-DD-medium.png
  imageLinkedin: string          // Col U — /images/YYYY-MM-DD-linkedin.png
  imageInstagram: string         // Col V — comma-separated carousel paths

  // Meta — All agents
  agentLog: string               // Col W — timestamped log entries
  lastUpdated: string            // Col X — ISO timestamp
  errorMessage: string           // Col Y — populated on failure only

  // Agent 5 placeholders — empty in v1
  linkedinPublishStatus: string  // Col Z
  mediumPublishStatus: string    // Col AA
  instagramPublishStatus: string // Col AB
  youtubePublishStatus: string   // Col AC
  devtoPublishStatus: string     // Col AD
  notifySentAt: string           // Col AE
  performanceNotes: string       // Col AF
}

export interface PipelineStatus {
  running: boolean
  currentStep: string | null
  lastUpdated: string | null
}

export interface StatusResponse {
  deepseek: "healthy" | "missing" | "invalid"
  gemini: "healthy" | "missing" | "invalid"
  deepseekModel: string
  geminiModel: string
  pipelineRunning: boolean
  currentStep: string | null
  nextScheduledRun: string
  lastRun: string | null
  lastStatus: StatusEnum | null
  streakDays: number
}

export interface ContentForgeConfig {
  scheduler: {
    cronSchedule: string
    timezone: string
  }
  models: {
    deepseekModel: string
    geminiModel: string
    deepseekBaseUrl: string
    maxTokensPerCall: number
    temperatureContent: number
    temperatureTopic: number
  }
  contentPillars: ContentPillar[]
  postStructures: PostStructure[]
  structureRotation: "sequential" | "random"
  pillarRotation: "weighted" | "sequential"
  lastUsedPillar: string
  lastUsedStructure: string
  keywords: string[]
  brand: BrandConfig
  platformPostingTimes: Record<string, string>
  notifications: NotificationConfig
  autoPost: AutoPostConfig
}

export interface ContentPillar {
  id: PillarId
  name: string
  weight: number
  keywords: string[]
  toneHint: string
}

export interface BrandConfig {
  name: string
  handle: string
  location: string
  timezone: string
  devtoSeries: string
  mediumHandle: string
  imageColors: {
    background: string
    accent: string
    secondaryAccent: string
    text: string
    subtext: string
  }
}

export interface NotificationConfig {
  channel: string
  telegramChatId: string
  notifyOnComplete: boolean
  notifyOnError: boolean
}

export interface AutoPostConfig {
  enabled: boolean
  platforms: Record<string, { enabled: boolean; [key: string]: unknown }>
}

export interface ChecklistStep {
  label: string
  copyKey?: keyof ContentRow
}

export interface ChecklistItem {
  platform: string
  bestPostTime: string
  steps: ChecklistStep[]
}
```

---

## Brand Voice System (`lib/voiceEngine.ts`)

This is the most critical module. It builds the system prompt for Agent 2
dynamically. Output quality depends entirely on this.

### Voice Rules (inject into every Agent 2 system prompt)

```typescript
export const VOICE_RULES = `
VOICE RULES — follow every rule exactly. No exceptions.

1. Never open with a topic statement or definition. Open with a real moment,
   a specific scenario, or a number.
2. Never use arrow lists (→) more than once per post. Vary the format.
3. Never use "The gap is..." as a closing device.
4. Never start three consecutive sentences the same way.
5. Never use any of these phrases: "game-changer", "dive deep",
   "in today's world", "it's important to note", "let that sink in",
   "unpopular opinion:", "hot take:", "in conclusion", "to summarize",
   "as an SDET", "in the age of AI", "revolutionize", "unlock", "leverage".
6. Never use em-dashes (—) decoratively. Use a period or rewrite.
7. Never use special characters (✅ ❌ 🚀 →) in article body text.
8. One opinion per post. State it once. Do not restate it three ways.
9. The PS question must be specific to this post's scenario — not generic.
10. Use specific numbers. "4x cost" beats "much higher cost".
11. Short paragraphs. 1–3 sentences max for LinkedIn and Instagram.
12. Write as one engineer talking to one other engineer.
13. Follow the assigned post structure strictly — do not default to lists.
14. Vary sentence length — mix short (4–6 words) and long (15–20 words).
15. Include at least one specific, verifiable detail per post.
16. Never end with a hashtag in the same paragraph as a question mark.
`
```

### Post Structure Definitions

```typescript
export const POST_STRUCTURE_DEFINITIONS: Record<PostStructure, string> = {
  "story": `
    Open with a specific real-world scenario (interview, production incident,
    team meeting). Build character and tension. The insight emerges from the
    story — never stated upfront. End with a reflection on the reader's own
    experience. Format: flowing prose, minimal lists.
  `,
  "contrast": `
    Open with what most people do or believe. Contrast immediately with what
    experienced engineers do. Use sentence pairs — NOT arrow lists.
    End with the principle that explains the contrast.
    Format: alternating short paragraphs.
  `,
  "hot-take": `
    Open with one bold, specific, potentially controversial statement.
    Defend it with evidence, numbers, or a real example.
    Acknowledge the counterargument briefly — then dismiss it with reasoning.
    No hedging. No "in my opinion". Just the take and the defense.
    Format: short punchy paragraphs.
  `,
  "numbered-insight": `
    Open with a specific problem or question.
    Deliver 3–5 insights — each as a short paragraph, not a bullet.
    Use numbers as anchors: "The first thing..." not "1."
    Each insight must be specific, not generic.
    Format: narrative with numbered anchors.
  `,
  "question-led": `
    Open with the uncomfortable question the reader is already thinking.
    Answer it directly — no buildup, no preamble.
    Explain why that answer is correct with a real example.
    End with a second question that takes the reader one level deeper.
    Format: tight Q&A-style prose.
  `,
}
```

### Few-Shot Examples

Store three real QA Walah posts as constants in `voiceEngine.ts`.
These are injected as `role: "user"` + `role: "assistant"` pairs before each
Agent 2 generation call. Select the two examples whose pillar matches today's
pillar — pass them as few-shot context. Never explain the voice — show it.

```typescript
export const FEW_SHOT_EXAMPLES: Array<{
  pillar: PillarId
  structure: PostStructure
  userPrompt: string
  assistantResponse: string
}> = [
  {
    pillar: "career",
    structure: "story",
    userPrompt: "Write a LinkedIn post about AI dependency in QA interviews",
    assistantResponse: `An automation tester came to my interview yesterday.

Built AI agents. Playwright plus LLM workflows. Portfolio looked incredible.

Then I asked: what's the difference between git merge and rebase?

Silence.

He had shipped a dozen AI projects and never understood what the AI was doing underneath. Every locator, every assertion — Copilot wrote it, he merged it.

I use AI every single day. For generating tests, for debugging, for refactoring.

But AI is supposed to sit on top of your fundamentals. Not replace them.

When a payment test passes in CI and breaks in prod, someone has to understand what changed. That someone cannot be "the model, once it's back online."

The tester who wins is not the one who generated the most tests. It's the one who can read every line the AI wrote and tell you exactly why it's right or wrong.

Pre-AI judgment. Post-AI speed. That combination is the whole game.

PS: Could you debug your last flaky test without an AI assistant? Honest answer only.`,
  },
  {
    pillar: "ai-tools",
    structure: "numbered-insight",
    userPrompt: "Write a LinkedIn post about AI terms QA engineers misunderstand",
    assistantResponse: `Most QA engineers know what a token is.

Almost none can explain why it just tripled their automation bill.

Five AI terms. The version that actually matters at the testing layer.

The first one is tokens. Not "AI reads text in chunks." Playwright MCP burns around 114K tokens per task. The CLI burns 27K. If you don't know the difference, your agent bill is 4x what it should be.

The second is context window. Not "how much the AI can see." It's why your agent forgets your framework conventions halfway through generating a suite. Context management is test quality now.

The third is hallucination. Not "AI makes things up." Your agent generated a locator for an element that isn't on the page. Passes in CI. Breaks in prod. You shipped a hallucination.

The fourth is RAG. Not "AI retrieves your data." It's how you make an agent follow your test patterns instead of generic training-data noise.

The fifth is temperature. Not "how creative the AI is." High temperature in test generation means flaky, non-deterministic tests. You want your agent boring and repeatable.

The gap between knowing the dinner-party definition and knowing the testing-layer version is your next salary band.

PS: Which of these five does your team understand the least?`,
  },
  {
    pillar: "automation",
    structure: "contrast",
    userPrompt: "Write a LinkedIn post about feature flag test design",
    assistantResponse: `Most QA teams do not fail because they lack tools.

They fail because the real risk gets discussed too late.

The weak pattern in feature flag testing is simple. Treat CI as a place to run everything instead of a place to make decisions. Green builds become the judgment call. Failures arrive without enough evidence.

Senior SDETs ask different questions before writing a single test. What decision does this job support? What must block merge? What can run nightly? What artifact explains failure when it happens? Who owns the broken signal?

That is the shift from test execution to quality engineering.

A test is not mature because it passes. A test is mature when its failure teaches the team what to do next.

Try this in your next sprint planning: connect every important test to one product promise and one release decision. It exposes more gaps than any coverage report will.

PS: Which of these questions would reveal the biggest gap in your current test strategy?`,
  },
]
```

### `buildSystemPrompt()` Function

```typescript
export function buildSystemPrompt(
  pillar: ContentPillar,
  structure: PostStructure,
  platform: string
): string {
  const relevantExamples = FEW_SHOT_EXAMPLES
    .filter(ex => ex.pillar === pillar.id)
    .slice(0, 2)

  const examplesText = relevantExamples.map(ex =>
    `Example (${ex.structure} / ${ex.pillar}):\n${ex.assistantResponse}`
  ).join("\n\n---\n\n")

  return `
You are QA Walah — a senior QA engineer and SDET based in Mumbai, India with
12+ years of experience in software testing, automation, and AI-powered QA.
You write content for ${platform}.

Today's content pillar: ${pillar.name}
Pillar tone: ${pillar.toneHint}
Post structure to use: ${structure}

Structure definition:
${POST_STRUCTURE_DEFINITIONS[structure]}

${VOICE_RULES}

Here are examples of your writing style. Match this voice exactly:

${examplesText}
  `.trim()
}
```

---

## Four Agents

### Agent 1 — Topic Generator (`lib/agents.ts`)

**Trigger:** node-cron at configured schedule OR `POST /api/run`

**Steps:**

1. Read config — resolve today's pillar via weighted rotation, today's structure via sequential rotation
2. Read all existing `topic` values from Excel — build exclusion list
3. Call Deepseek with topic generation prompt
4. Validate response (non-empty, not in exclusion list, under 100 chars)
5. Append new Excel row: `date`, `topic`, `pillar`, `postStructure`, `status = "Pending"`
6. Write `lastUsedPillar` and `lastUsedStructure` back to config
7. Update `agentLog` and `lastUpdated`

**Pillar rotation logic:**

```typescript
function selectPillar(pillars: ContentPillar[], lastUsed: string): ContentPillar {
  // Filter out recently used, then sort by weight descending
  const available = pillars
    .filter(p => p.id !== lastUsed)
    .sort((a, b) => b.weight - a.weight)
  return available[0] ?? pillars[0]
}
```

**Structure rotation logic:**

```typescript
function selectStructure(
  structures: PostStructure[],
  lastUsed: string
): PostStructure {
  const idx = structures.indexOf(lastUsed as PostStructure)
  return structures[(idx + 1) % structures.length]
}
```

**Topic prompt:**

```typescript
const topicPrompt = `
You are a content strategist for a senior QA engineer brand called QA Walah, based in Mumbai, India.
Today's content pillar: ${pillar.name}
Pillar tone: ${pillar.toneHint}
Keywords to draw from: ${pillar.keywords.join(", ")}
Already covered (do not repeat or closely paraphrase): ${existingTopics.join(" | ")}

Generate ONE specific, engaging topic title.
Bad example: "Playwright Testing"
Good example: "Why Your Playwright Tests Pass Locally and Break in CI"
Return ONLY the topic title. No explanation. No punctuation at end. No quotes.
`
```

**Retry:** Retry once after 5 seconds on failure. On second failure set `status = "Error"` and abort.

---

### C (`lib/agents.ts`)

**Input:** Today's `topic`, `pillar`, `postStructure` from Excel

**Model:** `config.models.deepseekModel` — read at runtime, never hardcoded

**Five separate API calls — one per platform. Never combine into one call.**

Each call structure:

```typescript
const response = await deepseek.chat.completions.create({
  model: config.models.deepseekModel,
  max_tokens: config.models.maxTokensPerCall,
  temperature: config.models.temperatureContent,
  messages: [
    {
      role: "system",
      content: buildSystemPrompt(pillar, postStructure, platformName),
    },
    // Few-shot examples injected here as user/assistant pairs
    ...buildFewShotMessages(pillar),
    {
      role: "user",
      content: platformPrompt,  // platform-specific instructions below
    },
  ],
})
```

**Platform prompts:**

**LinkedIn:**

```
Write a LinkedIn post about: "${topic}"
Post structure: ${postStructure}
Length: 150–200 words
Rules:
- Post body must contain ZERO hashtags — hashtags go in a separate field
- Follow the assigned post structure exactly
- End with a PS question specific to this post's scenario
Return two sections separated by "---HASHTAGS---":
Section 1: the post body
Section 2: exactly 5 relevant hashtags (e.g. #QA #Playwright #SDET #AI #TestAutomation)
```

**Medium:**

```
Write a Medium article about: "${topic}"
Length: ~3000 words, Markdown format
Structure: Intro → Problem → Core Concept → Practical Example (with real code if relevant) → Common Mistakes → Summary
Rules:
- No filler headings ("Introduction", "Conclusion") — use descriptive H2s
- At least one real-world scenario grounded in QA or SDET work
Return five sections separated by these exact markers:
---TITLE---
[creative headline]
---SLUG---
[seo-url-slug-hyphenated-lowercase]
---SUBTITLE---
[one sentence kicker]
---METADESC---
[155 char SEO meta description]
---BODY---
[full article markdown]
```

**Instagram:**

```
Write an Instagram caption about: "${topic}"
Caption structure:
Line 1: Hook — one punchy sentence (shown before "...more")
Blank line
Lines 2–8: Content — single lines, max 2 sentences each, with blank lines between
Blank line
CTA line: e.g. "Save this for your next sprint planning."
Blank line
5 hashtags on final line
Total length: 150–250 words
```

**YouTube:**

```
Write a YouTube script about: "${topic}"
Structure with exact timestamp markers:
[00:00–00:30] Hook
[00:30–01:00] Intro
[01:00–08:00] Main content (add [B-ROLL SUGGESTION] markers)
[08:00–09:00] Recap
[09:00–09:30] Outro + subscribe CTA
Written as spoken word — natural, not robotic.
Return two sections separated by "---DESCRIPTION---":
Section 1: full script
Section 2: YouTube description with CHAPTERS block, keyword sentences, and "@qawalah" at end
Also return three title options after "---TITLES---" (one per line):
Title 1: [number]-based format
Title 2: problem/solution format
Title 3: story/experience format
```

**Dev.to:**

```
Write a dev.to article about: "${topic}"
Length: ~2000 words, Markdown with frontmatter
Frontmatter must be exactly:
---
title: "[article title]"
published: false
tags: [testing, playwright, ai, automation]
canonical_url: https://medium.com/@qawalah/${mediumSlug}
cover_image: /images/${todayDate}-medium.png
series: "${config.brand.devtoSeries}"
---
Rules:
- At least one TypeScript or Python code snippet, runnable not pseudocode
- Technical depth: explain implementation, not just concept
```

**Status updates:**

- Set `status = "Writing"` before first call
- Write each platform's output to Excel immediately after its call completes
- Set `status = "Imaging"` after all five written
- On failure: set `status = "Error"`, write to `errorMessage`, preserve already-written columns

**Call order and columns written:**

| Call | Platform  | Columns                                                                                      |
| ---- | --------- | -------------------------------------------------------------------------------------------- |
| 1    | LinkedIn  | `linkedin`, `linkedinHashtags`                                                           |
| 2    | Medium    | `medium`, `mediumTitle`, `mediumSlug`, `mediumSubtitle`, `mediumMetaDesc`          |
| 3    | Instagram | `instagram`                                                                                |
| 4    | YouTube   | `youtube`, `youtubeTitle1`, `youtubeTitle2`, `youtubeTitle3`, `youtubeDescription` |
| 5    | Dev.to    | `devto`                                                                                    |

---

### Agent 3 — Image Generator (`lib/agents.ts`)

**Input:** Today's `topic`, `pillar`, and brand colors from config

**Model:** `config.models.geminiModel` — read at runtime

**Three images to generate:**

| Image        | Dimensions       | Filename                    |
| ------------ | ---------------- | --------------------------- |
| Medium cover | 1200×675 (16:9) | `YYYY-MM-DD-medium.png`   |
| LinkedIn     | 1200×627        | `YYYY-MM-DD-linkedin.png` |
| Instagram    | 1080×1080       | `YYYY-MM-DD-ig-1.png`     |

**Save path:** `./public/images/` — served at `/images/filename.png` by Next.js

**Image prompt template:**

```typescript
function buildImagePrompt(topic: string, pillar: ContentPillar, ratio: string): string {
  return `
Create a professional branded content card for a QA and software testing brand.
Brand: QA Walah — a senior QA engineer content brand from Mumbai, India.
Topic: ${topic}
Visual style:
- Background: deep dark (#0d1117)
- Top-left: small text "QA WALAH | ${pillar.name.toUpperCase()}" in teal (#00d4aa) monospace
- Center: topic title in large bold white text — the largest element
- Below title: one short insight or sub-headline in muted text (#8b949e)
- Bottom strip: 2–3 category pill badges with teal outline
- Bottom-right: "@qawalah" in small muted text
- No stock photos. No people. No complex illustrations. Clean and minimal.
- Accent: teal (#00d4aa). Secondary accent: amber (#f0a500) for emphasis only.
Aspect ratio: ${ratio}
Return the image only.
  `.trim()
}
```

**Post-save validation:**

```typescript
const stat = await fs.stat(outputPath)
if (stat.size < 10_000) {
  throw new Error(`Image file too small (${stat.size} bytes) — likely corrupt`)
}
```

**Status:** Set `status = "Done"` when all images saved and validated.
Set `status = "Error"` on failure — preserve Agent 2 content.

---

### Agent 4 — Sheet Updater (ExcelManager)

Centralized in `lib/excelManager.ts`. Used by all agents. Never bypassed.

```typescript
export class ExcelManager {
  private filePath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async ensureFileExists(): Promise<void>   // create with headers if missing
  async readAllRows(): Promise<ContentRow[]>
  async getTodayRow(): Promise<ContentRow | null>
  async appendRow(row: Partial<ContentRow>): Promise<void>
  async updateRow(date: string, updates: Partial<ContentRow>): Promise<void>
  async getFileModifiedTime(): Promise<Date>

  // All writes go through this — guarantees sequential non-concurrent writes
  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(fn)
      .catch(err => logger.error("ExcelManager write failed", err))
    return this.writeQueue
  }
}
```

**Pattern for every write:** `readWorkbook → mutate in memory → writeWorkbook`
Never `fs.writeFileSync`. Always async through the queue.

**Excel auto-creation headers (32 columns A–AF):**

```
Date | Topic | Pillar | PostStructure | Status | LinkedIn | LinkedInHashtags |
Medium | MediumTitle | MediumSlug | MediumSubtitle | MediumMetaDesc | Instagram |
YouTube | YouTubeTitle1 | YouTubeTitle2 | YouTubeTitle3 | YouTubeDescription |
DevTo | ImageMedium | ImageLinkedIn | ImageInstagram | AgentLog | LastUpdated |
ErrorMessage | LinkedInPublishStatus | MediumPublishStatus | InstagramPublishStatus |
YouTubePublishStatus | DevToPublishStatus | NotifySentAt | PerformanceNotes
```

---

## Orchestration (`lib/pipeline.ts`)

```typescript
export async function runPipeline(): Promise<void> {
  if (isPipelineLocked()) {
    logger.warn("Pipeline already running — skipping trigger")
    return
  }

  acquireLock()

  try {
    const existingRow = await excelManager.getTodayRow()

    if (existingRow?.status === "Done") {
      logger.info("Already completed for today — skipping")
      return
    }

    const startStep = resolveStartStep(existingRow?.status)

    if (startStep <= 1) {
      emitStatus("running", "Agent 1: Selecting pillar and generating topic...")
      await agent1TopicGenerator()
    }

    if (startStep <= 2) {
      emitStatus("running", "Agent 2: Writing platform content...")
      await agent2ContentWriter()
    }

    if (startStep <= 3) {
      emitStatus("running", "Agent 3: Generating images...")
      await agent3ImageGenerator()
    }

    emitStatus("idle", "Pipeline complete — content ready")
    logger.info("Pipeline completed successfully")

  } catch (err) {
    emitStatus("error", `Pipeline failed: ${String(err)}`)
    logger.error("Pipeline failed", err)
  } finally {
    releaseLock()
  }
}

function resolveStartStep(status: StatusEnum | undefined): number {
  switch (status) {
    case undefined:
    case "Pending":  return 1
    case "Writing":  return 2
    case "Imaging":  return 3
    case "Done":     return 99
    case "Error":    return 1
    default:         return 1
  }
}
```

`emitStatus()` writes to an in-memory object read by `GET /api/status` and the
SSE stream — this is the real-time bridge between pipeline and dashboard.

---

## Scheduler (`lib/scheduler.ts`)

```typescript
import cron from "node-cron"
import { readConfig } from "./configManager"
import { runPipeline } from "./pipeline"
import { logger } from "./logger"

let currentJob: cron.ScheduledTask | null = null

export function startScheduler(): void {
  if (currentJob) {
    currentJob.stop()
    currentJob = null
  }

  const config = readConfig()
  const { cronSchedule, timezone } = config.scheduler

  if (!cron.validate(cronSchedule)) {
    logger.error(`Invalid cron expression: ${cronSchedule}`)
    return
  }

  currentJob = cron.schedule(cronSchedule, () => {
    logger.info(`Cron triggered — running pipeline (${cronSchedule})`)
    runPipeline()
  }, { timezone })

  logger.info(`Scheduler started: ${cronSchedule} (${timezone})`)
}

export function stopScheduler(): void {
  currentJob?.stop()
  currentJob = null
}
```

**Initialized exactly once via `app/instrumentation.ts`:**

```typescript
// app/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("../lib/scheduler")
    startScheduler()
  }
}
```

When cron schedule is updated via `POST /api/config`, call `startScheduler()`
again — it stops the old job and registers the new one.

---

## API Routes

All in `app/api/`. React UI never touches the filesystem directly.

| Method   | Route              | Description                              | Response                     |
| -------- | ------------------ | ---------------------------------------- | ---------------------------- |
| `POST` | `/api/run`       | Trigger pipeline                         | `202` or `409 Conflict`  |
| `GET`  | `/api/calendar`  | All rows newest first                    | `ContentRow[]`             |
| `GET`  | `/api/today`     | Today's row                              | `ContentRow \| null`        |
| `GET`  | `/api/status`    | Pipeline state + API key health + streak | `StatusResponse`           |
| `GET`  | `/api/stream`    | SSE live pipeline events                 | `text/event-stream`        |
| `GET`  | `/api/download`  | Download `.xlsx` file                  | `application/octet-stream` |
| `GET`  | `/api/config`    | Read config                              | `ContentForgeConfig`       |
| `POST` | `/api/config`    | Update config + restart scheduler        | `ContentForgeConfig`       |
| `GET`  | `/api/checklist` | Today's publish checklist                | `ChecklistItem[]`          |

### `POST /api/run`

```typescript
// Returns 409 if pipeline is locked
// Returns 202 if pipeline started
// Never awaits runPipeline() — fire and forget
```

### `GET /api/stream`

```typescript
// Server-Sent Events
// Sends: data: { step: string, status: string, timestamp: string }
// Client reconnects automatically on disconnect
```

### `GET /api/checklist`

Returns per-platform publish instructions with best posting times:

```typescript
[
  {
    platform: "LinkedIn",
    bestPostTime: "8:00 AM IST",
    steps: [
      { label: "Copy post body", copyKey: "linkedin" },
      { label: "Paste into LinkedIn and post" },
      { label: "Immediately add first comment with hashtags", copyKey: "linkedinHashtags" },
      { label: "Upload LinkedIn image", copyKey: "imageLinkedin" },
      { label: "Engage with comments within first 60 minutes" },
    ]
  },
  // ... Medium, Instagram, YouTube, Dev.to
]
```

---

## Dashboard UI

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  SIDEBAR (240px)              MAIN CONTENT (flex-fill)          │
│  ─────────────────            ──────────────────────           │
│  QA Walah @qawalah            [Status Cards — 4 across]        │
│                                                                  │
│  [▶ Run Pipeline Now]         [Tab: Today's Content]           │
│  [⚙ Config]                   [Tab: Publish Checklist]         │
│                               [Tab: Calendar]                   │
│  Deepseek: ● healthy          [Tab: Excel Log]                 │
│  Gemini:   ● healthy                                            │
│                               [Live Log Feed — when running]   │
│  Model: deepseek-chat [edit]                                    │
│  Schedule: 0 9 * * * [edit]                                     │
│  Next run: 09:00 AM IST                                         │
│                                                                  │
│  🔥 Streak: 7 days                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Status Cards (4 cards in a row)

| Card            | Content                                 |
| --------------- | --------------------------------------- |
| Today's Topic   | Topic text or "Not yet generated"       |
| Pipeline Status | Color-coded badge + spinner when active |
| Last Updated    | Relative time: "3 minutes ago"          |
| Content Streak  | Consecutive successful days count       |

Status badge colors:

- `Pending` → gray
- `Writing` → blue + spinner
- `Imaging` → yellow + spinner
- `Done` → green
- `Error` → red

### Tab 1 — Today's Content

Expandable accordion per platform. Default: all collapsed.

Each section:

- Platform name + status badge
- Copy button per copyable field — shows "Copied!" for 2 seconds then resets
- Content rendered:
  - LinkedIn: plain text, white space preserved
  - Medium: `react-markdown` rendered
  - Instagram: plain text, line breaks preserved
  - YouTube: plain text, timestamp markers highlighted in monospace
  - Dev.to: `react-markdown` rendered, frontmatter in code block

Special sub-sections:

- **YouTube Titles**: three options as selectable cards — creator clicks to mark chosen
- **Medium SEO**: collapsible — slug, subtitle, meta description with individual copy buttons
- **LinkedIn Hashtags**: separate copy button labeled "Copy first comment hashtags"
- **Images**: inline below content sections — Medium cover, LinkedIn image, Instagram
  carousel with prev/next nav if multiple

Empty state: centered message "Run the pipeline to generate today's content"
with a large "Run Pipeline Now" button.

### Tab 2 — Daily Publish Checklist

Per-platform checklist cards. Each card:

- Platform name + icon
- Best posting time from config
- Ordered steps with checkboxes (local state — resets daily by design)
- Inline copy buttons with steps that require copying
- Progress bar fills as steps are checked

### Tab 3 — Calendar

Table: Date | Topic | Pillar | Structure | Status | Last Updated

- Newest first
- Status column color-coded
- Clicking a row expands: LinkedIn preview (first 50 chars) + image thumbnails
- 30 rows per page

### Tab 4 — Excel Log

Parsed `agentLog` column as a readable timeline:

```
[2026-06-14 09:00:01] Agent 1 → Topic: "Why Playwright Tests Break in CI" | Pillar: automation
[2026-06-14 09:00:45] Agent 2 → LinkedIn written (187 words)
[2026-06-14 09:01:22] Agent 2 → Medium written (2,941 words)
```

- Filter by date and agent
- File last-modified timestamp at top
- Download button → `GET /api/download`

### Sidebar Config Editing

Two inline editable fields:

- **Deepseek model**: text input, warns if unrecognized value
- **Cron schedule**: text input, validates cron syntax before submitting

On save: `POST /api/config` → restart scheduler → show success toast.

### Live Log Feed

Collapsible panel at bottom when pipeline is running.
Shows last 10 log lines via SSE. Auto-scrolls. Disappears when idle.

### Real-Time Behavior

- Subscribe to `GET /api/stream` on mount
- Fallback: poll `GET /api/status` + `GET /api/today` every 3 seconds if SSE drops
- Update status cards and accordion badges on every event
- No full page reload at any point

---

## Error Handling

| Scenario                                             | Behavior                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Deepseek key missing                                 | Block pipeline; red badge in UI                            |
| Gemini key missing                                   | Block Agent 3 only; Agents 1+2 still run                   |
| Deepseek 429 rate limit                              | Wait 10s, retry once; mark platform Error if still failing |
| Deepseek timeout                                     | Retry once after 5s; mark Error on second failure          |
| Gemini returns corrupt image                         | File size check fails; empty path in Excel; Status = Error |
| Excel locked by another process                      | Retry write after 2s, up to 3 attempts                     |
| Excel missing on startup                             | `ensureFileExists()` creates it with headers             |
| Pipeline already running                             | `POST /api/run` returns `409 Conflict`                 |
| Today's row already Done                             | Return early — log "Already completed for today"          |
| Partial content (some platforms written, one failed) | Preserve written; Error status; re-trigger resumes         |
| Config file missing or corrupt                       | Use hardcoded defaults; recreate config file               |
| `public/images/` missing                           | Create directory before every Agent 3 run                  |

---

## Logging (`lib/logger.ts`)

Writes to both `console` and `logs/pipeline.log`.

```
[2026-06-14T03:30:01.234Z] [INFO]  [Agent1] Pillar: ai-tools | Structure: story
[2026-06-14T03:30:01.891Z] [INFO]  [Agent1] Topic: "Why Playwright Tests Break in CI"
[2026-06-14T03:30:15.445Z] [INFO]  [Agent2] LinkedIn written (187 words)
[2026-06-14T03:31:02.112Z] [ERROR] [Agent3] Image save failed: file size 0 bytes
```

Log rotation: rename to `pipeline.log.bak` when file exceeds 10MB. Keep one backup.

---

## Project Structure

```
contentforge/
├── .env.local                          # API keys — gitignored
├── .env.example                        # Template — committed
├── .gitignore
├── package.json
├── tsconfig.json                       # strict: true — no any
├── next.config.js
├── contentforge.config.json            # Runtime config — committed
│
├── app/
│   ├── instrumentation.ts              # Scheduler singleton (Next.js hook)
│   ├── layout.tsx
│   ├── page.tsx                        # Dashboard root
│   └── api/
│       ├── run/route.ts
│       ├── calendar/route.ts
│       ├── today/route.ts
│       ├── status/route.ts
│       ├── stream/route.ts             # SSE
│       ├── download/route.ts
│       ├── config/route.ts
│       └── checklist/route.ts
│
├── components/
│   ├── Sidebar.tsx
│   ├── StatusCards.tsx
│   ├── ContentTabs.tsx
│   ├── TodayContent.tsx
│   ├── PublishChecklist.tsx
│   ├── CalendarTable.tsx
│   ├── ExcelLog.tsx
│   ├── ImageCarousel.tsx
│   ├── CopyButton.tsx
│   ├── ApiKeyIndicator.tsx
│   ├── LiveLogFeed.tsx
│   └── YouTubeTitleSelector.tsx
│
├── lib/
│   ├── types.ts                        # All interfaces and enums
│   ├── excelManager.ts                 # ExcelManager with mutex
│   ├── agents.ts                       # agent1, agent2, agent3 functions
│   ├── voiceEngine.ts                  # Brand voice prompt builder + few-shot examples
│   ├── pipeline.ts                     # runPipeline(), emitStatus(), resolveStartStep()
│   ├── scheduler.ts                    # startScheduler(), stopScheduler()
│   ├── configManager.ts                # readConfig(), writeConfig(), validateConfig()
│   ├── logger.ts                       # File + console logger with rotation
│   └── pipelineLock.ts                 # Boolean mutex — acquireLock, releaseLock, isLocked
│
├── public/
│   └── images/                         # Generated images — gitignored
│
├── logs/
│   └── pipeline.log                    # Runtime log — gitignored
│
├── content_calendar.xlsx               # Local data store — gitignored
└── README.md
```

---

## `.gitignore`

```
.env.local
content_calendar.xlsx
public/images/
logs/
node_modules/
.next/
```

---

## `.env.example`

```env
# Deepseek API key — https://platform.deepseek.com
DEEPSEEK_API_KEY=

# Google Gemini API key — https://aistudio.google.com/app/apikey
GEMINI_API_KEY=
```

---

## README Requirements

Cover in this order:

1. What ContentForge does (two sentences)
2. Prerequisites — Node.js 20+, both API keys with links
3. Installation — clone → `npm install` → copy `.env.example` to `.env.local` → fill keys
4. Running — `npm run dev` → open `localhost:3000`
5. First run — click "Run Pipeline Now" → watch status cards → find content in Today's Content tab
6. File locations — Excel at project root, images at `public/images/`, logs at `logs/`
7. Configuring — model and schedule editable from dashboard sidebar
8. Keeping it always-on — `pm2 start npm --name contentforge -- run dev` then `pm2 startup && pm2 save`
9. Troubleshooting — four scenarios: missing API key / Excel locked / image corrupt / cron missed
10. Project structure — one line per key folder

---

## Deliverables Checklist

- [ ] All code complete, strictly typed, no `any`
- [ ] `contentforge.config.json` with all fields populated and validated on startup
- [ ] `lib/voiceEngine.ts` with full voice rules, structure definitions, and three few-shot examples
- [ ] Agent 1 with pillar + structure rotation writing to config
- [ ] Agent 2 with five separate Deepseek calls, correct column targets, model read from config
- [ ] Agent 3 with Gemini base64 decode, file size validation, brand image prompt
- [ ] ExcelManager with 32-column schema, mutex queue, auto-creation
- [ ] All 9 API routes implemented and typed
- [ ] Dashboard with 4 tabs, live SSE, sidebar config editing, streak counter
- [ ] Daily Publish Checklist tab with per-platform steps and copy buttons
- [ ] YouTube Title Selector component (3 selectable cards)
- [ ] Medium SEO fields shown with individual copy buttons
- [ ] LinkedIn hashtags in separate copy button (not in post body)
- [ ] Error handling for all failure scenarios defined above
- [ ] Logger with file rotation
- [ ] `instrumentation.ts` scheduler singleton
- [ ] `.env.example`, `.gitignore`, `README.md`
- [ ] `pm2` documented in README
- [ ] No references to any competitor name, handle, or brand anywhere in codebase

---

*ContentForge Build Specification — aligned with PRD v2.0 — QA Walah — 2026-06-14*
