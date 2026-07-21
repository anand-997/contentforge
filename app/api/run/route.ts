import { NextResponse } from "next/server";

import { isPipelineLocked } from "@/lib/pipelineLock";
import { runPipeline } from "@/lib/pipeline";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    if (isPipelineLocked()) {
      logger.warn("POST /api/run rejected — pipeline already running");
      return NextResponse.json(
        { error: "Pipeline already running" },
        { status: 409 },
      );
    }

    // Fire-and-forget. NEVER await runPipeline — return immediately.
    void runPipeline();

    logger.info("POST /api/run — pipeline started");
    return NextResponse.json({ status: "started" }, { status: 202 });
  } catch (err) {
    logger.error("POST /api/run failed", err);
    return NextResponse.json(
      { error: "Failed to start pipeline" },
      { status: 500 },
    );
  }
}
