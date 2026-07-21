import { NextResponse } from "next/server";

import { excelManager } from "@/lib/excelManager";
import { logger } from "@/lib/logger";
import { sanitizeRowUpdates } from "@/lib/publishStatus";

export const dynamic = "force-dynamic";

interface RowPatchBody {
  date?: unknown;
  updates?: unknown;
}

/**
 * POST /api/row — persist user edits (publish status, URLs, notes, content) for a
 * single calendar row back to content_calendar.xlsx. Server mode only; folder
 * mode writes the workbook in the browser. Keys are whitelisted to WRITABLE_FIELDS
 * so the call can never touch columns the user didn't intend to edit.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as RowPatchBody;
    const date = typeof body.date === "string" ? body.date.trim() : "";
    if (!date) {
      return NextResponse.json({ error: "Missing 'date'." }, { status: 400 });
    }
    if (typeof body.updates !== "object" || body.updates === null) {
      return NextResponse.json(
        { error: "Missing 'updates' object." },
        { status: 400 },
      );
    }

    const updates = sanitizeRowUpdates(body.updates as Record<string, unknown>);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No writable fields in 'updates'." },
        { status: 400 },
      );
    }

    updates.lastUpdated = new Date().toISOString();
    await excelManager.updateRow(date, updates);

    return NextResponse.json({ status: "saved", date }, { status: 200 });
  } catch (err) {
    logger.error("POST /api/row failed", err);
    return NextResponse.json({ error: "Failed to save row" }, { status: 500 });
  }
}
