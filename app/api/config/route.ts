import { NextRequest, NextResponse } from "next/server";

import {
  readConfig,
  validateConfig,
  writeConfig,
} from "@/lib/configManager";
import { startScheduler } from "@/lib/scheduler";
import { logger } from "@/lib/logger";
import type { ContentForgeConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const config: ContentForgeConfig = readConfig();
    return NextResponse.json(config, { status: 200 });
  } catch (err) {
    logger.error("GET /api/config failed", err);
    return NextResponse.json(
      { error: "Failed to read config" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logger.warn("POST /api/config — invalid JSON body");
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  let validated: ContentForgeConfig;
  try {
    validated = validateConfig(body);
  } catch (err) {
    logger.warn("POST /api/config — config validation failed");
    const message =
      err instanceof Error ? err.message : "Invalid configuration";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    writeConfig(validated);
    // Apply the (possibly new) cron schedule immediately.
    startScheduler();
    logger.info("POST /api/config — config updated, scheduler restarted");
    return NextResponse.json(validated, { status: 200 });
  } catch (err) {
    logger.error("POST /api/config failed", err);
    return NextResponse.json(
      { error: "Failed to write config" },
      { status: 500 },
    );
  }
}
