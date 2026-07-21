// lib/types.ts
// All shared interfaces and enums for ContentForge. No `any` anywhere.

export type StatusEnum =
  | "Pending"
  | "Writing"
  | "Imaging"
  | "Done"
  | "Error";

// A content pillar id is a free-form slug defined per-domain in
// content-domain.json (see ContentDomainConfig below) — not a fixed union, so
// any niche can define its own pillars.
export type PillarId = string;

// The 5 platforms the pipeline generates for. Fixed list (not user-extensible —
// see lib/domainConfig.ts), but a domain can enable/disable which ones run.
export type PlatformId = "linkedin" | "medium" | "instagram" | "youtube" | "devto";

export type PostStructure =
  | "story"
  | "contrast"
  | "hot-take"
  | "numbered-insight"
  | "question-led";

// The opening move of a post. Rotated independently of PostStructure so two
// posts with the same structure still open differently.
export type HookArchetype =
  | "confession" // an owned mistake / "I was wrong about X"
  | "contrarian" // a claim that pushes against the common belief
  | "single-number" // one concrete number that reframes the topic
  | "you-callout" // names the reader and their exact situation
  | "cold-open"; // drops the reader mid-scene with no setup

export type ImageEngine = "template" | "openai";

export type TitlePattern =
  | "how-to"
  | "number-list"
  | "question"
  | "contrarian"
  | "story";

// Lower-cased weekday keys used by the weekly theme + brand-voice rotation.
export type Weekday =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

// One weekday's content theme — drives topic selection. `knowledgeFiles` lists
// raw files inside the user's knowledge/ folder to ground that day's content in.
export interface WeeklyTheme {
  theme: string; // human label, e.g. "AI + Automation"
  keywords: string[]; // topic keywords
  pillar: PillarId; // maps onto the existing pillar system
  learningTags: string[]; // (local mode) tags to match in the my_learnings index
  knowledgeFiles?: string[]; // (folder mode) raw filenames in knowledge/
}

// One weekday's brand voice — layered on top of the universal VOICE_RULES.
export interface BrandVoice {
  name: string; // e.g. "The Mentor"
  persona: string; // a short paragraph describing the persona
  toneDirectives: string[]; // 3-4 concrete directives
}

// One weekday's full plan: theme + voice merged into a single editable unit
// (the user's weekly-plan.json is Record<Weekday, WeekdayPlan>).
export interface WeekdayPlan extends WeeklyTheme {
  voice: BrandVoice;
}

// One past generation, recorded in the user's generation-log.json so the agent
// avoids repeating topics/structures/hooks (no duplicate content on re-runs).
export interface GenerationLogEntry {
  date: string;
  topic: string;
  pillar: string;
  structure: string;
  hookArchetype: string;
  hook: string; // first line of the LinkedIn post
  closer: string; // last line of the LinkedIn post
}

// A single extracted source file in the knowledge index. Built by code/OCR —
// the raw file is never sent to the LLM, only `excerpt` when selected.
export interface KnowledgeEntry {
  id: string; // stable hash of relPath
  relPath: string; // path relative to the learnings folder
  title: string; // derived from folder path + filename
  folderTags: string[]; // lower-cased path segments, for matching
  type: string; // pdf | docx | xlsx | txt | md | image | pptx | doc
  keywords: string[]; // code-derived term-frequency keywords
  excerpt: string; // cleaned text excerpt (bounded length)
  charCount: number; // total extracted characters
  mtimeMs: number; // source mtime for incremental rebuilds
  ocrUsed: boolean;
  visionUsed: boolean;
  scanned: boolean; // image-only PDF with no extractable text
}

export interface KnowledgeIndexFile {
  builtAt: string;
  folder: string;
  entries: KnowledgeEntry[];
}

export interface KnowledgeConfig {
  enabled: boolean;
  folder: string; // relative to project root, default "my_learnings"
  ocrImages: boolean; // OCR jpg/png/jpeg via Tesseract (no tokens)
  ocrScannedPdfs: boolean; // rasterize + OCR image-only PDFs (heavier)
  visionFallback: boolean; // OpenAI vision when OCR can't read an image
  visionModel: string; // e.g. "gpt-4o-mini"
  maxOcrPages: number; // page cap for scanned-PDF OCR
  excerptChars: number; // bound on stored excerpt length
}

// One Instagram carousel slide's copy (heading + one-sentence body). Produced by
// Agent 2, consumed by Agent 3 to render the multi-slide carousel.
export interface CarouselSlide {
  heading: string;
  body: string;
}

/**
 * The single source of truth a day's content is built from. Produced by Agent 1,
 * consumed by Agent 2 so every platform reuses the SAME specifics (no more
 * contradictory invented numbers across LinkedIn/Medium/etc.). Persisted as a
 * sidecar JSON file (data/briefs/<date>.json) so the 32-column Excel schema is
 * left untouched.
 */
export interface ContentBrief {
  date: string;
  topic: string;
  pillar: PillarId;
  postStructure: PostStructure;
  hookArchetype: HookArchetype;
  titlePattern: TitlePattern;
  /** The one reader this post speaks to, e.g. "a 2-years-in manual tester". */
  readerPersona: string;
  /**
   * The handful of specifics every platform must reuse verbatim. Kept short so
   * the model cannot drift. Empty/sparse when no real material was provided.
   */
  canonicalFacts: string[];
  /** True when real material (input file OR a learnings excerpt) backed this brief. */
  hasRealMaterial: boolean;
  /** Weekday theme id this brief was generated under (e.g. "mon"). */
  themeId?: string;
  /** Knowledge index entry id used as grounding material, if any. */
  knowledgeSourceId?: string;
  /** True only when author/folder material backed this brief (not web-research-only). */
  hasAuthorMaterial?: boolean;
  /** Instagram carousel slide copy produced by Agent 2 for Agent 3 to render. */
  carouselSlides?: CarouselSlide[];
}

export interface ContentRow {
  // Core — Agent 1
  date: string; // Col A — YYYY-MM-DD
  topic: string; // Col B
  pillar: PillarId; // Col C
  postStructure: PostStructure; // Col D
  status: StatusEnum; // Col E

  // LinkedIn — Agent 2
  linkedin: string; // Col F — post body ~150-200 words
  linkedinHashtags: string; // Col G — for first comment, NOT post body

  // Medium — Agent 2
  medium: string; // Col H — full article ~3000 words Markdown
  mediumTitle: string; // Col I — creative headline
  mediumSlug: string; // Col J — SEO URL slug
  mediumSubtitle: string; // Col K — one-sentence kicker
  mediumMetaDesc: string; // Col L — 155-char SEO meta description

  // Instagram — Agent 2
  instagram: string; // Col M — full caption with hook+content+CTA+hashtags

  // YouTube — Agent 2
  youtube: string; // Col N — full script with timestamps
  youtubeTitle1: string; // Col O — title option 1
  youtubeTitle2: string; // Col P — title option 2
  youtubeTitle3: string; // Col Q — title option 3
  youtubeDescription: string; // Col R — full YT description with chapters

  // Dev.to — Agent 2
  devto: string; // Col S — full article ~2000 words with frontmatter

  // Images — Agent 3
  imageMedium: string; // Col T — /images/YYYY-MM-DD-medium.png
  imageLinkedin: string; // Col U — /images/YYYY-MM-DD-linkedin.png
  imageInstagram: string; // Col V — JSON array of carousel slide paths (or a single path); read via parseImagePaths

  // Meta — All agents
  agentLog: string; // Col W — timestamped log entries
  lastUpdated: string; // Col X — ISO timestamp
  errorMessage: string; // Col Y — populated on failure only

  // Agent 5 placeholders — empty in v1
  linkedinPublishStatus: string; // Col Z
  mediumPublishStatus: string; // Col AA
  instagramPublishStatus: string; // Col AB
  youtubePublishStatus: string; // Col AC
  devtoPublishStatus: string; // Col AD
  notifySentAt: string; // Col AE
  performanceNotes: string; // Col AF
}

export interface PipelineStatus {
  running: boolean;
  currentStep: string | null;
  lastUpdated: string | null;
}

export type ApiKeyHealth = "healthy" | "missing" | "invalid";

export interface StatusResponse {
  deepseek: ApiKeyHealth;
  openai: ApiKeyHealth;
  deepseekModel: string;
  openaiImageModel: string;
  pipelineRunning: boolean;
  currentStep: string | null;
  nextScheduledRun: string;
  lastRun: string | null;
  lastStatus: StatusEnum | null;
  streakDays: number;
  /** 0–100 progress of the current/last pipeline run. */
  progress: number;
  /**
   * The most recent error reason (from the live pipeline state, falling back to
   * the latest row's errorMessage when its status is "Error"). Lets the 3s poll
   * fallback surface *why* a run failed even if the live SSE error event was
   * missed. `null` when there is no current error.
   */
  errorMessage: string | null;
}

export interface ContentForgeConfig {
  scheduler: {
    cronSchedule: string;
    timezone: string;
  };
  models: {
    deepseekModel: string;
    openaiImageModel: string;
    deepseekBaseUrl: string;
    maxTokensPerCall: number;
    temperatureContent: number;
    temperatureTopic: number;
    // Brief/analysis call (Agent 1 brief details) — 0 = deterministic.
    temperatureBrief: number;
    /** "template" = deterministic branded PNG (default); "openai" = AI image model. */
    imageEngine: ImageEngine;
  };
  postStructures: PostStructure[];
  structureRotation: "sequential" | "random";
  pillarRotation: "weighted" | "sequential";
  /** How many recent days Agent 1 inspects to avoid repeating structure/hook. */
  recentHistoryWindow: number;
  lastUsedPillar: string;
  lastUsedStructure: string;
  platformPostingTimes: Record<string, string>;
  notifications: NotificationConfig;
  autoPost: AutoPostConfig;
  knowledge: KnowledgeConfig;
}

export interface ContentPillar {
  id: PillarId;
  name: string;
  weight: number;
  keywords: string[];
  toneHint: string;
}

export interface BrandConfig {
  name: string;
  handle: string;
  location: string;
  timezone: string;
  devtoSeries: string;
  mediumHandle: string;
  /** Optional expert-identity steering used in every agent prompt. */
  roles?: string;
  expertise?: string;
  mission?: string;
  imageColors: {
    background: string;
    accent: string;
    secondaryAccent: string;
    text: string;
    subtext: string;
  };
}

/**
 * A single reference post used to teach the model this domain's voice (the
 * few-shot layer). Pasted/edited by the user, or drafted once by AI-assist
 * from their niche description and then reviewed. Optionally tagged to a
 * pillar; untagged samples are eligible for any pillar.
 */
export interface VoiceSample {
  pillarId?: string;
  text: string;
}

/**
 * content-domain.json — the creative identity for this deployment/visitor:
 * "what to create," as opposed to contentforge.config.json's "how to run."
 * Free-form (any niche, any pillar set) — the piece that makes ContentForge
 * usable for QA, Beauty, Finance, or anything else. Lives in the user's own
 * storage (local data dir, or their folder/Drive), never hardcoded in app code.
 */
export interface ContentDomainConfig {
  /** Short human label for this domain/niche, e.g. "Beauty & Skincare". */
  niche: string;
  /** Free-text description of the brand/niche — input to AI-assist drafting. */
  description: string;
  brand: BrandConfig;
  pillars: ContentPillar[];
  /** Which of the 5 fixed platforms this domain generates content for. */
  enabledPlatforms: Record<PlatformId, boolean>;
  /** General niche keywords, available to topic generation alongside pillar keywords. */
  keywords: string[];
  /** Fallback hashtags used when the model's own output has too few. */
  hashtagUniverse: string[];
  /** Dev.to frontmatter tags for this domain. */
  devtoTags: string[];
  voiceSamples: VoiceSample[];
}

export interface NotificationConfig {
  channel: string;
  telegramChatId: string;
  notifyOnComplete: boolean;
  notifyOnError: boolean;
}

export interface AutoPostConfig {
  enabled: boolean;
  platforms: Record<string, { enabled: boolean; [key: string]: unknown }>;
}

export interface ChecklistStep {
  label: string;
  copyKey?: keyof ContentRow;
}

export interface ChecklistItem {
  id: PlatformId;
  platform: string;
  bestPostTime: string;
  steps: ChecklistStep[];
}

// Real-time SSE event payload emitted by the pipeline.
export interface StreamEvent {
  step: string;
  status: "running" | "idle" | "error";
  timestamp: string;
  /** 0–100 overall pipeline progress at the time of this event. */
  progress: number;
  /**
   * Present (and equal to `step`) when `status === "error"`. Carries the failure
   * reason explicitly so the client never has to infer it from `step`. Absent
   * for running/idle events.
   */
  errorMessage?: string;
}
