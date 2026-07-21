// lib/excelSchema.ts
// Pure, side-effect-free ContentForge workbook schema + row<->cell mappers.
// This MIRRORS the fixed 32-column A–AF schema used by lib/excelManager.ts, kept
// as a standalone module so the new buffer-backed (stateless) path can reuse it
// WITHOUT modifying the existing file-backed ExcelManager (zero-impact rule).
// If the schema ever changes, update both deliberately.

import type ExcelJS from "exceljs";
import type {
  ContentRow,
  PillarId,
  PostStructure,
  StatusEnum,
} from "@/lib/types";

export const SHEET_NAME = "Content Calendar";

// 32 columns A–AF in exact header order from the spec.
export const HEADERS: ReadonlyArray<string> = [
  "Date", "Topic", "Pillar", "PostStructure", "Status",
  "LinkedIn", "LinkedInHashtags",
  "Medium", "MediumTitle", "MediumSlug", "MediumSubtitle", "MediumMetaDesc",
  "Instagram",
  "YouTube", "YouTubeTitle1", "YouTubeTitle2", "YouTubeTitle3", "YouTubeDescription",
  "DevTo",
  "ImageMedium", "ImageLinkedIn", "ImageInstagram",
  "AgentLog", "LastUpdated", "ErrorMessage",
  "LinkedInPublishStatus", "MediumPublishStatus", "InstagramPublishStatus",
  "YouTubePublishStatus", "DevToPublishStatus", "NotifySentAt", "PerformanceNotes",
];

export const FIELD_ORDER: ReadonlyArray<keyof ContentRow> = [
  "date", "topic", "pillar", "postStructure", "status",
  "linkedin", "linkedinHashtags",
  "medium", "mediumTitle", "mediumSlug", "mediumSubtitle", "mediumMetaDesc",
  "instagram",
  "youtube", "youtubeTitle1", "youtubeTitle2", "youtubeTitle3", "youtubeDescription",
  "devto",
  "imageMedium", "imageLinkedin", "imageInstagram",
  "agentLog", "lastUpdated", "errorMessage",
  "linkedinPublishStatus", "mediumPublishStatus", "instagramPublishStatus",
  "youtubePublishStatus", "devtoPublishStatus", "notifySentAt", "performanceNotes",
];

const VALID_STATUSES: ReadonlyArray<StatusEnum> = [
  "Pending", "Writing", "Imaging", "Done", "Error",
];
const VALID_STRUCTURES: ReadonlyArray<PostStructure> = [
  "story", "contrast", "hot-take", "numbered-insight", "question-led",
];

export function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) {
      const result = (value as { result?: unknown }).result;
      return result === null || result === undefined ? "" : String(result);
    }
    if ("richText" in value) {
      const rich = (value as { richText?: Array<{ text?: string }> }).richText;
      if (Array.isArray(rich)) return rich.map((r) => r.text ?? "").join("");
    }
  }
  return String(value);
}

// Pillar ids are free-form per-domain (see lib/domainConfig.ts) — any
// non-empty cell value is accepted as-is; a blank cell falls back to
// "general" so Agent 1's pillar lookup always has a non-empty id to resolve.
function coercePillar(value: string): PillarId {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "general";
}
function coerceStructure(value: string): PostStructure {
  return (VALID_STRUCTURES as ReadonlyArray<string>).includes(value)
    ? (value as PostStructure)
    : "story";
}
function coerceStatus(value: string): StatusEnum {
  return (VALID_STATUSES as ReadonlyArray<string>).includes(value)
    ? (value as StatusEnum)
    : "Pending";
}

export function rowFromCells(cells: string[]): ContentRow {
  const get = (idx: number): string => cells[idx] ?? "";
  return {
    date: get(0),
    topic: get(1),
    pillar: coercePillar(get(2)),
    postStructure: coerceStructure(get(3)),
    status: coerceStatus(get(4)),
    linkedin: get(5),
    linkedinHashtags: get(6),
    medium: get(7),
    mediumTitle: get(8),
    mediumSlug: get(9),
    mediumSubtitle: get(10),
    mediumMetaDesc: get(11),
    instagram: get(12),
    youtube: get(13),
    youtubeTitle1: get(14),
    youtubeTitle2: get(15),
    youtubeTitle3: get(16),
    youtubeDescription: get(17),
    devto: get(18),
    imageMedium: get(19),
    imageLinkedin: get(20),
    imageInstagram: get(21),
    agentLog: get(22),
    lastUpdated: get(23),
    errorMessage: get(24),
    linkedinPublishStatus: get(25),
    mediumPublishStatus: get(26),
    instagramPublishStatus: get(27),
    youtubePublishStatus: get(28),
    devtoPublishStatus: get(29),
    notifySentAt: get(30),
    performanceNotes: get(31),
  };
}

export function emptyRow(): ContentRow {
  return {
    date: "", topic: "", pillar: "career", postStructure: "story", status: "Pending",
    linkedin: "", linkedinHashtags: "",
    medium: "", mediumTitle: "", mediumSlug: "", mediumSubtitle: "", mediumMetaDesc: "",
    instagram: "",
    youtube: "", youtubeTitle1: "", youtubeTitle2: "", youtubeTitle3: "", youtubeDescription: "",
    devto: "",
    imageMedium: "", imageLinkedin: "", imageInstagram: "",
    agentLog: "", lastUpdated: "", errorMessage: "",
    linkedinPublishStatus: "", mediumPublishStatus: "", instagramPublishStatus: "",
    youtubePublishStatus: "", devtoPublishStatus: "", notifySentAt: "", performanceNotes: "",
  };
}

export function rowToCellValues(row: ContentRow): string[] {
  return FIELD_ORDER.map((field) => {
    const value = row[field];
    return value === undefined || value === null ? "" : String(value);
  });
}

// The subset of ExcelManager behavior the agents/pipeline depend on. Both the
// file-backed manager and the buffer-backed manager satisfy this shape.
export interface ExcelAccessor {
  ensureFileExists(): Promise<void>;
  readAllRows(): Promise<ContentRow[]>;
  getTodayRow(): Promise<ContentRow | null>;
  /** The row for an explicit date (YYYY-MM-DD), or null. */
  getRowForDate(date: string): Promise<ContentRow | null>;
  appendRow(row: Partial<ContentRow>): Promise<void>;
  updateRow(date: string, updates: Partial<ContentRow>): Promise<void>;
  /** Remove the row for a date entirely. No-op when absent. */
  deleteRow(date: string): Promise<void>;
}
