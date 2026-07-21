// lib/weeklyConfig.ts
// Loads the merged weekday plan (weekly-plan.json): one entry per weekday holding
// the topic THEME, the BRAND VOICE, and which knowledge files to ground content
// in. Validated against an embedded DEFAULT_PLAN so a missing/partial file never
// breaks the pipeline. No `any`.

import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { DATA_DIR } from "./dataDir";
import type {
  BrandVoice,
  PillarId,
  Weekday,
  WeeklyTheme,
  WeekdayPlan,
} from "@/lib/types";

const PLAN_PATH = path.join(DATA_DIR, "weekly-plan.json");

const WEEKDAYS: ReadonlyArray<Weekday> = [
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
];

// getDay(): 0=Sun .. 6=Sat.
const DAY_INDEX_TO_KEY: ReadonlyArray<Weekday> = [
  "sun", "mon", "tue", "wed", "thu", "fri", "sat",
];

// Code-shipped, brand-neutral fallback used only when weekly-plan.json is
// missing/invalid (e.g. a brand-new visitor who hasn't set up their domain
// yet). The 7 voice archetypes are niche-neutral and reusable as-is; theme,
// pillar, and persona are intentionally generic — never a specific brand's
// content — until the user customizes them via onboarding/Settings.
export const DEFAULT_PLAN: Record<Weekday, WeekdayPlan> = {
  mon: { theme: "", keywords: [], pillar: "", learningTags: [], knowledgeFiles: [], voice: { name: "The Builder", persona: "A practitioner showing one reader a concrete technique that actually held up in real use.", toneDirectives: ["Open with the assigned hook, anchored to one concrete, named technique or pattern.", "Make one point and do not restate it.", "Stay concrete in your reasoning; invent no numbers you cannot ground.", "Close with a fresh challenge to try it, never a template line."] } },
  tue: { theme: "", keywords: [], pillar: "", learningTags: [], knowledgeFiles: [], voice: { name: "The Analyst", persona: "A trade-off-minded practitioner walking one reader through where a tool or process actually leaks cost and reliability.", toneDirectives: ["Open with the assigned hook, then frame the trade-off plainly.", "Make one judgement about that trade-off and do not restate it three ways.", "Reason from observed behaviour; cite a number only when it is grounded, else stay qualitative.", "Close with a fresh question about what their team is quietly bluffing on, never a template."] } },
  wed: { theme: "", keywords: [], pillar: "", learningTags: [], knowledgeFiles: [], voice: { name: "The Mentor", persona: "A calm senior practitioner teaching one junior, one-on-one, a single lesson that matters.", toneDirectives: ["Open with the assigned hook, then teach exactly one concrete lesson.", "Make that one point and do not restate it in three ways.", "Stay concrete about the details and the why; invent no metrics you cannot ground.", "Close with a fresh nudge to go try it, never a template line."] } },
  thu: { theme: "", keywords: [], pillar: "", learningTags: [], knowledgeFiles: [], voice: { name: "The Storyteller", persona: "A veteran practitioner walking one reader through a single recognizable failure pattern, with tension and a turn, until the lesson lands.", toneDirectives: ["Open with the assigned hook on one recognizable failure pattern.", "Carry one lesson through the scene and do not restate it afterward.", "Keep details concrete to that incident; invent no numbers you cannot ground.", "Close with a fresh reflection on their own last incident, never a template line."] } },
  fri: { theme: "", keywords: [], pillar: "", learningTags: [], knowledgeFiles: [], voice: { name: "The Myth-Buster", persona: "A contrarian practitioner telling one reader why a comfortable belief quietly costs them.", toneDirectives: ["Open with the assigned hook by naming the belief flatly, no 'unpopular opinion' label.", "Make the one counter-claim and do not restate it three ways.", "Back it with a real consequence; cite a number only when grounded, else stay qualitative.", "Close with a fresh challenge to retest the belief themselves, never a template line."] } },
  sat: { theme: "", keywords: [], pillar: "", learningTags: [], knowledgeFiles: [], voice: { name: "The Coach", persona: "A tough-love coach speaking to exactly one reader who has experience but no proof to show for it.", toneDirectives: ["Open with the assigned hook by naming this one reader's exact situation.", "Make one honest point and do not soften it three ways.", "Reason from how the field actually works; invent no numbers you cannot ground.", "Close with one fresh action to take this week, never a template line."] } },
  sun: { theme: "", keywords: [], pillar: "", learningTags: [], knowledgeFiles: [], voice: { name: "The Reflective Veteran", persona: "A seasoned practitioner sharing one earned, measured take on the craft with a single reader.", toneDirectives: ["Open with the assigned hook, then state one clear, earned position on the craft.", "Make that single point and do not restate it three ways.", "Reason from experience, not buzzwords; invent no metrics you cannot ground.", "Close with a fresh question that invites reflection, never a template line."] } },
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

function coerceVoice(value: unknown, fb: BrandVoice): BrandVoice {
  if (!isRecord(value)) return { ...fb };
  return {
    name: asString(value.name, fb.name),
    persona: asString(value.persona, fb.persona),
    toneDirectives: asStringArray(value.toneDirectives, fb.toneDirectives),
  };
}

function coercePlan(value: unknown, fb: WeekdayPlan): WeekdayPlan {
  if (!isRecord(value)) return { ...fb };
  // Pillar ids are free-form per-domain (see lib/domainConfig.ts) — any
  // non-empty string is accepted here; Agent 1 resolves it against the
  // domain's actual configured pillars at generation time.
  const pillarRaw = value.pillar;
  const pillar: PillarId =
    typeof pillarRaw === "string" && pillarRaw.trim().length > 0
      ? pillarRaw
      : fb.pillar;
  return {
    theme: asString(value.theme, fb.theme),
    keywords: asStringArray(value.keywords, fb.keywords),
    pillar,
    learningTags: asStringArray(value.learningTags, fb.learningTags),
    knowledgeFiles: asStringArray(value.knowledgeFiles, fb.knowledgeFiles ?? []),
    voice: coerceVoice(value.voice, fb.voice),
  };
}

// Validates an already-parsed value against DEFAULT_PLAN — shared by
// readWeeklyPlan() (file-backed) and the /api/weekly-plan route, which
// validates a posted value the same way /api/config and /api/domain do.
export function validateWeeklyPlan(raw: unknown): Record<Weekday, WeekdayPlan> {
  const record = isRecord(raw) ? raw : null;
  const out = {} as Record<Weekday, WeekdayPlan>;
  for (const day of WEEKDAYS) {
    out[day] = coercePlan(record ? record[day] : undefined, DEFAULT_PLAN[day]);
  }
  return out;
}

export function readWeeklyPlan(): Record<Weekday, WeekdayPlan> {
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  } catch {
    raw = null;
  }
  if (!isRecord(raw)) {
    logger.warn("weekly-plan.json missing/invalid — using defaults");
    return DEFAULT_PLAN;
  }
  return validateWeeklyPlan(raw);
}

export function writeWeeklyPlan(plan: Record<Weekday, WeekdayPlan>): void {
  const validated = validateWeeklyPlan(plan);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PLAN_PATH, JSON.stringify(validated, null, 2) + "\n", "utf8");
  } catch (err) {
    logger.error("Failed to write weekly-plan.json", err);
  }
}

function weekdayKey(date: Date): Weekday {
  return DAY_INDEX_TO_KEY[date.getDay()];
}

export function planForDay(date: Date): { day: Weekday; plan: WeekdayPlan } {
  const day = weekdayKey(date);
  return { day, plan: readWeeklyPlan()[day] };
}

// Kept for the agents' existing call sites — both derive from the merged plan.
export function themeForDay(date: Date): { day: Weekday; theme: WeeklyTheme } {
  const { day, plan } = planForDay(date);
  const { voice: _voice, ...theme } = plan;
  void _voice;
  return { day, theme };
}

export function voiceForDay(date: Date): { day: Weekday; voice: BrandVoice } {
  const { day, plan } = planForDay(date);
  return { day, voice: plan.voice };
}
