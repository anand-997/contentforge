// lib/publishStatus.ts
// Pure, side-effect-free model for the per-platform publish lifecycle. Importable
// from both client and server. The 32-column A–AF schema is unchanged: each
// platform's publish state is packed as JSON into its existing Z–AD column
// (e.g. linkedinPublishStatus), so this module only parses/serializes strings.

import type { ContentRow } from "@/lib/types";

export type Platform = "linkedin" | "medium" | "instagram" | "youtube" | "devto";

export const PLATFORMS: ReadonlyArray<Platform> = [
  "linkedin",
  "medium",
  "instagram",
  "youtube",
  "devto",
];

export type PublishState =
  | "not-started"
  | "in-review"
  | "scheduled"
  | "published"
  | "skipped";

export const PUBLISH_STATES: ReadonlyArray<PublishState> = [
  "not-started",
  "in-review",
  "scheduled",
  "published",
  "skipped",
];

export interface PublishInfo {
  state: PublishState;
  /** ISO timestamp the post went live — set when state becomes "published". */
  at?: string;
  /** Live post URL — captured when published. */
  url?: string;
}

/** The Z–AD column each platform's publish state is packed into. */
export const PLATFORM_PUBLISH_FIELD: Record<Platform, keyof ContentRow> = {
  linkedin: "linkedinPublishStatus",
  medium: "mediumPublishStatus",
  instagram: "instagramPublishStatus",
  youtube: "youtubePublishStatus",
  devto: "devtoPublishStatus",
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  medium: "Medium",
  instagram: "Instagram",
  youtube: "YouTube",
  devto: "Dev.to",
};

function isPublishState(value: string): value is PublishState {
  return (PUBLISH_STATES as ReadonlyArray<string>).includes(value);
}

/**
 * Parse a packed publish-status cell. Tolerant of three shapes:
 *  - "" / whitespace        → not-started (the v1 default)
 *  - a JSON object          → {state, at?, url?}
 *  - a bare legacy string   → treated as the state if recognized, else not-started
 */
export function parsePublishStatus(raw: string): PublishInfo {
  const trimmed = raw.trim();
  if (trimmed === "") return { state: "not-started" };

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<PublishInfo> & {
        state?: unknown;
      };
      const state =
        typeof parsed.state === "string" && isPublishState(parsed.state)
          ? parsed.state
          : "not-started";
      const info: PublishInfo = { state };
      if (typeof parsed.at === "string" && parsed.at.trim()) info.at = parsed.at;
      if (typeof parsed.url === "string" && parsed.url.trim())
        info.url = parsed.url;
      return info;
    } catch {
      return { state: "not-started" };
    }
  }

  return { state: isPublishState(trimmed) ? trimmed : "not-started" };
}

/** Serialize back to the compact JSON stored in the cell. */
export function serializePublishStatus(info: PublishInfo): string {
  if (info.state === "not-started" && !info.at && !info.url) return "";
  const payload: PublishInfo = { state: info.state };
  if (info.at && info.at.trim()) payload.at = info.at;
  if (info.url && info.url.trim()) payload.url = info.url;
  return JSON.stringify(payload);
}

/** How many of the five platforms are marked published. */
export function publishProgress(row: ContentRow): {
  published: number;
  total: number;
} {
  let published = 0;
  for (const platform of PLATFORMS) {
    const field = PLATFORM_PUBLISH_FIELD[platform];
    if (parsePublishStatus(String(row[field] ?? "")).state === "published") {
      published += 1;
    }
  }
  return { published, total: PLATFORMS.length };
}

/**
 * The ContentRow fields the detail modal is allowed to write. Used as a
 * whitelist by the server route and folder-mode write so a stray key can never
 * clobber an unintended column. `lastUpdated` is stamped by the writer itself.
 */
export const WRITABLE_FIELDS: ReadonlyArray<keyof ContentRow> = [
  // Editable content
  "linkedin",
  "linkedinHashtags",
  "medium",
  "mediumTitle",
  "mediumSlug",
  "mediumSubtitle",
  "mediumMetaDesc",
  "instagram",
  "youtube",
  "youtubeTitle1",
  "youtubeTitle2",
  "youtubeTitle3",
  "youtubeDescription",
  "devto",
  // Publish tracking
  "linkedinPublishStatus",
  "mediumPublishStatus",
  "instagramPublishStatus",
  "youtubePublishStatus",
  "devtoPublishStatus",
  "notifySentAt",
  "performanceNotes",
];

/** Keep only whitelisted string fields from an untrusted updates object. */
export function sanitizeRowUpdates(
  updates: Record<string, unknown>,
): Partial<ContentRow> {
  const clean: Partial<ContentRow> = {};
  for (const field of WRITABLE_FIELDS) {
    const value = updates[field as string];
    if (typeof value === "string") {
      // Every writable column is a string field on ContentRow.
      (clean as Record<string, string>)[field as string] = value;
    }
  }
  return clean;
}
