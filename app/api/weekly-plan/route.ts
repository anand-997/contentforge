import { NextRequest, NextResponse } from "next/server";

import {
  readWeeklyPlan,
  validateWeeklyPlan,
  writeWeeklyPlan,
} from "@/lib/weeklyConfig";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET/POST /api/weekly-plan — local mode's weekly-plan.json (per-weekday
// theme + brand voice rotation). Mirrors /api/config, /api/domain, /api/prompts.
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(readWeeklyPlan(), { status: 200 });
  } catch (err) {
    logger.error("GET /api/weekly-plan failed", err);
    return NextResponse.json(
      { error: "Failed to read weekly plan" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logger.warn("POST /api/weekly-plan — invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateWeeklyPlan(body);

  try {
    writeWeeklyPlan(validated);
    logger.info("POST /api/weekly-plan — weekly plan updated");
    return NextResponse.json(validated, { status: 200 });
  } catch (err) {
    logger.error("POST /api/weekly-plan failed", err);
    return NextResponse.json(
      { error: "Failed to write weekly plan" },
      { status: 500 },
    );
  }
}
