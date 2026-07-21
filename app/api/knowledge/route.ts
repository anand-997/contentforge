import { NextResponse } from "next/server";

import { readConfig } from "@/lib/configManager";
import { buildIndex, readIndex } from "@/lib/knowledge/index";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/knowledge — index status for the dashboard.
export async function GET(): Promise<NextResponse> {
  try {
    const index = await readIndex();
    return NextResponse.json({
      built: index !== null,
      builtAt: index?.builtAt ?? null,
      entries: index?.entries.length ?? 0,
      folder: readConfig().knowledge.folder,
    });
  } catch (err) {
    logger.error("GET /api/knowledge failed", err);
    return NextResponse.json({ error: "Failed to read index" }, { status: 500 });
  }
}

// POST /api/knowledge[?force=1] — (re)build the index. Heavy; local use only.
export async function POST(req: Request): Promise<NextResponse> {
  const cfg = readConfig().knowledge;
  if (!cfg.enabled) {
    return NextResponse.json(
      { error: "knowledge.enabled is false in contentforge.config.json" },
      { status: 400 },
    );
  }
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const summary = await buildIndex(cfg, { force });
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    logger.error("POST /api/knowledge failed", err);
    return NextResponse.json({ error: "Index build failed" }, { status: 500 });
  }
}
