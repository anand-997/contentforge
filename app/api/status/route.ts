import { NextResponse } from "next/server";

import { buildStatusResponse } from "@/lib/status";
import { logger } from "@/lib/logger";
import type { StatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const status: StatusResponse = await buildStatusResponse();
    return NextResponse.json(status, { status: 200 });
  } catch (err) {
    logger.error("GET /api/status failed", err);
    return NextResponse.json(
      { error: "Failed to build status" },
      { status: 500 },
    );
  }
}
