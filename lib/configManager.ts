// lib/configManager.ts
// Reads/writes/validates contentforge.config.json — technical run settings
// (scheduler, models, knowledge ingestion, notifications, autoPost, posting
// times). Brand identity and content pillars live in content-domain.json (see
// lib/domainConfig.ts) — "what to create," kept separate from "how to run."

import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { DATA_DIR } from "./dataDir";
import type {
  ContentForgeConfig,
  PostStructure,
  NotificationConfig,
  AutoPostConfig,
  KnowledgeConfig,
} from "@/lib/types";

const CONFIG_PATH = path.join(DATA_DIR, "contentforge.config.json");

const VALID_STRUCTURES: ReadonlyArray<PostStructure> = [
  "story",
  "contrast",
  "hot-take",
  "numbered-insight",
  "question-led",
];

export const DEFAULT_CONFIG: ContentForgeConfig = {
  scheduler: {
    cronSchedule: "0 9 * * *",
    timezone: "Asia/Kolkata",
  },
  models: {
    deepseekModel: "deepseek-chat",
    openaiImageModel: "gpt-image-1",
    deepseekBaseUrl: "https://api.deepseek.com",
    maxTokensPerCall: 4000,
    temperatureContent: 0,
    temperatureTopic: 0,
    temperatureBrief: 0,
    imageEngine: "template",
  },
  postStructures: [
    "story",
    "contrast",
    "hot-take",
    "numbered-insight",
    "question-led",
  ],
  structureRotation: "sequential",
  pillarRotation: "weighted",
  recentHistoryWindow: 6,
  lastUsedPillar: "",
  lastUsedStructure: "",
  platformPostingTimes: {
    linkedin: "08:00",
    instagram: "09:00",
    youtube: "10:00",
    medium: "11:00",
    devto: "12:00",
  },
  notifications: {
    channel: "",
    telegramChatId: "",
    notifyOnComplete: false,
    notifyOnError: false,
  },
  autoPost: {
    enabled: false,
    platforms: {
      linkedin: { enabled: false, accessToken: "" },
      devto: { enabled: false, apiKey: "" },
      medium: { enabled: false, integrationToken: "" },
      instagram: { enabled: false, accessToken: "" },
      youtube: { enabled: false, refreshToken: "" },
    },
  },
  knowledge: {
    enabled: true,
    folder: "knowledge",
    ocrImages: true,
    ocrScannedPdfs: true,
    visionFallback: true,
    visionModel: "gpt-4o-mini",
    maxOcrPages: 3,
    excerptChars: 1200,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function coerceNotifications(value: unknown): NotificationConfig {
  const fb = DEFAULT_CONFIG.notifications;
  if (!isRecord(value)) {
    return { ...fb };
  }
  return {
    channel: asString(value.channel, fb.channel),
    telegramChatId: asString(value.telegramChatId, fb.telegramChatId),
    notifyOnComplete: asBoolean(value.notifyOnComplete, fb.notifyOnComplete),
    notifyOnError: asBoolean(value.notifyOnError, fb.notifyOnError),
  };
}

function coerceAutoPost(value: unknown): AutoPostConfig {
  const fb = DEFAULT_CONFIG.autoPost;
  if (!isRecord(value)) {
    return { enabled: fb.enabled, platforms: { ...fb.platforms } };
  }
  const platformsRaw = value.platforms;
  const platforms: Record<string, { enabled: boolean; [key: string]: unknown }> =
    {};
  if (isRecord(platformsRaw)) {
    for (const [key, entry] of Object.entries(platformsRaw)) {
      if (isRecord(entry)) {
        platforms[key] = {
          ...entry,
          enabled: asBoolean(entry.enabled, false),
        };
      }
    }
  }
  return {
    enabled: asBoolean(value.enabled, fb.enabled),
    platforms:
      Object.keys(platforms).length > 0 ? platforms : { ...fb.platforms },
  };
}

function coerceKnowledge(value: unknown): KnowledgeConfig {
  const fb = DEFAULT_CONFIG.knowledge;
  if (!isRecord(value)) {
    return { ...fb };
  }
  return {
    enabled: asBoolean(value.enabled, fb.enabled),
    folder: asString(value.folder, fb.folder),
    ocrImages: asBoolean(value.ocrImages, fb.ocrImages),
    ocrScannedPdfs: asBoolean(value.ocrScannedPdfs, fb.ocrScannedPdfs),
    visionFallback: asBoolean(value.visionFallback, fb.visionFallback),
    visionModel: asString(value.visionModel, fb.visionModel),
    maxOcrPages: Math.max(1, Math.round(asNumber(value.maxOcrPages, fb.maxOcrPages))),
    excerptChars: Math.max(200, Math.round(asNumber(value.excerptChars, fb.excerptChars))),
  };
}

function coercePostStructures(value: unknown): PostStructure[] {
  if (Array.isArray(value)) {
    const filtered = value.filter(
      (v): v is PostStructure =>
        typeof v === "string" &&
        (VALID_STRUCTURES as ReadonlyArray<string>).includes(v),
    );
    if (filtered.length > 0) {
      return filtered;
    }
  }
  return [...DEFAULT_CONFIG.postStructures];
}

export function validateConfig(config: unknown): ContentForgeConfig {
  if (!isRecord(config)) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as ContentForgeConfig;
  }

  const schedulerRaw = isRecord(config.scheduler) ? config.scheduler : {};
  const modelsRaw = isRecord(config.models) ? config.models : {};

  const structureRotation: "sequential" | "random" =
    config.structureRotation === "random" ? "random" : "sequential";

  const pillarRotation: "weighted" | "sequential" =
    config.pillarRotation === "sequential" ? "sequential" : "weighted";

  const postingTimesRaw = config.platformPostingTimes;
  const platformPostingTimes: Record<string, string> = {};
  if (isRecord(postingTimesRaw)) {
    for (const [key, val] of Object.entries(postingTimesRaw)) {
      if (typeof val === "string") {
        platformPostingTimes[key] = val;
      }
    }
  }

  return {
    scheduler: {
      cronSchedule: asString(
        schedulerRaw.cronSchedule,
        DEFAULT_CONFIG.scheduler.cronSchedule,
      ),
      timezone: asString(
        schedulerRaw.timezone,
        DEFAULT_CONFIG.scheduler.timezone,
      ),
    },
    models: {
      deepseekModel: asString(
        modelsRaw.deepseekModel,
        DEFAULT_CONFIG.models.deepseekModel,
      ),
      openaiImageModel: asString(
        modelsRaw.openaiImageModel,
        DEFAULT_CONFIG.models.openaiImageModel,
      ),
      deepseekBaseUrl: asString(
        modelsRaw.deepseekBaseUrl,
        DEFAULT_CONFIG.models.deepseekBaseUrl,
      ),
      maxTokensPerCall: asNumber(
        modelsRaw.maxTokensPerCall,
        DEFAULT_CONFIG.models.maxTokensPerCall,
      ),
      temperatureContent: asNumber(
        modelsRaw.temperatureContent,
        DEFAULT_CONFIG.models.temperatureContent,
      ),
      temperatureTopic: asNumber(
        modelsRaw.temperatureTopic,
        DEFAULT_CONFIG.models.temperatureTopic,
      ),
      temperatureBrief: asNumber(
        modelsRaw.temperatureBrief,
        DEFAULT_CONFIG.models.temperatureBrief,
      ),
      imageEngine: modelsRaw.imageEngine === "openai" ? "openai" : "template",
    },
    postStructures: coercePostStructures(config.postStructures),
    structureRotation,
    pillarRotation,
    recentHistoryWindow: Math.max(
      1,
      Math.round(
        asNumber(config.recentHistoryWindow, DEFAULT_CONFIG.recentHistoryWindow),
      ),
    ),
    lastUsedPillar: asString(config.lastUsedPillar, ""),
    lastUsedStructure: asString(config.lastUsedStructure, ""),
    platformPostingTimes:
      Object.keys(platformPostingTimes).length > 0
        ? platformPostingTimes
        : { ...DEFAULT_CONFIG.platformPostingTimes },
    notifications: coerceNotifications(config.notifications),
    autoPost: coerceAutoPost(config.autoPost),
    knowledge: coerceKnowledge(config.knowledge),
  };
}

export function writeConfig(config: ContentForgeConfig): void {
  const validated = validateConfig(config);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(validated, null, 2) + "\n",
      "utf8",
    );
  } catch (err) {
    logger.error("Failed to write config file", err);
  }
}

export function readConfig(): ContentForgeConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      logger.warn("Config file missing — recreating from defaults");
      const defaults = JSON.parse(
        JSON.stringify(DEFAULT_CONFIG),
      ) as ContentForgeConfig;
      writeConfig(defaults);
      return defaults;
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return validateConfig(parsed);
  } catch (err) {
    logger.error("Config file corrupt or unreadable — recreating defaults", err);
    const defaults = JSON.parse(
      JSON.stringify(DEFAULT_CONFIG),
    ) as ContentForgeConfig;
    writeConfig(defaults);
    return defaults;
  }
}
