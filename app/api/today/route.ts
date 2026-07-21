import { NextResponse } from "next/server";

import { excelManager } from "@/lib/excelManager";
import { logger } from "@/lib/logger";
import type { ContentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const row: ContentRow | null = await excelManager.getTodayRow();
    return NextResponse.json(row, { status: 200 });
  } catch (err) {
    logger.error("GET /api/today failed", err);
    return NextResponse.json(
      { error: "Failed to read today's row" },
      { status: 500 },
    );
  }
}
