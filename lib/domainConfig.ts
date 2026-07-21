// lib/domainConfig.ts
// Reads/writes/validates content-domain.json — the creative identity ("what to
// create"): brand, content pillars, enabled platforms, voice samples, hashtag
// universe, Dev.to tags. This is what makes ContentForge usable for any niche,
// not just QA. Mirrors lib/weeklyConfig.ts's read/validate/coerce/default
// pattern so a missing/partial/corrupt file never breaks the pipeline.
//
// GENERIC_DEFAULT_DOMAIN is the ONLY domain data that ships in source, and it
// is intentionally brand-neutral (blank brand, no pillars, no voice samples).
// It seeds every brand-new visitor (a new folder/Drive connection, or local
// mode before content-domain.json exists) and is what the onboarding wizard
// checks for to decide whether to show first-run setup. A deployment's actual
// brand — including this one's own QA Walah data — lives only as a saved
// content-domain.json data file, never hardcoded here.

import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { DATA_DIR } from "./dataDir";
import type { BrandConfig, ContentDomainConfig, ContentPillar, PlatformId, VoiceSample } from "@/lib/types";

const DOMAIN_PATH = path.join(DATA_DIR, "content-domain.json");

const PLATFORM_IDS: ReadonlyArray<PlatformId> = [
  "linkedin",
  "medium",
  "instagram",
  "youtube",
  "devto",
];

const BLANK_BRAND: BrandConfig = {
  name: "Your Brand",
  handle: "",
  location: "",
  timezone: "UTC",
  devtoSeries: "",
  mediumHandle: "",
  roles: "",
  expertise: "",
  mission: "",
  imageColors: {
    background: "#0d1117",
    accent: "#00d4aa",
    secondaryAccent: "#f0a500",
    text: "#ffffff",
    subtext: "#8b949e",
  },
};

export const GENERIC_DEFAULT_DOMAIN: ContentDomainConfig = {
  niche: "",
  description: "",
  brand: BLANK_BRAND,
  pillars: [],
  enabledPlatforms: {
    linkedin: true,
    medium: true,
    instagram: true,
    youtube: true,
    devto: true,
  },
  keywords: [],
  hashtagUniverse: [],
  devtoTags: [],
  voiceSamples: [],
};

// True when a domain config has no real content yet — either it's the exact
// generic default, or the brand name/niche were never filled in. Used to
// decide whether to show the onboarding wizard.
export function isBlankDomain(domain: ContentDomainConfig): boolean {
  return (
    domain.niche.trim().length === 0 &&
    domain.pillars.length === 0 &&
    domain.brand.name.trim().length === 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as string[];
  }
  return fallback;
}

function slugify(name: string, fallback: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

function coerceBrand(value: unknown): BrandConfig {
  const fb = BLANK_BRAND;
  if (!isRecord(value)) {
    return { ...fb };
  }
  const colorsRaw = value.imageColors;
  const colors = isRecord(colorsRaw) ? colorsRaw : {};
  return {
    name: asString(value.name, fb.name),
    handle: asString(value.handle, fb.handle),
    location: asString(value.location, fb.location),
    timezone: asString(value.timezone, fb.timezone),
    devtoSeries: asString(value.devtoSeries, fb.devtoSeries),
    mediumHandle: asString(value.mediumHandle, fb.mediumHandle),
    roles: asString(value.roles, fb.roles ?? ""),
    expertise: asString(value.expertise, fb.expertise ?? ""),
    mission: asString(value.mission, fb.mission ?? ""),
    imageColors: {
      background: asString(colors.background, fb.imageColors.background),
      accent: asString(colors.accent, fb.imageColors.accent),
      secondaryAccent: asString(colors.secondaryAccent, fb.imageColors.secondaryAccent),
      text: asString(colors.text, fb.imageColors.text),
      subtext: asString(colors.subtext, fb.imageColors.subtext),
    },
  };
}

function coercePillar(value: unknown, index: number): ContentPillar | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name, "").trim();
  if (name.length === 0) return null;
  const id = asString(value.id, "").trim() || slugify(name, `pillar-${index + 1}`);
  return {
    id,
    name,
    weight: Math.max(1, asNumber(value.weight, 20)),
    keywords: asStringArray(value.keywords, []),
    toneHint: asString(value.toneHint, ""),
  };
}

function coercePillars(value: unknown): ContentPillar[] {
  if (!Array.isArray(value)) return [];
  const pillars: ContentPillar[] = [];
  value.forEach((p, i) => {
    const coerced = coercePillar(p, i);
    if (coerced) pillars.push(coerced);
  });
  return pillars;
}

function coerceEnabledPlatforms(value: unknown): Record<PlatformId, boolean> {
  const out = { ...GENERIC_DEFAULT_DOMAIN.enabledPlatforms };
  if (isRecord(value)) {
    for (const id of PLATFORM_IDS) {
      if (typeof value[id] === "boolean") {
        out[id] = value[id] as boolean;
      }
    }
  }
  return out;
}

function coerceVoiceSamples(value: unknown): VoiceSample[] {
  if (!Array.isArray(value)) return [];
  const samples: VoiceSample[] = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.text === "string" && item.text.trim().length > 0) {
      samples.push({
        text: item.text,
        pillarId: typeof item.pillarId === "string" && item.pillarId.trim().length > 0
          ? item.pillarId
          : undefined,
      });
    }
  }
  return samples;
}

export function validateDomainConfig(raw: unknown): ContentDomainConfig {
  if (!isRecord(raw)) {
    return JSON.parse(JSON.stringify(GENERIC_DEFAULT_DOMAIN)) as ContentDomainConfig;
  }
  return {
    niche: asString(raw.niche, ""),
    description: asString(raw.description, ""),
    brand: coerceBrand(raw.brand),
    pillars: coercePillars(raw.pillars),
    enabledPlatforms: coerceEnabledPlatforms(raw.enabledPlatforms),
    keywords: asStringArray(raw.keywords, []),
    hashtagUniverse: asStringArray(raw.hashtagUniverse, []),
    devtoTags: asStringArray(raw.devtoTags, []),
    voiceSamples: coerceVoiceSamples(raw.voiceSamples),
  };
}

export function writeDomainConfig(domain: ContentDomainConfig): void {
  const validated = validateDomainConfig(domain);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      DOMAIN_PATH,
      JSON.stringify(validated, null, 2) + "\n",
      "utf8",
    );
  } catch (err) {
    logger.error("Failed to write content-domain.json", err);
  }
}

export function readDomainConfig(): ContentDomainConfig {
  try {
    if (!fs.existsSync(DOMAIN_PATH)) {
      logger.warn("content-domain.json missing — using brand-neutral default");
      return JSON.parse(JSON.stringify(GENERIC_DEFAULT_DOMAIN)) as ContentDomainConfig;
    }
    const raw = fs.readFileSync(DOMAIN_PATH, "utf8");
    return validateDomainConfig(JSON.parse(raw));
  } catch (err) {
    logger.error("content-domain.json corrupt/unreadable — using brand-neutral default", err);
    return JSON.parse(JSON.stringify(GENERIC_DEFAULT_DOMAIN)) as ContentDomainConfig;
  }
}
