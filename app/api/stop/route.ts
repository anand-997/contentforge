import { NextResponse } from "next/server";
import { isPipelineLocked, requestStop } from "@/lib/pipelineLock";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// POST /api/stop — ask the running pipeline to stop at the next safe checkpoint.
// Returns 202 if a stop was requested, 409 if nothing is running.
export async function POST(): Promise<NextResponse> {
  try {
    if (!isPipelineLocked()) {
      return NextResponse.json(
        { error: "No pipeline is currently running." },
        { status: 409 },
      );
    }
    requestStop();
    logger.info("POST /api/stop — stop requested");
    return NextResponse.json({ status: "stopping" }, { status: 202 });
  } catch (err) {
    logger.error("POST /api/stop failed", err);
    return NextResponse.json(
      { error: "Failed to request stop" },
      { status: 500 },
    );
  }
}
