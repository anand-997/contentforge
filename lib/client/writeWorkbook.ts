// lib/client/writeWorkbook.ts
// Apply a single-row update to a content_calendar.xlsx ArrayBuffer entirely in
// the browser (folder mode). The mirror of lib/client/parseWorkbook.ts on the
// write side — it loads the buffer, mutates the row whose col A === date by
// FIELD_ORDER index, stamps LastUpdated, and re-serializes. Reuses the shared
// schema so columns match the server's ExcelManager exactly.

import ExcelJS from "exceljs";
import { FIELD_ORDER, SHEET_NAME, cellToString } from "@/lib/excelSchema";
import type { ContentRow } from "@/lib/types";

/**
 * Returns a NEW ArrayBuffer with `updates` applied to the row for `date`.
 * If no matching row exists the workbook is returned unchanged (re-serialized).
 * `LastUpdated` (col X) is always stamped to now so the UI reflects the edit.
 */
export async function applyRowUpdates(
  buffer: ArrayBuffer,
  date: string,
  updates: Partial<ContentRow>,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.getWorksheet(SHEET_NAME);
  if (!sheet) return buffer;

  let targetRow = -1;
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    if (cellToString(sheet.getRow(r).getCell(1).value) === date) {
      targetRow = r;
      break;
    }
  }
  if (targetRow === -1) return buffer;

  const stamped: Partial<ContentRow> = {
    ...updates,
    lastUpdated: new Date().toISOString(),
  };

  const excelRow = sheet.getRow(targetRow);
  for (const [field, value] of Object.entries(stamped) as Array<
    [keyof ContentRow, ContentRow[keyof ContentRow]]
  >) {
    const colIndex = FIELD_ORDER.indexOf(field);
    if (colIndex === -1) continue;
    excelRow.getCell(colIndex + 1).value =
      value === undefined || value === null ? "" : String(value);
  }
  excelRow.commit();

  return serialize(wb);
}

/**
 * Returns a NEW ArrayBuffer with the row for `date` removed entirely. If no
 * matching row exists the workbook is returned unchanged (re-serialized).
 */
export async function deleteRowFromWorkbook(
  buffer: ArrayBuffer,
  date: string,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.getWorksheet(SHEET_NAME);
  if (!sheet) return buffer;

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    if (cellToString(sheet.getRow(r).getCell(1).value) === date) {
      sheet.spliceRows(r, 1);
      break;
    }
  }
  return serialize(wb);
}

// ExcelJS returns an ArrayBuffer (browser) or a Buffer (node) at runtime;
// normalize to a standalone ArrayBuffer the storage provider can write.
async function serialize(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const out = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(out as unknown as ArrayBuffer);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
