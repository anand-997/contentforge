// lib/status.ts
// Builds the status response, streak count, and per-platform publish checklist.

import { readConfig } from "./configManager";
import { readDomainConfig } from "./domainConfig";
import { excelManager } from "./excelManager";
import { getPipelineState } from "./pipeline";
import { getKeyHealthCache } from "./pipelineEvents";
import { getNextRunDescription } from "./scheduler";
import type {
  ApiKeyHealth,
  ChecklistItem,
  ContentRow,
  StatusEnum,
  StatusResponse,
} from "@/lib/types";

function keyHealth(value: string | undefined): ApiKeyHealth {
  return value && value.trim().length > 0 ? "healthy" : "missing";
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Consecutive days ending today (or yesterday) with status "Done".
export function computeStreak(rows: ContentRow[]): number {
  const doneDates = new Set(
    rows.filter((r) => r.status === "Done").map((r) => r.date),
  );

  const today = new Date();
  const todayStr = ymd(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = ymd(yesterday);

  // Determine the anchor: today if done, else yesterday if done, else 0.
  let cursor: Date;
  if (doneDates.has(todayStr)) {
    cursor = new Date(today);
  } else if (doneDates.has(yesterdayStr)) {
    cursor = new Date(yesterday);
  } else {
    return 0;
  }

  let streak = 0;
  for (;;) {
    const key = ymd(cursor);
    if (doneDates.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function formatPostTime(raw: string | undefined, fallback: string): string {
  // Config stores "HH:MM" 24h; render as friendly 12h IST string.
  if (!raw) {
    return fallback;
  }
  const parts = raw.split(":");
  const hour = Number(parts[0]);
  const minute = Number(parts[1] ?? "0");
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return fallback;
  }
  const period = hour < 12 ? "AM" : "PM";
  let displayHour = hour % 12;
  if (displayHour === 0) {
    displayHour = 12;
  }
  const mm = String(minute).padStart(2, "0");
  return `${displayHour}:${mm} ${period} IST`;
}

export async function buildStatusResponse(): Promise<StatusResponse> {
  const config = readConfig();
  const rows = await excelManager.readAllRows();
  const pipelineState = getPipelineState();

  // lastRun / lastStatus = the newest dated row.
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = sorted[0];

  const lastRun = latest ? latest.lastUpdated || latest.date : null;
  const lastStatus: StatusEnum | null = latest ? latest.status : null;

  const errorMessage =
    pipelineState.lastError ??
    (lastStatus === "Error" ? latest?.errorMessage || null : null);

  const healthCache = getKeyHealthCache();

  return {
    deepseek: healthCache.deepseek ?? keyHealth(process.env.DEEPSEEK_API_KEY),
    openai: healthCache.openai ?? keyHealth(process.env.OPENAI_API_KEY),
    deepseekModel: config.models.deepseekModel,
    openaiImageModel: config.models.openaiImageModel,
    pipelineRunning: pipelineState.running,
    currentStep: pipelineState.currentStep,
    nextScheduledRun: getNextRunDescription(),
    lastRun,
    lastStatus,
    streakDays: computeStreak(rows),
    progress: pipelineState.progress,
    errorMessage,
  };
}

export async function buildChecklist(): Promise<ChecklistItem[]> {
  const config = readConfig();
  const domain = readDomainConfig();
  const times = config.platformPostingTimes;

  const all: ChecklistItem[] = [
    {
      id: "linkedin",
      platform: "LinkedIn",
      bestPostTime: formatPostTime(times.linkedin, "8:00 AM IST"),
      steps: [
        { label: "Copy post body", copyKey: "linkedin" },
        { label: "Paste into LinkedIn and post" },
        {
          label: "Immediately add first comment with hashtags",
          copyKey: "linkedinHashtags",
        },
        { label: "Upload LinkedIn image", copyKey: "imageLinkedin" },
        { label: "Engage with comments within first 60 minutes" },
      ],
    },
    {
      id: "medium",
      platform: "Medium",
      bestPostTime: formatPostTime(times.medium, "11:00 AM IST"),
      steps: [
        { label: "Copy article title", copyKey: "mediumTitle" },
        { label: "Copy subtitle", copyKey: "mediumSubtitle" },
        { label: "Copy article body", copyKey: "medium" },
        { label: "Paste into Medium editor and format" },
        { label: "Set the URL slug", copyKey: "mediumSlug" },
        { label: "Add SEO meta description", copyKey: "mediumMetaDesc" },
        { label: "Upload cover image", copyKey: "imageMedium" },
        { label: "Publish and add to your publication" },
      ],
    },
    {
      id: "instagram",
      platform: "Instagram",
      bestPostTime: formatPostTime(times.instagram, "9:00 AM IST"),
      steps: [
        { label: "Copy caption", copyKey: "instagram" },
        { label: "Upload Instagram image(s)", copyKey: "imageInstagram" },
        { label: "Paste caption and post" },
        { label: "Share to Stories with a sticker" },
      ],
    },
    {
      id: "youtube",
      platform: "YouTube",
      bestPostTime: formatPostTime(times.youtube, "10:00 AM IST"),
      steps: [
        { label: "Choose and copy a title", copyKey: "youtubeTitle1" },
        { label: "Record using the script", copyKey: "youtube" },
        { label: "Copy the description with chapters", copyKey: "youtubeDescription" },
        { label: "Upload video, set title and description" },
        { label: "Add end screen and subscribe CTA" },
      ],
    },
    {
      id: "devto",
      platform: "Dev.to",
      bestPostTime: formatPostTime(times.devto, "12:00 PM IST"),
      steps: [
        { label: "Copy the full article with frontmatter", copyKey: "devto" },
        { label: "Paste into dev.to editor" },
        { label: "Verify canonical URL points to Medium" },
        { label: "Publish (set published: true)" },
      ],
    },
  ];

  return all.filter((item) => domain.enabledPlatforms[item.id] !== false);
}
