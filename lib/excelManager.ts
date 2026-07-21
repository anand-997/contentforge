// lib/excelManager.ts
// Centralized Excel read/write with a serialized write queue. No `any` anywhere.

import path from "path";
import fs from "fs/promises";
import ExcelJS from "exceljs";
import { logger } from "./logger";
import { DATA_DIR } from "./dataDir";
import type {
  ContentRow,
  PillarId,
  PostStructure,
  StatusEnum,
} from "@/lib/types";

const SHEET_NAME = "Content Calendar";

// 32 columns A–AF in exact header order from the spec.
const HEADERS: ReadonlyArray<string> = [
  "Date", // A
  "Topic", // B
  "Pillar", // C
  "PostStructure", // D
  "Status", // E
  "LinkedIn", // F
  "LinkedInHashtags", // G
  "Medium", // H
  "MediumTitle", // I
  "MediumSlug", // J
  "MediumSubtitle", // K
  "MediumMetaDesc", // L
  "Instagram", // M
  "YouTube", // N
  "YouTubeTitle1", // O
  "YouTubeTitle2", // P
  "YouTubeTitle3", // Q
  "YouTubeDescription", // R
  "DevTo", // S
  "ImageMedium", // T
  "ImageLinkedIn", // U
  "ImageInstagram", // V
  "AgentLog", // W
  "LastUpdated", // X
  "ErrorMessage", // Y
  "LinkedInPublishStatus", // Z
  "MediumPublishStatus", // AA
  "InstagramPublishStatus", // AB
  "YouTubePublishStatus", // AC
  "DevToPublishStatus", // AD
  "NotifySentAt", // AE
  "PerformanceNotes", // AF
];

// Ordered list of ContentRow keys mapped to columns A–AF (same order as HEADERS).
const FIELD_ORDER: ReadonlyArray<keyof ContentRow> = [
  "date",
  "topic",
  "pillar",
  "postStructure",
  "status",
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
  "imageMedium",
  "imageLinkedin",
  "imageInstagram",
  "agentLog",
  "lastUpdated",
  "errorMessage",
  "linkedinPublishStatus",
  "mediumPublishStatus",
  "instagramPublishStatus",
  "youtubePublishStatus",
  "devtoPublishStatus",
  "notifySentAt",
  "performanceNotes",
];

const VALID_STATUSES: ReadonlyArray<StatusEnum> = [
  "Pending",
  "Writing",
  "Imaging",
  "Done",
  "Error",
];

const VALID_STRUCTURES: ReadonlyArray<PostStructure> = [
  "story",
  "contrast",
  "hot-take",
  "numbered-insight",
  "question-led",
];

const WRITE_RETRY_DELAY_MS = 2000;
const WRITE_MAX_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayString(): string {
  // Local date in YYYY-MM-DD.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // Rich text / hyperlink / formula objects.
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("result" in value) {
      const result = (value as { result?: unknown }).result;
      return result === null || result === undefined ? "" : String(result);
    }
    if ("richText" in value) {
      const rich = (value as { richText?: Array<{ text?: string }> }).richText;
      if (Array.isArray(rich)) {
        return rich.map((r) => r.text ?? "").join("");
      }
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

function rowFromCells(cells: string[]): ContentRow {
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

function rowToCellValues(row: ContentRow): string[] {
  return FIELD_ORDER.map((field) => {
    const value = row[field];
    return value === undefined || value === null ? "" : String(value);
  });
}

function isBusyError(err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      return true;
    }
    return /busy|lock|permission/i.test(err.message);
  }
  return false;
}

export class ExcelManager {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  // All writes go through this — guarantees sequential non-concurrent writes.
  private enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(fn, fn);
    // Swallow rejections on the chain so one failure does not poison the queue,
    // but surface the result to the caller.
    this.writeQueue = next.catch((err) => {
      logger.error("ExcelManager write failed", err);
    });
    return next;
  }

  private async loadWorkbook(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.filePath);
    return workbook;
  }

  private getOrCreateSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
    let sheet = workbook.getWorksheet(SHEET_NAME);
    if (!sheet) {
      sheet = workbook.addWorksheet(SHEET_NAME);
      sheet.addRow([...HEADERS]);
    }
    return sheet;
  }

  private async saveWithRetry(workbook: ExcelJS.Workbook): Promise<void> {
    let attempt = 0;
    // Retry on lock/EBUSY after 2s, up to 3 attempts total.
    for (;;) {
      attempt += 1;
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await workbook.xlsx.writeFile(this.filePath);
        return;
      } catch (err) {
        if (isBusyError(err) && attempt < WRITE_MAX_ATTEMPTS) {
          logger.warn(
            `Excel file busy/locked — retry ${attempt}/${WRITE_MAX_ATTEMPTS} in ${WRITE_RETRY_DELAY_MS}ms`,
          );
          await delay(WRITE_RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
    }
  }

  async ensureFileExists(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await fs.access(this.filePath);
        // File exists — make sure the sheet + headers exist.
        const workbook = await this.loadWorkbook();
        const existing = workbook.getWorksheet(SHEET_NAME);
        if (!existing) {
          this.getOrCreateSheet(workbook);
          await this.saveWithRetry(workbook);
        }
        return;
      } catch {
        // File missing — create it with headers.
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(SHEET_NAME);
        sheet.addRow([...HEADERS]);
        await this.saveWithRetry(workbook);
        logger.info("content_calendar.xlsx created with headers");
      }
    });
  }

  async readAllRows(): Promise<ContentRow[]> {
    try {
      await fs.access(this.filePath);
    } catch {
      return [];
    }
    const workbook = await this.loadWorkbook();
    const sheet = workbook.getWorksheet(SHEET_NAME);
    if (!sheet) {
      return [];
    }
    const rows: ContentRow[] = [];
    const rowCount = sheet.rowCount;
    for (let r = 2; r <= rowCount; r += 1) {
      const excelRow = sheet.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= HEADERS.length; c += 1) {
        cells.push(cellToString(excelRow.getCell(c).value));
      }
      // Skip fully empty rows.
      if (cells.every((v) => v.trim() === "")) {
        continue;
      }
      rows.push(rowFromCells(cells));
    }
    return rows;
  }

  async getTodayRow(): Promise<ContentRow | null> {
    return this.getRowForDate(todayString());
  }

  async getRowForDate(date: string): Promise<ContentRow | null> {
    const rows = await this.readAllRows();
    return rows.find((row) => row.date === date) ?? null;
  }

  async appendRow(row: Partial<ContentRow>): Promise<void> {
    return this.enqueue(async () => {
      let workbook: ExcelJS.Workbook;
      try {
        await fs.access(this.filePath);
        workbook = await this.loadWorkbook();
      } catch {
        workbook = new ExcelJS.Workbook();
      }
      const sheet = this.getOrCreateSheet(workbook);

      const fullRow: ContentRow = {
        date: "",
        topic: "",
        pillar: "career",
        postStructure: "story",
        status: "Pending",
        linkedin: "",
        linkedinHashtags: "",
        medium: "",
        mediumTitle: "",
        mediumSlug: "",
        mediumSubtitle: "",
        mediumMetaDesc: "",
        instagram: "",
        youtube: "",
        youtubeTitle1: "",
        youtubeTitle2: "",
        youtubeTitle3: "",
        youtubeDescription: "",
        devto: "",
        imageMedium: "",
        imageLinkedin: "",
        imageInstagram: "",
        agentLog: "",
        lastUpdated: "",
        errorMessage: "",
        linkedinPublishStatus: "",
        mediumPublishStatus: "",
        instagramPublishStatus: "",
        youtubePublishStatus: "",
        devtoPublishStatus: "",
        notifySentAt: "",
        performanceNotes: "",
        ...row,
      };

      sheet.addRow(rowToCellValues(fullRow));
      await this.saveWithRetry(workbook);
    });
  }

  async updateRow(date: string, updates: Partial<ContentRow>): Promise<void> {
    return this.enqueue(async () => {
      let workbook: ExcelJS.Workbook;
      try {
        await fs.access(this.filePath);
        workbook = await this.loadWorkbook();
      } catch {
        workbook = new ExcelJS.Workbook();
      }
      const sheet = this.getOrCreateSheet(workbook);

      const rowCount = sheet.rowCount;
      let targetRowIndex = -1;
      for (let r = 2; r <= rowCount; r += 1) {
        const cellDate = cellToString(sheet.getRow(r).getCell(1).value);
        if (cellDate === date) {
          targetRowIndex = r;
          break;
        }
      }

      if (targetRowIndex === -1) {
        logger.warn(`updateRow: no row found for date ${date}`);
        return;
      }

      const excelRow = sheet.getRow(targetRowIndex);
      for (const [field, value] of Object.entries(updates) as Array<
        [keyof ContentRow, ContentRow[keyof ContentRow]]
      >) {
        const colIndex = FIELD_ORDER.indexOf(field);
        if (colIndex === -1) {
          continue;
        }
        const cellValue =
          value === undefined || value === null ? "" : String(value);
        excelRow.getCell(colIndex + 1).value = cellValue;
      }
      excelRow.commit();
      await this.saveWithRetry(workbook);
    });
  }

  async deleteRow(date: string): Promise<void> {
    return this.enqueue(async () => {
      try {
        await fs.access(this.filePath);
      } catch {
        return; // no file → nothing to delete
      }
      const workbook = await this.loadWorkbook();
      const sheet = workbook.getWorksheet(SHEET_NAME);
      if (!sheet) return;
      const rowCount = sheet.rowCount;
      for (let r = 2; r <= rowCount; r += 1) {
        if (cellToString(sheet.getRow(r).getCell(1).value) === date) {
          sheet.spliceRows(r, 1);
          await this.saveWithRetry(workbook);
          logger.info(`Deleted row for ${date}`);
          return;
        }
      }
    });
  }

  async getFileModifiedTime(): Promise<Date> {
    try {
      const stat = await fs.stat(this.filePath);
      return stat.mtime;
    } catch {
      return new Date(0);
    }
  }
}

export const excelManager = new ExcelManager(
  path.join(DATA_DIR, "content_calendar.xlsx"),
);
