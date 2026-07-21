// lib/brief.ts
// Canonical-brief sidecar store + optional real-material input.
//
// The brief is the single source of truth for a day's content: Agent 1 writes
// it, Agent 2 reads it so every platform reuses the SAME specifics. Stored as
// JSON files under data/briefs/<date>.json so the fixed 32-column Excel schema
// is never touched. Optional real material lives in data/input/<date>.md and,
// when present, is what the brief's canonical facts are built from.

import path from "path";
import fs from "fs/promises";
import { logger } from "./logger";
import { DATA_DIR } from "./dataDir";
import type {
  CarouselSlide,
  ContentBrief,
  HookArchetype,
  PillarId,
  PostStructure,
  TitlePattern,
} from "@/lib/types";

const BRIEFS_DIR = path.join(DATA_DIR, "data", "briefs");
const INPUT_DIR = path.join(DATA_DIR, "data", "input");

const VALID_HOOKS: ReadonlyArray<HookArchetype> = [
  "confession",
  "contrarian",
  "single-number",
  "you-callout",
  "cold-open",
];

const VALID_TITLE_PATTERNS: ReadonlyArray<TitlePattern> = [
  "how-to",
  "number-list",
  "question",
  "contrarian",
  "story",
];

const VALID_STRUCTURES: ReadonlyArray<PostStructure> = [
  "story",
  "contrast",
  "hot-take",
  "numbered-insight",
  "question-led",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asEnum<T extends string>(
  value: unknown,
  valid: ReadonlyArray<T>,
  fallback: T,
): T {
  return typeof value === "string" && (valid as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

// Coerce a value into a CarouselSlide[]. Only accepts array items that are
// records with a string heading AND a string body; anything else is dropped.
function asCarouselSlides(value: unknown): CarouselSlide[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const slides: CarouselSlide[] = [];
  for (const item of value) {
    if (
      isRecord(item) &&
      typeof item.heading === "string" &&
      typeof item.body === "string"
    ) {
      slides.push({ heading: item.heading, body: item.body });
    }
  }
  return slides;
}

// Re-exported from the client-safe module so existing server-side importers of
// `@/lib/brief` keep working; client components import it from `@/lib/imagePaths`.
export { parseImagePaths } from "./imagePaths";

function briefPath(date: string): string {
  return path.join(BRIEFS_DIR, `${date}.json`);
}

function inputPath(date: string): string {
  return path.join(INPUT_DIR, `${date}.md`);
}

function coerceBrief(value: unknown): ContentBrief | null {
  if (!isRecord(value) || typeof value.date !== "string") {
    return null;
  }
  return {
    date: value.date,
    topic: typeof value.topic === "string" ? value.topic : "",
    // Pillar ids are free-form per-domain (see lib/domainConfig.ts).
    pillar:
      typeof value.pillar === "string" && value.pillar.trim().length > 0
        ? value.pillar
        : "general",
    postStructure: asEnum(value.postStructure, VALID_STRUCTURES, "story"),
    hookArchetype: asEnum(value.hookArchetype, VALID_HOOKS, "cold-open"),
    titlePattern: asEnum(value.titlePattern, VALID_TITLE_PATTERNS, "story"),
    readerPersona:
      typeof value.readerPersona === "string" ? value.readerPersona : "",
    canonicalFacts: asStringArray(value.canonicalFacts),
    hasRealMaterial: value.hasRealMaterial === true,
    hasAuthorMaterial: value.hasAuthorMaterial === true,
    carouselSlides: asCarouselSlides(value.carouselSlides),
    themeId: typeof value.themeId === "string" ? value.themeId : undefined,
    knowledgeSourceId:
      typeof value.knowledgeSourceId === "string"
        ? value.knowledgeSourceId
        : undefined,
  };
}

// The user-maintained quick-reference at <learnings>/KNOWLEDGE.md. Read first
// each run as cheap, high-priority context. Capped so it can't bloat tokens.
export async function readKnowledgeNotes(
  folder: string,
  maxChars = 4000,
): Promise<string | null> {
  const base = path.isAbsolute(folder) ? folder : path.join(DATA_DIR, folder);
  try {
    const raw = await fs.readFile(path.join(base, "KNOWLEDGE.md"), "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed.slice(0, maxChars) : null;
  } catch {
    return null;
  }
}

export async function writeBrief(brief: ContentBrief): Promise<void> {
  await fs.mkdir(BRIEFS_DIR, { recursive: true });
  await fs.writeFile(
    briefPath(brief.date),
    JSON.stringify(brief, null, 2) + "\n",
    "utf8",
  );
  logger.info(`[brief] wrote ${brief.date}.json`);
}

export async function readBrief(date: string): Promise<ContentBrief | null> {
  try {
    const raw = await fs.readFile(briefPath(date), "utf8");
    return coerceBrief(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

// Real material the user dropped for this date (a genuine anecdote/metrics/log).
// Returns trimmed contents or null when no file exists.
export async function readInputMaterial(date: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(inputPath(date), "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

// The most recent briefs (newest first), used by Agent 1 to avoid repeating a
// hook archetype / title pattern across consecutive days.
export async function readRecentBriefs(limit: number): Promise<ContentBrief[]> {
  let files: string[];
  try {
    files = await fs.readdir(BRIEFS_DIR);
  } catch {
    return [];
  }
  const dated = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, Math.max(0, limit));

  const briefs: ContentBrief[] = [];
  for (const date of dated) {
    const brief = await readBrief(date);
    if (brief) {
      briefs.push(brief);
    }
  }
  return briefs;
}
