// lib/excelBuffer.ts
// In-memory, buffer-backed workbook accessor for the stateless (deployed) path.
// Loads an .xlsx ArrayBuffer, mutates it in memory, and exports a new buffer.
// Reuses the shared schema in excelSchema.ts. Used per-request only — no
// concurrency concerns, so no write queue (unlike the file-backed ExcelManager,
// which is left untouched for local mode).

import ExcelJS from "exceljs";
import {
  FIELD_ORDER,
  HEADERS,
  SHEET_NAME,
  cellToString,
  emptyRow,
  rowFromCells,
  rowToCellValues,
  type ExcelAccessor,
} from "./excelSchema";
import type { ContentRow } from "@/lib/types";

// Precomputed field -> column index for updateRow.
const FIELD_ORDER_INDEX = new Map<keyof ContentRow, number>(
  FIELD_ORDER.map((f, i) => [f, i]),
);

function todayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export class BufferExcelManager implements ExcelAccessor {
  private workbook: ExcelJS.Workbook;

  private constructor(workbook: ExcelJS.Workbook) {
    this.workbook = workbook;
  }

  // Build from an existing .xlsx buffer, or an empty workbook when none/blank.
  static async fromBuffer(buffer?: Buffer | null): Promise<BufferExcelManager> {
    const wb = new ExcelJS.Workbook();
    if (buffer && buffer.length > 0) {
      await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    }
    return new BufferExcelManager(wb);
  }

  private getOrCreateSheet(): ExcelJS.Worksheet {
    let sheet = this.workbook.getWorksheet(SHEET_NAME);
    if (!sheet) {
      sheet = this.workbook.addWorksheet(SHEET_NAME);
      sheet.addRow([...HEADERS]);
    }
    return sheet;
  }

  async ensureFileExists(): Promise<void> {
    this.getOrCreateSheet();
  }

  async readAllRows(): Promise<ContentRow[]> {
    const sheet = this.workbook.getWorksheet(SHEET_NAME);
    if (!sheet) return [];
    const rows: ContentRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const excelRow = sheet.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= HEADERS.length; c += 1) {
        cells.push(cellToString(excelRow.getCell(c).value));
      }
      if (cells.every((v) => v.trim() === "")) continue;
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
    const sheet = this.getOrCreateSheet();
    const full: ContentRow = { ...emptyRow(), ...row };
    sheet.addRow(rowToCellValues(full));
  }

  async updateRow(date: string, updates: Partial<ContentRow>): Promise<void> {
    const sheet = this.getOrCreateSheet();
    let targetRowIndex = -1;
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      if (cellToString(sheet.getRow(r).getCell(1).value) === date) {
        targetRowIndex = r;
        break;
      }
    }
    if (targetRowIndex === -1) return;
    const excelRow = sheet.getRow(targetRowIndex);
    for (const [field, value] of Object.entries(updates) as Array<
      [keyof ContentRow, ContentRow[keyof ContentRow]]
    >) {
      const colIndex = FIELD_ORDER_INDEX.get(field);
      if (colIndex === undefined) continue;
      excelRow.getCell(colIndex + 1).value =
        value === undefined || value === null ? "" : String(value);
    }
    excelRow.commit();
  }

  async deleteRow(date: string): Promise<void> {
    const sheet = this.workbook.getWorksheet(SHEET_NAME);
    if (!sheet) return;
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      if (cellToString(sheet.getRow(r).getCell(1).value) === date) {
        sheet.spliceRows(r, 1);
        return;
      }
    }
  }

  async toBuffer(): Promise<Buffer> {
    this.getOrCreateSheet();
    const out = await this.workbook.xlsx.writeBuffer();
    return Buffer.from(out);
  }
}
