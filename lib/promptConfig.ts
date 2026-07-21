// lib/promptConfig.ts
// Externalizes the 4 agents' prompt scaffolding into an editable JSON file
// (agent-prompts.json) authored in the RICE-POT framework
// (Role / Instructions / Context / Example / Parameters / Output / Tone).
// Only R / I / P / T are operator-configurable per text agent (plus image card
// knobs); Context and Example are runtime/dynamic and Output markers live in
// code. Validated against an embedded DEFAULT_PROMPTS so a missing/partial/corrupt
// file never throws — mirrors lib/weeklyConfig.ts and lib/configManager.ts. No `any`.

import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { DATA_DIR } from "./dataDir";

const PROMPTS_PATH = path.join(DATA_DIR, "agent-prompts.json");

const SUBLINE_SOURCES = ["fact", "topic", "insight"] as const;
type SublineSource = (typeof SUBLINE_SOURCES)[number];

const DEFAULT_HEADLINE_MAX_CHARS = 56;
const MIN_HEADLINE_MAX_CHARS = 16;

export interface AgentPromptBlock {
  role: string;
  instructions: string[];
  parameters: string[];
  tone: string;
}

export interface ImagePromptBlock {
  role: string;
  parameters: string[];
  sublineSource: SublineSource;
  headlineMaxChars: number;
}

export interface AgentPrompts {
  topic: AgentPromptBlock;
  brief: AgentPromptBlock;
  content: AgentPromptBlock;
  image: ImagePromptBlock;
}

// Shared no-hallucination / determinism rules injected into the brief & content
// agents. Authored here once so both blocks stay identical.
const NO_HALLUCINATION_RULES: string[] = [
  "Output must be deterministic: the same brief and inputs should yield the same content.",
  "Every specific claim must trace to the CANONICAL FACTS or provided material. If a needed specific is missing, stay qualitative — never invent numbers, names, times, amounts, or companies.",
  "Do not present invented APIs, method names, flags, config keys, error codes, CLI commands, or 'tool X does Y' behavior as fact. Clearly-illustrative example code is allowed, but never assert a specific identifier or behavior you are not certain of — stay general when unsure.",
  "Do not assume 'typical' or default system behavior.",
  "Never imply the author personally did, attended, ran, interviewed for, shipped, or witnessed a specific event (an interview, incident, meeting, or conversation) unless it appears in the canonical facts or provided material. With no such fact, make the point from general patterns and reasoning, and vary your phrasing rather than reusing a fixed opener.",
];

// Brand-neutral by design — this is what ships in source and seeds every new
// domain. The identity/expertise framing comes from content-domain.json's
// brand (via buildBrandIntro) at generation time; these RICE-POT blocks add
// supplementary, niche-agnostic craft guidance on top of that, editable per
// domain in Settings.
export const DEFAULT_PROMPTS: AgentPrompts = {
  topic: {
    role: "",
    instructions: [
      "Pick a single sharp topic that fits the assigned content pillar and the day's theme.",
      "Frame it as a concrete problem, lesson, or take a practitioner in this field would recognise.",
      "Prefer angles drawn from real hands-on practice over generic listicle ideas.",
    ],
    parameters: [
      "Keep titles honest: no invented numbers, salaries, or percentages.",
      "Be specific and engaging — avoid vague, clickbait, or buzzword-heavy phrasing.",
      "One clear subject per topic; do not bundle multiple ideas.",
      "Do not frame the title as a personal event the author may not have had (an interview you ran, something you shipped) unless it is grounded in real material; favour problem, lesson, or question framings.",
    ],
    tone: "Direct, practical, and senior — like a practitioner naming what actually matters, not marketing copy.",
  },
  brief: {
    role: "",
    instructions: [
      "Distil the topic into the core insight, the audience pain it addresses, and the takeaway a reader should leave with.",
      "Identify the canonical facts and concrete details the content may rely on, drawn only from the topic and provided material.",
      "Outline the logical spine of the post without writing the final copy.",
    ],
    parameters: [
      "Anchor the brief in real, hands-on practice; skip motivational filler.",
      ...NO_HALLUCINATION_RULES,
    ],
    tone: "Crisp and analytical — a working outline a senior practitioner would hand to themselves.",
  },
  content: {
    role: "",
    instructions: [
      "Follow the brief's spine and deliver the core insight clearly for the target platform.",
      "Ground every point in concrete, hands-on reality; show, don't preach.",
      "Lead with substance and earn the reader's attention line by line.",
    ],
    parameters: [
      "Write for working practitioners in this field; respect their time and intelligence.",
      ...NO_HALLUCINATION_RULES,
    ],
    tone: "Senior, grounded, and human — confident without hype, the voice of someone who has actually done this work.",
  },
  image: {
    role: "A clean, minimal branded content card in the brand's own colors — no people and no stock photos.",
    parameters: [
      "The headline must be the post's actual topic — never a generic or invented phrase.",
      "The subline is a short, real insight tied to the post; keep it concrete.",
      "Never invent specifics (numbers, names, tools, or claims) for the card text.",
    ],
    sublineSource: "fact",
    headlineMaxChars: DEFAULT_HEADLINE_MAX_CHARS,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const arr = value.filter((v): v is string => typeof v === "string");
    if (arr.length > 0) return arr;
  }
  return fallback;
}

function asHeadlineMaxChars(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.floor(value);
    return n >= MIN_HEADLINE_MAX_CHARS ? n : MIN_HEADLINE_MAX_CHARS;
  }
  return fallback;
}

function asSublineSource(value: unknown, fallback: SublineSource): SublineSource {
  return typeof value === "string" &&
    (SUBLINE_SOURCES as ReadonlyArray<string>).includes(value)
    ? (value as SublineSource)
    : fallback;
}

function coerceBlock(value: unknown, fb: AgentPromptBlock): AgentPromptBlock {
  if (!isRecord(value)) return { ...fb };
  return {
    role: asString(value.role, fb.role),
    instructions: asStringArray(value.instructions, fb.instructions),
    parameters: asStringArray(value.parameters, fb.parameters),
    tone: asString(value.tone, fb.tone),
  };
}

function coerceImageBlock(value: unknown, fb: ImagePromptBlock): ImagePromptBlock {
  if (!isRecord(value)) return { ...fb };
  return {
    role: asString(value.role, fb.role),
    parameters: asStringArray(value.parameters, fb.parameters),
    sublineSource: asSublineSource(value.sublineSource, fb.sublineSource),
    headlineMaxChars: asHeadlineMaxChars(value.headlineMaxChars, fb.headlineMaxChars),
  };
}

// Validates an already-parsed value against DEFAULT_PROMPTS — used both by
// readAgentPrompts() (file-backed, local mode) and by folder/Drive mode's
// /api/generate, which receives agent-prompts.json in the request body
// instead of reading it from the server filesystem.
export function validateAgentPrompts(raw: unknown): AgentPrompts {
  if (!isRecord(raw)) {
    return DEFAULT_PROMPTS;
  }
  return {
    topic: coerceBlock(raw.topic, DEFAULT_PROMPTS.topic),
    brief: coerceBlock(raw.brief, DEFAULT_PROMPTS.brief),
    content: coerceBlock(raw.content, DEFAULT_PROMPTS.content),
    image: coerceImageBlock(raw.image, DEFAULT_PROMPTS.image),
  };
}

// Reads DATA_DIR/agent-prompts.json (local mode), coercing each block against
// DEFAULT_PROMPTS. Missing/partial/corrupt -> defaults (logger.warn), never throws.
export function readAgentPrompts(): AgentPrompts {
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf8"));
  } catch {
    raw = null;
  }
  if (!isRecord(raw)) {
    logger.warn("agent-prompts.json missing/invalid — using defaults");
    return DEFAULT_PROMPTS;
  }
  return validateAgentPrompts(raw);
}

export function writeAgentPrompts(prompts: AgentPrompts): void {
  const validated = validateAgentPrompts(prompts);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      PROMPTS_PATH,
      JSON.stringify(validated, null, 2) + "\n",
      "utf8",
    );
  } catch (err) {
    logger.error("Failed to write agent-prompts.json", err);
  }
}

// Formats just an array of lines as a bulleted block (for section-level
// injection). e.g. formatLines(["a","b"]) -> "- a\n- b". Empty array -> "".
export function formatLines(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

// Formats a full RICE-POT block as labelled sections for appending to a prompt.
// Used for the topic and brief prompts. Empty sections are omitted.
export function renderBlock(block: AgentPromptBlock): string {
  const sections: string[] = [];
  if (block.role.trim().length > 0) {
    sections.push(`### ROLE\n${block.role}`);
  }
  if (block.instructions.length > 0) {
    sections.push(`### INSTRUCTIONS\n${formatLines(block.instructions)}`);
  }
  if (block.parameters.length > 0) {
    sections.push(`### PARAMETERS\n${formatLines(block.parameters)}`);
  }
  if (block.tone.trim().length > 0) {
    sections.push(`### TONE\n${block.tone}`);
  }
  return sections.join("\n\n");
}
