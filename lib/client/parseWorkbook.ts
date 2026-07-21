// lib/client/parseWorkbook.ts
// Parse a content_calendar.xlsx ArrayBuffer (held in the browser) into rows for
// display. Reuses the shared schema so columns match the server exactly.

import ExcelJS from "exceljs";
import {
  FIELD_ORDER,
  SHEET_NAME,
  cellToString,
  rowFromCells,
} from "@/lib/excelSchema";
import type { ContentRow } from "@/lib/types";

export async function parseWorkbook(buffer: ArrayBuffer): Promise<ContentRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.getWorksheet(SHEET_NAME);
  if (!sheet) return [];
  const rows: ContentRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const cells: string[] = [];
    for (let c = 1; c <= FIELD_ORDER.length; c += 1) {
      cells.push(cellToString(sheet.getRow(r).getCell(c).value));
    }
    if (cells.every((v) => v.trim() === "")) continue;
    rows.push(rowFromCells(cells));
  }
  return rows;
}

export function todayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// The bare filename from an image reference like "images/2026-..png" or
// "/images/2026-..png" — used to look the file up in the user's folder.
export function imageBasename(ref: string): string {
  const parts = ref.split(/[\\/]/);
  return parts[parts.length - 1] ?? ref;
}
