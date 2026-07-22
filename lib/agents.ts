// lib/agents.ts
// Agent 1 (topic), Agent 2 (content), Agent 3 (images). No `any` anywhere.

import OpenAI from "openai";
import { logger } from "./logger";
import {
  buildSystemPrompt,
  buildFewShotMessages,
  buildBrandIntro,
} from "./voiceEngine";
import type { SystemPromptOptions } from "./voiceEngine";
import { reportProgress } from "./pipelineEvents";
import { checkStop, PipelineStoppedError } from "./pipelineLock";
import { readInputMaterial, readKnowledgeNotes } from "./brief";
import { createLocalContext, type RunContext } from "./runContext";
import {
  renderCard,
  deriveCardText,
  renderCarouselSlide,
  deriveCarouselSlides,
} from "./imageTemplate";
import { renderBlock, formatLines } from "./promptConfig";
import type { AgentPrompts } from "./promptConfig";
import { firstLine, lastLine, maxSimilarity } from "./similarity";
import { makeRunSeed, shuffle, randomPick, ANGLE_LENSES } from "./variation";
import { webResearch } from "./research";
import { themeForDay, voiceForDay } from "./weeklyConfig";
import { retrieveForTheme } from "./knowledge/index";
import type {
  BrandConfig,
  ContentBrief,
  ContentDomainConfig,
  ContentForgeConfig,
  ContentPillar,
  ContentRow,
  HookArchetype,
  PlatformId,
  PostStructure,
  TitlePattern,
} from "@/lib/types";

const HOOK_ARCHETYPES: ReadonlyArray<HookArchetype> = [
  "confession",
  "contrarian",
  "single-number",
  "you-callout",
  "cold-open",
];

const TITLE_PATTERNS: ReadonlyArray<TitlePattern> = [
  "how-to",
  "number-list",
  "question",
  "contrarian",
  "story",
];

const TITLE_PATTERN_HINTS: Record<TitlePattern, string> = {
  "how-to":
    "Frame it as a practical how-to (a clear technique), not a personal 'how I did X' claim.",
  "number-list":
    "Frame it as a number-led title (e.g. '3 things...', '5 reasons...').",
  "question": "Frame it as a direct question the reader is already asking.",
  "contrarian":
    "Frame it as a contrarian claim that challenges a common belief.",
  "story":
    "Frame it as an observation of a common situation the reader will recognize.",
};

// Similarity above this between a new hook/closer and a recent one triggers a
// one-time regeneration in Agent 2.
const OVERLAP_THRESHOLD = 0.7;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function appendLog(existing: string, entry: string): string {
  const line = `[${nowIso()}] ${entry}`;
  return existing && existing.trim().length > 0
    ? `${existing}\n${line}`
    : line;
}

function errToString(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

// --- Hashtag fallback ------------------------------------------------------
// The model sometimes omits the hashtag section entirely. These build a
// deterministic, on-brand set so LinkedIn's first-comment tags and the Instagram
// caption are never left empty.
function toHashtag(s: string): string {
  const camel = s
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join("");
  return camel ? `#${camel}` : "";
}

function buildFallbackHashtags(
  pillar: ContentPillar,
  topic: string,
  domain: ContentDomainConfig,
): string {
  const fromPillar = pillar.keywords.map(toHashtag);
  const universal = domain.hashtagUniverse.map(toHashtag);
  const fromTopic = topic
    .split(/\s+/)
    .filter((w) => w.length >= 5)
    .slice(0, 2)
    .map(toHashtag);
  const tags = [...fromPillar, ...fromTopic, ...universal].filter(
    (t) => t.length > 1,
  );
  return Array.from(new Set(tags)).slice(0, 5).join(" ");
}

function countHashes(text: string): number {
  return (text.match(/#/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// Rotation logic (from spec)
// ---------------------------------------------------------------------------

function selectPillar(
  pillars: ContentPillar[],
  lastUsed: string,
): ContentPillar {
  const available = pillars
    .filter((p) => p.id !== lastUsed)
    .sort((a, b) => b.weight - a.weight);
  return available[0] ?? pillars[0];
}

// A brand-new domain (before onboarding fills in real pillars) has none
// configured — this keeps the pipeline from crashing on an empty array. It
// should rarely be hit in practice since onboarding gates generation, but a
// defensive fallback is safer than an undefined pillar reaching the model.
const FALLBACK_PILLAR: ContentPillar = {
  id: "general",
  name: "General",
  weight: 1,
  keywords: [],
  toneHint: "a knowledgeable practitioner sharing what they've learned",
};

function pillarsOrFallback(domain: ContentDomainConfig): ContentPillar[] {
  return domain.pillars.length > 0 ? domain.pillars : [FALLBACK_PILLAR];
}

// Pick an option that is NOT in `recent`, chosen RANDOMLY among the fresh ones
// so re-running a day varies the structure/hook/title instead of deterministically
// returning the same first item. If every option was used recently, fall back to
// the least-recently used, preserving variety even after the pool is exhausted.
function pickAvoidingRecent<T>(
  pool: ReadonlyArray<T>,
  recent: ReadonlyArray<T>,
): T {
  const recentSet = new Set(recent);
  const fresh = pool.filter((item) => !recentSet.has(item));
  if (fresh.length > 0) {
    return randomPick(fresh) ?? fresh[0];
  }
  // All used recently: choose the least-recently used (earliest in `recent` is
  // oldest because `recent` is ordered newest-first).
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (pool.includes(recent[i])) {
      return recent[i];
    }
  }
  return randomPick(pool) ?? pool[0];
}

// ---------------------------------------------------------------------------
// Deepseek client
// ---------------------------------------------------------------------------

function makeDeepseekClient(ctx: RunContext): OpenAI {
  return new OpenAI({
    apiKey: ctx.creds.deepseekApiKey,
    baseURL: ctx.config.models.deepseekBaseUrl,
  });
}

function isRateLimit(err: unknown): boolean {
  if (err instanceof Error) {
    const status = (err as { status?: number }).status;
    if (status === 429) {
      return true;
    }
    return /429|rate limit/i.test(err.message);
  }
  return false;
}

function isTimeout(err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code ?? "";
    return (
      /timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(err.message) ||
      /ETIMEDOUT|ECONNRESET/.test(code)
    );
  }
  return false;
}

// A single Deepseek call with 429 (10s) and timeout (5s) retry-once handling.
async function deepseekCall(
  client: OpenAI,
  config: ContentForgeConfig,
  systemPrompt: string,
  fewShot: Array<{ role: "user" | "assistant"; content: string }>,
  userPrompt: string,
  temperature: number,
  seed?: number,
): Promise<string> {
  const run = async (): Promise<string> => {
    const completion = await client.chat.completions.create({
      model: config.models.deepseekModel,
      max_tokens: config.models.maxTokensPerCall,
      temperature,
      ...(seed !== undefined ? { seed } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        ...fewShot,
        { role: "user", content: userPrompt },
      ],
    });
    const content = completion.choices[0]?.message?.content ?? "";
    return content.trim();
  };

  try {
    return await run();
  } catch (err) {
    if (isRateLimit(err)) {
      logger.warn("[Deepseek] 429 rate limit — waiting 10s then retrying once");
      await delay(10_000);
      return run();
    }
    if (isTimeout(err)) {
      logger.warn("[Deepseek] timeout — retrying once after 5s");
      await delay(5_000);
      return run();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Section parsing helpers
// ---------------------------------------------------------------------------

function splitOnMarker(text: string, marker: string): [string, string] {
  const idx = text.indexOf(marker);
  if (idx === -1) {
    return [text.trim(), ""];
  }
  return [
    text.slice(0, idx).trim(),
    text.slice(idx + marker.length).trim(),
  ];
}

function extractMarkerBlocks(
  text: string,
  markers: string[],
): Record<string, string> {
  // Builds a map marker -> content until the next known marker.
  const result: Record<string, string> = {};
  const positions: Array<{ marker: string; index: number }> = [];
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index !== -1) {
      positions.push({ marker, index });
    }
  }
  positions.sort((a, b) => a.index - b.index);
  for (let i = 0; i < positions.length; i += 1) {
    const current = positions[i];
    const start = current.index + current.marker.length;
    const end =
      i + 1 < positions.length ? positions[i + 1].index : text.length;
    result[current.marker] = text.slice(start, end).trim();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Brief details (reader persona + canonical facts)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Pull the first {...} JSON object out of a model response (tolerates fences).
function extractJsonObject(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start !== -1 && end > start ? t.slice(start, end + 1) : t;
}

interface BriefDetails {
  readerPersona: string;
  canonicalFacts: string[];
}

function coerceBriefDetails(value: unknown, hasMaterial: boolean): BriefDetails {
  const readerPersona =
    isRecord(value) && typeof value.readerPersona === "string"
      ? value.readerPersona.trim()
      : "";
  let canonicalFacts: string[] = [];
  // Facts are only trusted when they came from real source material.
  if (hasMaterial && isRecord(value) && Array.isArray(value.canonicalFacts)) {
    canonicalFacts = value.canonicalFacts
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .map((f) => f.trim())
      .slice(0, 5);
  }
  return { readerPersona, canonicalFacts };
}

// One small Deepseek call: derive the single reader persona and (only when the
// author supplied real material) the canonical facts every platform must reuse.
async function generateBriefDetails(
  client: OpenAI,
  config: ContentForgeConfig,
  domain: ContentDomainConfig,
  prompts: AgentPrompts,
  topic: string,
  pillar: ContentPillar,
  material: string | null,
  seed?: number,
): Promise<BriefDetails> {
  const materialBlock = material
    ? `Real source material from the author. Extract canonical facts ONLY from this — never invent:\n"""\n${material}\n"""`
    : `No source material was provided. Return an EMPTY canonicalFacts array. Do not invent numbers, names, times, or metrics.`;

  const prompt = `${buildBrandIntro(domain.brand)}
You are preparing a content brief for this brand.
Topic: "${topic}"
Pillar: ${pillar.name} (${pillar.toneHint})

${materialBlock}

Return ONLY valid minified JSON (no markdown) with exactly these keys:
{"readerPersona":"<one specific reader this post is for, e.g. 'a two-years-in practitioner eyeing a senior role'>","canonicalFacts":["<short reusable fact with the concrete specifics>"]}
Rules:
- readerPersona names ONE person, never "everyone" or a generic audience label.
- canonicalFacts: 0 to 5 short strings, and ONLY facts taken from the source material. If none was provided, return [].`;

  // Append the operator-configurable brief block (RICE-POT). Empty block leaves
  // the prompt byte-identical to today's.
  const promptsBrief = prompts.brief;
  const promptFull = [prompt, renderBlock(promptsBrief)]
    .filter((s) => s.trim().length > 0)
    .join("\n\n");

  try {
    const completion = await client.chat.completions.create({
      model: config.models.deepseekModel,
      max_tokens: config.models.maxTokensPerCall,
      temperature: config.models.temperatureBrief,
      ...(seed !== undefined ? { seed } : {}),
      messages: [{ role: "user", content: promptFull }],
    });
    const raw = (completion.choices[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(extractJsonObject(raw)) as unknown;
    return coerceBriefDetails(parsed, material !== null);
  } catch (err) {
    logger.warn(
      `[Agent1] brief-details generation failed (${errToString(err)}) — using minimal brief`,
    );
    return { readerPersona: "", canonicalFacts: [] };
  }
}

// ---------------------------------------------------------------------------
// Agent 1 — Topic Generator
// ---------------------------------------------------------------------------

export async function agent1TopicGenerator(
  ctx: RunContext = createLocalContext(),
): Promise<void> {
  checkStop();
  await ctx.excel.ensureFileExists();
  const config = ctx.config;
  const domain = ctx.domain;
  // The run targets ctx.targetDate when regenerating a past day, else today.
  const date = ctx.targetDate ?? todayString();
  const runDay = ctx.targetDate ? new Date(`${ctx.targetDate}T12:00:00`) : new Date();
  const window = config.recentHistoryWindow;

  // The weekday theme drives the day's topic + which learnings to pull. It maps
  // onto an existing pillar; fall back to weighted rotation if the map is off.
  // Folder mode supplies the theme via ctx; local mode resolves it from the
  // weekday config. themeDay is only meaningful for local mode.
  const localTheme = themeForDay(runDay);
  const theme = ctx.theme ?? localTheme.theme;
  const themeDay = ctx.theme ? "" : localTheme.day;
  const domainPillars = pillarsOrFallback(domain);
  const pillar =
    domainPillars.find((p) => p.id === theme.pillar) ??
    selectPillar(domainPillars, config.lastUsedPillar);

  // Folder mode passes prior generations through ctx.history; local mode has none.
  const history = ctx.history ?? [];

  const existingRows = await ctx.excel.readAllRows();
  const existingTopics = existingRows
    .map((r) => r.topic)
    .filter((t) => t.trim().length > 0)
    .concat(history.map((h) => h.topic).filter((t) => t.trim().length > 0));

  // Variety history: recent structures from the sheet, recent hook/title
  // patterns + knowledge sources from brief sidecars (newest first).
  const recentRows = [...existingRows]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, window);
  const recentStructures = recentRows
    .map((r) => r.postStructure)
    .concat(history.map((h) => h.structure as PostStructure));
  const recentBriefs = await ctx.briefStore.readRecent(window);
  const recentHooks = recentBriefs
    .map((b) => b.hookArchetype)
    .concat(history.map((h) => h.hookArchetype as HookArchetype));
  const recentTitlePatterns = recentBriefs.map((b) => b.titlePattern);
  const recentSourceIds = recentBriefs
    .map((b) => b.knowledgeSourceId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const recentTitleOpeners = recentRows
    .map((r) => r.topic.split(/\s+/).slice(0, 4).join(" "))
    .filter((t) => t.trim().length > 0);

  // Grounding material. Folder mode grounds directly via ctx.material (resolved
  // in the browser from the user's knowledge/ folder), bypassing all filesystem
  // sources. Local mode resolves material, in priority order:
  //  1. an explicit data/input/<date>.md the author dropped, else
  //  2. a relevant excerpt retrieved from the learnings knowledge index,
  // plus the author's KNOWLEDGE.md quick-reference as supplementary context.
  let inputMaterial: string | null = null;
  let knowledgeSourceId: string | undefined;
  let knowledgeMaterial = "";
  let material: string | null;
  let hasRealMaterial: boolean;
  // Author/folder material specifically (NOT web-research). Stays false when the
  // brief is grounded only by the web-research override below, so the truthfulness
  // guardrails (no fabricated personal events) still apply to research-only days.
  let hasAuthorMaterial: boolean;

  if (ctx.material !== undefined) {
    // Folder mode: the browser already resolved the grounding text.
    material = ctx.material;
    hasRealMaterial = ctx.material.trim().length > 0;
    hasAuthorMaterial = ctx.material.trim().length > 0;
  } else {
    inputMaterial = await readInputMaterial(date);
    if (config.knowledge.enabled && !inputMaterial) {
      const src = await retrieveForTheme(
        theme.keywords,
        theme.learningTags,
        recentSourceIds,
      );
      if (src && src.entry.charCount >= 120) {
        knowledgeSourceId = src.entry.id;
        knowledgeMaterial = `From my notes — "${src.entry.title}":\n${src.entry.excerpt}`;
        logger.info(
          `[Agent1] knowledge source: ${src.entry.title} (score ${src.score})`,
        );
      }
    }
    const quickNotes = config.knowledge.enabled
      ? await readKnowledgeNotes(config.knowledge.folder)
      : null;

    const materialParts: string[] = [];
    if (inputMaterial) materialParts.push(inputMaterial);
    else if (knowledgeMaterial) materialParts.push(knowledgeMaterial);
    if (quickNotes) materialParts.push(`Author quick-reference notes:\n${quickNotes}`);
    material = materialParts.length > 0 ? materialParts.join("\n\n---\n\n") : null;
    hasRealMaterial = inputMaterial !== null || knowledgeMaterial.length > 0;
    // Captured BEFORE the web-research override so author material is tracked
    // independently of research-only grounding.
    hasAuthorMaterial = inputMaterial !== null || knowledgeMaterial.length > 0;
  }

  // Force structure, hook archetype, and title pattern to differ from recent
  // history, chosen randomly among the fresh options (see pickAvoidingRecent) so
  // a re-run varies them. single-number needs a real number, so drop it without
  // material.
  const structure = pickAvoidingRecent(config.postStructures, recentStructures);
  const hookPool = hasRealMaterial
    ? HOOK_ARCHETYPES
    : HOOK_ARCHETYPES.filter((h) => h !== "single-number");
  const hookArchetype = pickAvoidingRecent(hookPool, recentHooks);
  const titlePattern = pickAvoidingRecent(TITLE_PATTERNS, recentTitlePatterns);

  // Per-run entropy so the topic prompt differs every run even with identical
  // inputs — the core fix for "re-running produces the same content".
  const runSeed = makeRunSeed();
  const angle = randomPick(ANGLE_LENSES) ?? "";

  logger.info(
    `[Agent1] Theme: ${themeDay}/${theme.theme} | Pillar: ${pillar.id} | Structure: ${structure} | Hook: ${hookArchetype} | Title: ${titlePattern} | Source: ${knowledgeSourceId ?? (inputMaterial ? "input-file" : "none")}`,
  );

  const groundingSnippet = (
    knowledgeMaterial ||
    inputMaterial ||
    (ctx.material ?? "") ||
    ""
  ).slice(0, 700);
  // Shuffle the keyword pool and take a rotating subset so the prompt text — and
  // thus the chosen topic — differs run to run.
  const allKeywords = Array.from(
    new Set([...theme.keywords, ...pillar.keywords, ...theme.learningTags]),
  );
  const shuffledKeywords = shuffle(allKeywords);
  const themeKeywords = shuffledKeywords
    .slice(0, Math.max(4, Math.ceil(shuffledKeywords.length * 0.7)))
    .join(", ");

  const topicPrompt = `
${buildBrandIntro(domain.brand)}
Acting as the content strategist for this brand, pick today's topic.
Today's theme: ${theme.theme}
Pillar tone: ${pillar.toneHint}
Keywords to draw from: ${themeKeywords}
Fresh angle for THIS topic (use it to find a take you have not used before): ${angle}
Already covered (do not repeat or closely paraphrase): ${existingTopics.join(" | ")}
Recent title openings to AVOID reusing: ${recentTitleOpeners.join(" | ") || "none"}
${groundingSnippet ? `\nBase the topic on this real note from the author's learnings (find an angle, do not copy it verbatim):\n"""\n${groundingSnippet}\n"""\n` : ""}
Title style for today: ${TITLE_PATTERN_HINTS[titlePattern]}
Do NOT start the title with "Why Your" or "Why" — those openings are overused.
Do NOT put invented specific numbers, salaries, percentages, or dollar amounts in the title — keep the title honest and credible (a small count like "3" for a list is fine).
Do NOT frame the title as a personal event the author may not have had (an interview you ran, a thing you shipped, a meeting you were in) unless it is grounded in real material. Prefer a problem, lesson, or question framing.

Generate ONE specific, engaging topic title.
Bad example (too generic, no angle): "${pillar.name}"
Good example (specific, has a take): "The Approach That Works Right Up Until It Doesn't"
Return ONLY the topic title. No explanation. No punctuation at end. No quotes.
(variation key: ${runSeed})
`.trim();

  // Append the operator-configurable topic block (RICE-POT). Empty block leaves
  // the prompt byte-identical to today's.
  const prompts = ctx.prompts;
  const topicPromptFull = [topicPrompt, renderBlock(prompts.topic)]
    .filter((s) => s.trim().length > 0)
    .join("\n\n");

  const client = makeDeepseekClient(ctx);

  const generateAndValidate = async (): Promise<string> => {
    const completion = await client.chat.completions.create({
      model: config.models.deepseekModel,
      max_tokens: config.models.maxTokensPerCall,
      temperature: config.models.temperatureTopic,
      seed: runSeed,
      messages: [{ role: "user", content: topicPromptFull }],
    });
    let topic = (completion.choices[0]?.message?.content ?? "").trim();
    // Strip surrounding quotes and trailing punctuation.
    topic = topic.replace(/^["'`]+|["'`]+$/g, "").trim();
    topic = topic.replace(/[.!?]+$/g, "").trim();

    if (topic.length === 0) {
      throw new Error("Generated topic was empty");
    }
    if (topic.length >= 100) {
      throw new Error(`Generated topic too long (${topic.length} chars)`);
    }
    const duplicate = existingTopics.some(
      (t) => t.trim().toLowerCase() === topic.toLowerCase(),
    );
    if (duplicate) {
      throw new Error("Generated topic duplicates an existing topic");
    }
    return topic;
  };

  let topic: string;
  try {
    topic = await generateAndValidate();
  } catch (firstErr) {
    logger.warn(
      `[Agent1] First attempt failed (${errToString(firstErr)}) — retrying in 5s`,
    );
    await delay(5_000);
    try {
      topic = await generateAndValidate();
    } catch (secondErr) {
      logger.error("[Agent1] Topic generation failed on retry", secondErr);
      // Record an error row so the pipeline state is visible.
      const existingToday = await ctx.excel.getRowForDate(date);
      if (existingToday) {
        await ctx.excel.updateRow(date, {
          status: "Error",
          errorMessage: `Agent 1 failed: ${errToString(secondErr)}`,
          lastUpdated: nowIso(),
          agentLog: appendLog(
            existingToday.agentLog,
            `Agent 1 → topic generation failed: ${errToString(secondErr)}`,
          ),
        });
      } else {
        await ctx.excel.appendRow({
          date,
          topic: "",
          pillar: pillar.id,
          postStructure: structure,
          status: "Error",
          errorMessage: `Agent 1 failed: ${errToString(secondErr)}`,
          lastUpdated: nowIso(),
          agentLog: appendLog(
            "",
            `Agent 1 → topic generation failed: ${errToString(secondErr)}`,
          ),
        });
      }
      throw secondErr;
    }
  }

  logger.info(`[Agent1] Topic: "${topic}"`);

  // Research & analyze: pull real, cite-able context for the chosen topic and
  // combine it with the author's material so the brief's canonical facts are
  // REAL (not invented). No search key → skip → honest general mode downstream.
  let groundingMaterial = material;
  const research = await webResearch({
    apiKey: ctx.creds.tavilyApiKey ?? process.env.TAVILY_API_KEY,
    topic,
    keywords: shuffledKeywords,
  });
  if (research && research.context.trim().length > 0) {
    groundingMaterial = [
      material,
      `Web research findings for "${topic}" (real, cite-able specifics only — do not invent beyond these):\n${research.context}`,
    ]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .join("\n\n---\n\n");
    hasRealMaterial = true;
    logger.info(
      `[Agent1] web research grounded the brief from ${research.sources.length} source(s)`,
    );
  }

  // Build and persist the canonical brief — the single source of truth Agent 2
  // reads so every platform reuses the same facts/persona/hook.
  const details = await generateBriefDetails(
    client,
    config,
    domain,
    prompts,
    topic,
    pillar,
    groundingMaterial,
    runSeed + 1,
  );
  // The single-number hook is only honest when a real, groundable number exists.
  // The hook is chosen before the canonical facts are known, so re-validate here:
  // if no canonical fact carries a digit, downgrade the hook so the model is not
  // pushed to invent a statistic to satisfy the opening.
  let resolvedHook = hookArchetype;
  if (
    resolvedHook === "single-number" &&
    !details.canonicalFacts.some((f) => /\d/.test(f))
  ) {
    resolvedHook = "contrarian";
    logger.info(
      "[Agent1] single-number hook downgraded to contrarian (no numeric canonical fact)",
    );
  }

  const brief: ContentBrief = {
    date,
    topic,
    pillar: pillar.id,
    postStructure: structure,
    hookArchetype: resolvedHook,
    titlePattern,
    readerPersona: details.readerPersona,
    canonicalFacts: details.canonicalFacts,
    hasRealMaterial,
    hasAuthorMaterial,
    themeId: themeDay,
    knowledgeSourceId,
  };
  await ctx.briefStore.write(brief);
  logger.info(
    `[Agent1] Brief: reader="${brief.readerPersona}" | facts=${brief.canonicalFacts.length}`,
  );

  const agentLog = appendLog(
    "",
    `Agent 1 → Topic: "${topic}" | Pillar: ${pillar.id} | Structure: ${structure} | Hook: ${resolvedHook} | Facts: ${brief.canonicalFacts.length}`,
  );

  // If a row already exists for this run's date (e.g. previous Error), update it;
  // otherwise append a fresh Pending row. Must use the run date (ctx.targetDate),
  // NOT server-UTC today, or a timezone offset makes this match the wrong row and
  // the update no-ops — leaving Agent 2 with no row to write.
  const existingToday = await ctx.excel.getRowForDate(date);
  if (existingToday) {
    await ctx.excel.updateRow(date, {
      topic,
      pillar: pillar.id,
      postStructure: structure,
      status: "Pending",
      errorMessage: "",
      lastUpdated: nowIso(),
      agentLog: appendLog(existingToday.agentLog, `Agent 1 → Topic: "${topic}"`),
    });
  } else {
    await ctx.excel.appendRow({
      date,
      topic,
      pillar: pillar.id,
      postStructure: structure,
      status: "Pending",
      lastUpdated: nowIso(),
      agentLog,
    });
  }

  // Persist rotation state back to config.
  config.lastUsedPillar = pillar.id;
  config.lastUsedStructure = structure;
  await ctx.persistConfig(config);
}

// ---------------------------------------------------------------------------
// Agent 2 — Content Writer
// ---------------------------------------------------------------------------

interface PlatformResult {
  updates: Partial<ContentRow>;
  logEntry: string;
}

export interface Agent2Result {
  /** Display names of platforms that failed this call. */
  failed: string[];
  /** Enabled, not-yet-written platforms this call didn't get to (capped by
   *  `maxNewPlatforms`). 0 means every enabled platform was attempted. */
  remaining: number;
}

export async function agent2ContentWriter(
  ctx: RunContext = createLocalContext(),
  opts?: { maxNewPlatforms?: number },
): Promise<Agent2Result> {
  const config = ctx.config;
  const domain = ctx.domain;
  const date = ctx.targetDate ?? todayString();

  const row = await ctx.excel.getRowForDate(date);
  if (!row) {
    throw new Error(`Agent 2: no row found for ${date}`);
  }

  const domainPillars = pillarsOrFallback(domain);
  const pillar =
    domainPillars.find((p) => p.id === row.pillar) ?? domainPillars[0];
  const structure = row.postStructure;
  const topic = row.topic;
  const mediumSlugSeed = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);

  // The canonical brief is the single source of truth so every platform reuses
  // the same persona/facts/hook. Fall back to safe defaults if it is missing.
  const brief = await ctx.briefStore.read(date);
  // Folder mode supplies the voice via ctx; local mode resolves it by weekday.
  const brandVoice =
    ctx.voice ??
    voiceForDay(ctx.targetDate ? new Date(`${ctx.targetDate}T12:00:00`) : new Date())
      .voice;
  // Operator-configurable content block (RICE-POT) layered into the system prompt
  // via buildSystemPrompt. Empty fields leave the prompt byte-identical.
  const prompts = ctx.prompts;
  const promptOpts: SystemPromptOptions = {
    hookArchetype: brief?.hookArchetype ?? "cold-open",
    readerPersona: brief?.readerPersona ?? "",
    canonicalFacts: brief?.canonicalFacts ?? [],
    hasRealMaterial: brief?.hasRealMaterial ?? false,
    hasAuthorMaterial: brief?.hasAuthorMaterial ?? brief?.hasRealMaterial ?? false,
    brandVoice,
    brandIdentity: buildBrandIntro(domain.brand),
    instructionsText: formatLines(prompts.content.instructions),
    parametersText: formatLines(prompts.content.parameters),
    toneText: prompts.content.tone,
    voiceSamples: domain.voiceSamples,
  };
  logger.info(`[Agent2] Brand voice: ${brandVoice.name}`);

  // Recent posts (newest first, excluding today) to compare hooks/closers
  // against — drives the anti-repetition self-check below.
  const allRows = await ctx.excel.readAllRows();
  const priorPosts = allRows
    .filter((r) => r.date !== date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5);
  // Folder mode also feeds prior generations' hooks/closers into the check.
  const history = ctx.history ?? [];
  const priorHooks = priorPosts
    .flatMap((p) => [firstLine(p.linkedin), firstLine(p.instagram)])
    .concat(history.map((h) => h.hook))
    .filter((s) => s.trim().length > 0);
  const priorClosers = priorPosts
    .map((p) => lastLine(p.linkedin))
    .concat(history.map((h) => h.closer))
    .filter((s) => s.trim().length > 0);

  const client = makeDeepseekClient(ctx);
  const fewShot = buildFewShotMessages(
    pillar,
    promptOpts.hasAuthorMaterial ?? false,
    domain.voiceSamples,
  );

  // Track accumulated agentLog locally.
  let agentLog = row.agentLog;

  // Mark Writing before first call.
  await ctx.excel.updateRow(date, {
    status: "Writing",
    errorMessage: "",
    lastUpdated: nowIso(),
  });

  const callPlatform = async (
    platformName: string,
    userPrompt: string,
  ): Promise<string> => {
    const systemPrompt = buildSystemPrompt(
      pillar,
      structure,
      platformName,
      promptOpts,
    );
    // A fresh seed per call adds entropy so re-runs (and the freshness retry
    // below) produce genuinely different drafts rather than the same text.
    return deepseekCall(
      client,
      config,
      systemPrompt,
      fewShot,
      userPrompt,
      config.models.temperatureContent,
      makeRunSeed(),
    );
  };

  // Self-check: if a draft's opening (and, for LinkedIn, its closing) line is
  // too close to a recent post, regenerate ONCE with an explicit avoid list.
  // Returns the raw response to use (fresh one when it helped, original else).
  const ensureFresh = async (
    platformName: string,
    basePrompt: string,
    raw: string,
    extractBody: (r: string) => string,
    checkCloser: boolean,
  ): Promise<string> => {
    if (priorPosts.length === 0 && history.length === 0) {
      return raw;
    }
    const body = extractBody(raw);
    const hookSim = maxSimilarity(firstLine(body), priorHooks);
    const closerSim = checkCloser
      ? maxSimilarity(lastLine(body), priorClosers)
      : 0;
    if (hookSim <= OVERLAP_THRESHOLD && closerSim <= OVERLAP_THRESHOLD) {
      return raw;
    }
    const avoid = Array.from(
      new Set([...priorHooks, ...(checkCloser ? priorClosers : [])]),
    )
      .filter((s) => s.length > 0)
      .slice(0, 8);
    logger.info(
      `Agent 2 → ${platformName} too similar to recent (hook ${hookSim.toFixed(2)}, closer ${closerSim.toFixed(2)}) — regenerating once`,
    );
    agentLog = appendLog(
      agentLog,
      `Agent 2 → ${platformName} regenerated for freshness (hook ${hookSim.toFixed(2)}, closer ${closerSim.toFixed(2)})`,
    );
    const directive = `\n\nIMPORTANT: Your opening line and closing line must NOT resemble any of these recent lines. Rephrase completely with a different angle:\n${avoid.map((s) => `- ${s}`).join("\n")}`;
    return callPlatform(platformName, basePrompt + directive);
  };

  // The five platform builders, in fixed order. `done` lets a re-run for the
  // same date skip platforms whose content was already written (resume).
  const allPlatforms: Array<{
    id: PlatformId;
    name: string;
    done: boolean;
    run: () => Promise<PlatformResult>;
  }> = [
    {
      id: "linkedin",
      name: "LinkedIn",
      done: row.linkedin.trim().length > 0,
      run: async () => {
        const prompt = `Write a LinkedIn post about: "${topic}"
Post structure: ${structure}
Length: 150-200 words
Shape the post in this flow:
- Open with a contrarian or hook one-liner (the assigned HOOK archetype).
- State the problem the reader actually faces.
- Deliver ONE clear insight — the single idea this post is about.
- Give a single grouped list of 3-4 directives, each line prefixed with "→" (exactly one arrow list — do not scatter arrows elsewhere).
- Add a CTA.
- Close with an engagement question.
Rules:
- Post body must contain ZERO hashtags. Hashtags go in a separate field.
- Do NOT claim a personal event (an interview you ran, a thing you shipped, a meeting you attended) unless it is grounded in the canonical facts.
- Use only the canonical facts from your instructions. Invent no new specifics.
- End with a fresh closing line that invites a reply or reflection. Do NOT use a "PS:" template or "Save this".
Return two sections separated by "---HASHTAGS---":
Section 1: the post body
Section 2: exactly 5 relevant hashtags (topical to "${pillar.name}", not generic)`;
        const raw0 = await callPlatform("LinkedIn", prompt);
        const raw = await ensureFresh(
          "LinkedIn",
          prompt,
          raw0,
          (r) => splitOnMarker(r, "---HASHTAGS---")[0],
          true,
        );
        const [body, hashtags] = splitOnMarker(raw, "---HASHTAGS---");
        // The model often drops the hashtag section — backfill a branded set so
        // the first-comment hashtags are never empty.
        const finalHashtags =
          countHashes(hashtags) >= 3
            ? hashtags.trim()
            : buildFallbackHashtags(pillar, topic, domain);
        return {
          updates: { linkedin: body, linkedinHashtags: finalHashtags },
          logEntry: `Agent 2 → LinkedIn written (${countWords(body)} words)`,
        };
      },
    },
    {
      id: "medium",
      name: "Medium",
      done: row.medium.trim().length > 0,
      run: async () => {
        const prompt = `Write a Medium article about: "${topic}"
Length: ~3000 words, Markdown format
Shape the article in this flow:
- Open with a provocative, quotable one-line statement.
- Name the audience explicitly and early (who this is for).
- Move from the surface problem into the deeper problem beneath it.
- Deliver a numbered or layered framework, each part under a descriptive H2.
- Write in the second person; use collective framing ("we", "teams") — no personal war stories.
Rules:
- No filler headings ("Introduction", "Conclusion") — use descriptive H2s
- At least one real-world scenario grounded in ${pillar.name} work (a recognizable situation, not a claimed personal event)
Return five sections separated by these exact markers:
---TITLE---
[creative headline]
---SLUG---
[seo-url-slug-hyphenated-lowercase]
---SUBTITLE---
[one descriptive sentence that names the audience and the framework this article delivers]
---METADESC---
[155 char SEO meta description]
---BODY---
[full article markdown]`;
        const raw = await callPlatform("Medium", prompt);
        const blocks = extractMarkerBlocks(raw, [
          "---TITLE---",
          "---SLUG---",
          "---SUBTITLE---",
          "---METADESC---",
          "---BODY---",
        ]);
        const slug = (blocks["---SLUG---"] ?? mediumSlugSeed)
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-");
        const body = blocks["---BODY---"] ?? raw;
        return {
          updates: {
            medium: body,
            mediumTitle: blocks["---TITLE---"] ?? "",
            mediumSlug: slug || mediumSlugSeed,
            mediumSubtitle: blocks["---SUBTITLE---"] ?? "",
            mediumMetaDesc: blocks["---METADESC---"] ?? "",
          },
          logEntry: `Agent 2 → Medium written (${countWords(body)} words)`,
        };
      },
    },
    {
      id: "instagram",
      name: "Instagram",
      done: row.instagram.trim().length > 0,
      run: async () => {
        const prompt = `Write an Instagram caption about: "${topic}"
Caption structure:
Line 1: Hook using the assigned HOOK archetype (one punchy line, shown before "...more")
Blank line
Lines 2-8: Content, single lines, max 2 sentences each, blank line between each
Blank line
CTA line: invite a reply or a specific action that fits THIS post. Vary the wording. Do NOT write "Save this" or reuse a generic CTA.
Blank line
5 hashtags on the final line
Rules: use only the canonical facts from your instructions; invent no new specifics.
Total length: 150-250 words

After the caption, on its own line output the marker "---CAROUSEL---" followed by 4 to 6 lines of carousel slide copy. Each line must be formatted exactly "Heading :: one-sentence body". The first line is the cover hook, the middle lines are one concept each, and the final line is a CTA slide. Keep headings short (max ~6 words) and bodies to one sentence.`;
        const raw0 = await callPlatform("Instagram", prompt);
        const raw = await ensureFresh(
          "Instagram",
          prompt,
          raw0,
          (r) => splitOnMarker(r, "---CAROUSEL---")[0],
          false,
        );
        // Split caption (before marker) from carousel slide copy (after).
        const [captionPart, carouselPart] = splitOnMarker(raw, "---CAROUSEL---");
        // Instagram captions rely on hashtags for reach — append a branded set
        // when the model didn't include any.
        const caption =
          countHashes(captionPart) >= 3
            ? captionPart
            : `${captionPart.trim()}\n\n${buildFallbackHashtags(pillar, topic, domain)}`;

        // Parse "Heading :: body" lines into carousel slides; ignore malformed.
        const slides = carouselPart
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => {
            const sep = line.indexOf(" :: ");
            if (sep === -1) {
              return null;
            }
            const heading = line.slice(0, sep).trim();
            const body = line.slice(sep + 4).trim();
            return heading.length > 0 && body.length > 0
              ? { heading, body }
              : null;
          })
          .filter((s): s is { heading: string; body: string } => s !== null);

        // Persist slides to the brief so Agent 3 can render the carousel. Excel
        // still only receives the caption — the 32-column schema is untouched.
        if (slides.length >= 2) {
          const currentBrief = await ctx.briefStore.read(date);
          if (currentBrief) {
            await ctx.briefStore.write({
              ...currentBrief,
              carouselSlides: slides,
            });
          }
        }

        return {
          updates: { instagram: caption },
          logEntry: `Agent 2 → Instagram written (${countWords(caption)} words)`,
        };
      },
    },
    {
      id: "youtube",
      name: "YouTube",
      done: row.youtube.trim().length > 0,
      run: async () => {
        const prompt = `Write a YouTube script about: "${topic}"
Structure with exact timestamp markers:
[00:00–00:30] Hook
[00:30–01:00] Intro
[01:00–08:00] Main content (add [B-ROLL SUGGESTION] markers)
[08:00–09:00] Recap
[09:00–09:30] Outro + subscribe CTA
Written as spoken word — natural, not robotic.
Return two sections separated by "---DESCRIPTION---":
Section 1: full script
Section 2: YouTube description with CHAPTERS block, keyword sentences, and "${domain.brand.handle}" at end
Also return three title options after "---TITLES---" (one per line):
Title 1: [number]-based format
Title 2: problem/solution format
Title 3: curiosity/question format`;
        const raw = await callPlatform("YouTube", prompt);

        // Titles block may sit after ---TITLES--- inside either section.
        let working = raw;
        let titlesBlock = "";
        const titlesIdx = working.indexOf("---TITLES---");
        if (titlesIdx !== -1) {
          titlesBlock = working.slice(titlesIdx + "---TITLES---".length).trim();
          working = working.slice(0, titlesIdx).trim();
        }
        const [script, description] = splitOnMarker(
          working,
          "---DESCRIPTION---",
        );

        const titleLines = titlesBlock
          .split("\n")
          .map((l) => l.replace(/^Title\s*\d+\s*:\s*/i, "").trim())
          .filter((l) => l.length > 0);

        return {
          updates: {
            youtube: script,
            youtubeTitle1: titleLines[0] ?? "",
            youtubeTitle2: titleLines[1] ?? "",
            youtubeTitle3: titleLines[2] ?? "",
            youtubeDescription: description,
          },
          logEntry: `Agent 2 → YouTube written (${countWords(script)} words)`,
        };
      },
    },
    {
      id: "devto",
      name: "Dev.to",
      done: row.devto.trim().length > 0,
      run: async () => {
        const prompt = `Write a dev.to article about: "${topic}"
Length: ~2000 words, Markdown with frontmatter
Frontmatter must be exactly:
---
title: "[article title]"
published: false
tags: [${(domain.devtoTags.length > 0 ? domain.devtoTags : pillar.keywords.slice(0, 4)).join(", ")}]
canonical_url: https://medium.com/@${domain.brand.mediumHandle}/${mediumSlugSeed}
cover_image: /api/images/${date}-medium.png
series: "${domain.brand.devtoSeries}"
---
Shape the article in this flow: problem → solution → technical detail → "what this teaches" → CTA.
Rules:
- At least one TypeScript or Python code snippet, runnable not pseudocode (keep it minimal)
- Technical depth: explain implementation, not just concept
- Rely on the tags frontmatter for discovery; do not stuff tags into the body
- Do NOT claim to have personally built a tool or product, and do NOT add paid-product CTAs, unless grounded in the canonical facts`;
        const raw = await callPlatform("Dev.to", prompt);
        return {
          updates: { devto: raw },
          logEntry: `Agent 2 → Dev.to written (${countWords(raw)} words)`,
        };
      },
    },
  ];

  // A disabled platform is skipped entirely — never called, and treated as
  // already "done" so it neither blocks progress nor gets retried on resume.
  const platforms = allPlatforms.filter((p) => domain.enabledPlatforms[p.id] !== false);

  // Progress spans 22 -> 78 across the enabled platforms.
  const PROGRESS_START = 22;
  const PROGRESS_END = 78;
  const total = platforms.length;
  let completed = 0;

  // Display names of platforms that failed this run. Returned so the caller can
  // surface a Retry; a non-empty list leaves status at "Writing".
  const failures: string[] = [];
  // First failure reason, reused in the post-loop summary message.
  let firstReason = "";
  // Caps how many NEW (not-already-done) platforms this call attempts, so a
  // stateless caller (folder mode's /api/generate) can run one platform per
  // request instead of all five in one long serverless invocation. Local mode
  // omits this and always runs every enabled platform in one pass.
  const cap = opts?.maxNewPlatforms ?? Infinity;
  let attempted = 0;
  let remaining = 0;

  for (const platform of platforms) {
    // Stop checkpoint between platforms (outside the per-platform try so a stop
    // is never mistaken for a content-generation failure).
    checkStop();

    if (platform.done) {
      // Resume: this platform was already written in a previous session.
      completed += 1;
      logger.info(`Agent 2 → ${platform.name} already done — skipping`);
      reportProgress(
        PROGRESS_START + ((PROGRESS_END - PROGRESS_START) * completed) / total,
        `Agent 2: ${platform.name} already done (${completed}/${total})`,
      );
      continue;
    }

    if (attempted >= cap) {
      // Cap reached — leave this (and any later) platform untouched for the
      // next call to pick up; row stays at "Writing" so it resumes here.
      remaining += 1;
      continue;
    }

    try {
      const result = await platform.run();
      agentLog = appendLog(agentLog, result.logEntry);
      // Write this platform's columns to Excel immediately.
      await ctx.excel.updateRow(date, {
        ...result.updates,
        agentLog,
        lastUpdated: nowIso(),
      });
      completed += 1;
      attempted += 1;
      logger.info(result.logEntry);
      reportProgress(
        PROGRESS_START + ((PROGRESS_END - PROGRESS_START) * completed) / total,
        `Agent 2: ${platform.name} written (${completed}/${total})`,
      );
    } catch (err) {
      if (err instanceof PipelineStoppedError) {
        // Leave status at "Writing" so a re-run resumes at this platform.
        throw err;
      }
      attempted += 1;
      const reason = errToString(err);
      const message = `Agent 2 failed at ${platform.name}: ${reason}`;
      // Resilient: log, record the failure, and continue with the rest.
      logger.error(message, err);
      agentLog = appendLog(agentLog, message);
      if (firstReason === "") {
        firstReason = reason;
      }
      failures.push(platform.name);
      continue;
    }
  }

  if (remaining > 0) {
    // Capped this call on purpose (not a failure) — row is already at
    // "Writing" with this call's progress persisted; the caller re-invokes
    // for the rest instead of treating this as done or errored.
    return { failed: failures, remaining };
  }

  if (failures.length === 0) {
    // All five written — advance to Imaging.
    await ctx.excel.updateRow(date, {
      status: "Imaging",
      lastUpdated: nowIso(),
      agentLog: appendLog(agentLog, "Agent 2 → all platforms written"),
    });
  } else {
    // Partial: leave status at "Writing" so a re-run resumes and the per-platform
    // `done` checks skip what already succeeded. Record what failed for Retry.
    const summary = `Wrote ${total - failures.length}/${total} platforms. Failed: ${failures.join(", ")}${firstReason ? " — " + firstReason : ""}. Re-run to retry the rest.`;
    await ctx.excel.updateRow(date, {
      status: "Writing",
      errorMessage: summary,
      agentLog: appendLog(agentLog, summary),
      lastUpdated: nowIso(),
    });
  }

  return { failed: failures, remaining: 0 };
}

// ---------------------------------------------------------------------------
// Agent 3 — Image Generator
// ---------------------------------------------------------------------------

function buildImagePrompt(
  topic: string,
  pillar: ContentPillar,
  ratio: string,
  brand: BrandConfig,
): string {
  const colors = brand.imageColors;
  const place = brand.location ? ` from ${brand.location}` : "";
  return `
Create a professional branded content card for this brand.
Brand: ${brand.name}${place}.
Topic: ${topic}
Visual style:
- Background: deep dark (${colors.background})
- Top-left: small text "${brand.name.toUpperCase()} | ${pillar.name.toUpperCase()}" in accent color (${colors.accent}) monospace
- Center: topic title in large bold text (${colors.text}) — the largest element
- Below title: one short insight or sub-headline in muted text (${colors.subtext})
- Bottom strip: 2–3 category pill badges with accent-color outline
- Bottom-right: "${brand.handle}" in small muted text
- No stock photos. No people. No complex illustrations. Clean and minimal.
- Accent: ${colors.accent}. Secondary accent: ${colors.secondaryAccent} for emphasis only.
Aspect ratio: ${ratio}
Return the image only.
  `.trim();
}

// Returns a human-readable warning string if any image failed, else null.
// Never throws for image problems — text content must never be hidden by a
// failed image. (Still throws PipelineStoppedError so a stop is honored.)
//
// Default engine ("template") renders deterministic branded PNGs whose headline
// is the post's actual hook line — no API key required. Setting models.imageEngine
// to "openai" restores AI image generation (and then needs OPENAI_API_KEY).
export async function agent3ImageGenerator(
  ctx: RunContext = createLocalContext(),
): Promise<string | null> {
  checkStop();
  const config = ctx.config;
  const domain = ctx.domain;
  const date = ctx.targetDate ?? todayString();
  const engine = config.models.imageEngine;

  const row = await ctx.excel.getRowForDate(date);
  if (!row) {
    throw new Error("Agent 3: no row found for today");
  }

  const domainPillars = pillarsOrFallback(domain);
  const pillar =
    domainPillars.find((p) => p.id === row.pillar) ?? domainPillars[0];
  const topic = row.topic;
  const colors = domain.brand.imageColors;

  // The card text is grounded in the shared brief (same store Agent 2 reads) so
  // the headline/subline match the published content and never invent specifics.
  const prompts = ctx.prompts;
  const brief = await ctx.briefStore.read(date);
  const card = deriveCardText({
    topic,
    facts: brief?.canonicalFacts ?? [],
    linkedinFirstLine: firstLine(row.linkedin),
    sublineSource: prompts.image.sublineSource,
    headlineMaxChars: prompts.image.headlineMaxChars,
  });
  const headline = card.headline;
  const kicker = `${domain.brand.name.toUpperCase()} | ${pillar.name.toUpperCase()}`;
  const subline = card.subline;

  // OpenAI client only when the AI image engine is explicitly selected.
  const apiKey = ctx.creds.openaiApiKey;
  let openaiClient: OpenAI | null = null;
  if (engine === "openai") {
    if (!apiKey || apiKey.trim().length === 0) {
      return "Images skipped — OPENAI_API_KEY is not set (models.imageEngine is 'openai').";
    }
    openaiClient = new OpenAI({ apiKey });
  }

  // Medium + LinkedIn render a single branded card each (unchanged). Instagram
  // is handled separately below so it can produce a multi-slide carousel. A
  // disabled platform gets no card at all.
  const allTargets: Array<{
    key: "imageMedium" | "imageLinkedin";
    platform: PlatformId;
    filename: string;
    width: number;
    height: number;
    ratio: string;
    size: "1024x1024" | "1536x1024" | "1024x1536";
  }> = [
    { key: "imageMedium", platform: "medium", filename: `${date}-medium.png`, width: 1200, height: 675, ratio: "1200x675 (16:9)", size: "1536x1024" },
    { key: "imageLinkedin", platform: "linkedin", filename: `${date}-linkedin.png`, width: 1200, height: 627, ratio: "1200x627", size: "1536x1024" },
  ];
  const targets = allTargets.filter((t) => domain.enabledPlatforms[t.platform] !== false);

  let agentLog = row.agentLog;
  const updates: Partial<ContentRow> = {};
  const failures: string[] = [];
  // Count of image outputs attempted (cards + each carousel slide) so the
  // summary warning reflects per-file outcomes.
  let totalImageCount = targets.length;

  for (const target of targets) {
    checkStop();

    // Resume: skip an image already present (local mode) from a prior session.
    const existingSize = await ctx.images.exists(target.filename);
    if (existingSize !== null && existingSize >= 5_000) {
      updates[target.key] = `/api/images/${target.filename}`;
      logger.info(`[Agent3] ${target.filename} already exists — skipping`);
      continue;
    }

    try {
      let buffer: Buffer;
      if (engine === "openai" && openaiClient) {
        const result = await openaiClient.images.generate({
          model: config.models.openaiImageModel,
          prompt: buildImagePrompt(topic, pillar, target.ratio, domain.brand),
          size: target.size,
          n: 1,
        });
        const base64 = result.data?.[0]?.b64_json ?? "";
        if (base64.length === 0) {
          throw new Error("OpenAI returned no image data");
        }
        buffer = Buffer.from(base64, "base64");
      } else {
        buffer = await renderCard({
          kicker,
          headline,
          subline,
          footerLeft: pillar.name,
          handle: domain.brand.handle,
          width: target.width,
          height: target.height,
          colors,
        });
      }

      if (buffer.length < 5_000) {
        throw new Error(`image too small (${buffer.length} bytes) — likely corrupt`);
      }
      const ref = await ctx.images.save(target.filename, buffer);

      updates[target.key] = ref;
      agentLog = appendLog(
        agentLog,
        `Agent 3 → ${target.filename} saved (${buffer.length} bytes, ${engine})`,
      );
      logger.info(`[Agent3] ${target.filename} saved (${buffer.length} bytes) via ${engine}`);
    } catch (err) {
      if (err instanceof PipelineStoppedError) {
        throw err;
      }
      const reason = errToString(err);
      failures.push(`${target.filename}: ${reason}`);
      agentLog = appendLog(agentLog, `Agent 3 → ${target.filename} failed: ${reason}`);
      logger.error(`[Agent3] ${target.filename} failed: ${reason}`);
    }
  }

  // Instagram: a multi-slide carousel via the template engine. With the openai
  // engine we keep generating a single 1:1 IG image as before (no carousel).
  // Skipped entirely when the domain has Instagram disabled.
  checkStop();
  if (domain.enabledPlatforms.instagram === false) {
    // no-op — disabled platform, no image work.
  } else if (engine === "openai" && openaiClient) {
    const igFilename = `${date}-ig-1.png`;
    const existingSize = await ctx.images.exists(igFilename);
    if (existingSize !== null && existingSize >= 5_000) {
      updates.imageInstagram = `/api/images/${igFilename}`;
      logger.info(`[Agent3] ${igFilename} already exists — skipping`);
    } else {
      try {
        const result = await openaiClient.images.generate({
          model: config.models.openaiImageModel,
          prompt: buildImagePrompt(topic, pillar, "1080x1080 (1:1)", domain.brand),
          size: "1024x1024",
          n: 1,
        });
        const base64 = result.data?.[0]?.b64_json ?? "";
        if (base64.length === 0) {
          throw new Error("OpenAI returned no image data");
        }
        const buffer = Buffer.from(base64, "base64");
        if (buffer.length < 5_000) {
          throw new Error(`image too small (${buffer.length} bytes) — likely corrupt`);
        }
        const ref = await ctx.images.save(igFilename, buffer);
        updates.imageInstagram = ref;
        agentLog = appendLog(
          agentLog,
          `Agent 3 → ${igFilename} saved (${buffer.length} bytes, ${engine})`,
        );
        logger.info(`[Agent3] ${igFilename} saved (${buffer.length} bytes) via ${engine}`);
      } catch (err) {
        if (err instanceof PipelineStoppedError) {
          throw err;
        }
        const reason = errToString(err);
        failures.push(`${igFilename}: ${reason}`);
        agentLog = appendLog(agentLog, `Agent 3 → ${igFilename} failed: ${reason}`);
        logger.error(`[Agent3] ${igFilename} failed: ${reason}`);
      }
    }
  } else {
    // Template engine: render an N-slide carousel grounded in the brief's slide
    // copy (falling back to deriving slides from the topic/facts/caption).
    const slides =
      brief?.carouselSlides && brief.carouselSlides.length > 0
        ? brief.carouselSlides
        : deriveCarouselSlides({
            topic,
            facts: brief?.canonicalFacts ?? [],
            instagramBody: row.instagram,
            handle: domain.brand.handle,
          });
    totalImageCount += slides.length;
    const refs: string[] = [];
    for (let i = 0; i < slides.length; i += 1) {
      checkStop();
      const slide = slides[i];
      const filename = `${date}-ig-${i + 1}.png`;
      const webRef = `/api/images/${filename}`;

      // Resume: skip a slide already present from a prior session.
      const existingSize = await ctx.images.exists(filename);
      if (existingSize !== null && existingSize >= 5_000) {
        refs.push(webRef);
        logger.info(`[Agent3] ${filename} already exists — skipping`);
        continue;
      }

      const kind: "cover" | "point" | "cta" =
        i === 0 ? "cover" : i === slides.length - 1 ? "cta" : "point";
      try {
        const buffer = await renderCarouselSlide({
          kind,
          index: i + 1,
          total: slides.length,
          kicker,
          heading: slide.heading,
          body: slide.body,
          handle: domain.brand.handle,
          colors,
          width: 1080,
          height: 1080,
        });
        if (buffer.length < 5_000) {
          throw new Error(`image too small (${buffer.length} bytes) — likely corrupt`);
        }
        const ref = await ctx.images.save(filename, buffer);
        refs.push(ref);
        agentLog = appendLog(
          agentLog,
          `Agent 3 → ${filename} saved (${buffer.length} bytes, ${engine})`,
        );
        logger.info(`[Agent3] ${filename} saved (${buffer.length} bytes) via ${engine}`);
      } catch (err) {
        if (err instanceof PipelineStoppedError) {
          throw err;
        }
        const reason = errToString(err);
        failures.push(`${filename}: ${reason}`);
        agentLog = appendLog(agentLog, `Agent 3 → ${filename} failed: ${reason}`);
        logger.error(`[Agent3] ${filename} failed: ${reason}`);
      }
    }
    // Store ALL generated slide refs as a JSON array string in the IG column.
    if (refs.length > 0) {
      updates.imageInstagram = JSON.stringify(refs);
    }
  }

  const noneSucceeded =
    Object.keys(updates).length === 0 && failures.length > 0;
  const openaiHint =
    engine === "openai"
      ? ` A 429 means OpenAI rate/quota limits; a 403 may mean your OpenAI organization needs verification to use ${config.models.openaiImageModel}.`
      : "";
  const warning =
    failures.length === 0
      ? null
      : noneSucceeded
        ? `Images could not be generated (${failures[0]}). Your text content is ready to publish.${openaiHint}`
        : `${failures.length} of ${totalImageCount} images could not be generated. Text content is ready to publish.`;

  // Text content is complete regardless of image outcome — mark Done so the
  // dashboard shows everything; record any image issue as a non-blocking note.
  await ctx.excel.updateRow(date, {
    ...updates,
    status: "Done",
    errorMessage: warning ?? "",
    agentLog: appendLog(
      agentLog,
      warning ? "Agent 3 → finished with image warnings" : "Agent 3 → all images generated",
    ),
    lastUpdated: nowIso(),
  });

  return warning;
}
