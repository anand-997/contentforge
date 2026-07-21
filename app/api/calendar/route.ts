import { NextResponse } from "next/server";

import { excelManager } from "@/lib/excelManager";
import { logger } from "@/lib/logger";
import type { ContentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const rows: ContentRow[] = await excelManager.readAllRows();

    // Sort newest-first by date (YYYY-MM-DD sorts lexicographically).
    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json(sorted, { status: 200 });
  } catch (err) {
    logger.error("GET /api/calendar failed", err);
    return NextResponse.json(
      { error: "Failed to read calendar" },
      { status: 500 },
    );
  }
}
