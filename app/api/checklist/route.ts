import { NextResponse } from "next/server";

import { buildChecklist } from "@/lib/status";
import { logger } from "@/lib/logger";
import type { ChecklistItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const checklist: ChecklistItem[] = await buildChecklist();
    return NextResponse.json(checklist, { status: 200 });
  } catch (err) {
    logger.error("GET /api/checklist failed", err);
    return NextResponse.json(
      { error: "Failed to build checklist" },
      { status: 500 },
    );
  }
}
