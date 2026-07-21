import { NextResponse } from "next/server";

import { excelManager } from "@/lib/excelManager";
import { runPipeline } from "@/lib/pipeline";
import { isPipelineLocked } from "@/lib/pipelineLock";
import { createLocalContext } from "@/lib/runContext";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function imagesForDate(date: string): string[] {
  return [`${date}-medium.png`, `${date}-linkedin.png`, `${date}-ig-1.png`];
}

/**
 * POST /api/regenerate { date }
 * Deletes the row for `date` and its generated images, then re-runs the pipeline
 * targeting that date — the "delete & regenerate" action (local mode). Defaults
 * to today when `date` is omitted. Fire-and-forget like /api/run (202/409).
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (isPipelineLocked()) {
    return NextResponse.json(
      { error: "Pipeline already running" },
      { status: 409 },
    );
  }

  let date: string | undefined;
  try {
    const body = (await req.json()) as { date?: unknown };
    if (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      date = body.date;
    }
  } catch {
    /* no body → regenerate today */
  }

  try {
    if (date) {
      await excelManager.deleteRow(date);
      const sink = createLocalContext().images;
      for (const name of imagesForDate(date)) {
        await sink.remove(name);
      }
    }
    // Fire-and-forget — the pipeline acquires its own lock and runs the agents
    // for the target date (or today when date is undefined).
    void runPipeline(date ? { targetDate: date } : undefined);
    return NextResponse.json({ status: "started", date: date ?? null }, { status: 202 });
  } catch (err) {
    logger.error("POST /api/regenerate failed", err);
    return NextResponse.json({ error: "Failed to regenerate" }, { status: 500 });
  }
}
