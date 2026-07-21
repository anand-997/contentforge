import { NextRequest, NextResponse } from "next/server";

import {
  readAgentPrompts,
  validateAgentPrompts,
  writeAgentPrompts,
} from "@/lib/promptConfig";
import { logger } from "@/lib/logger";
import type { AgentPrompts } from "@/lib/promptConfig";

export const dynamic = "force-dynamic";

// GET/POST /api/prompts — local mode's agent-prompts.json (RICE-POT role/
// instructions/parameters/tone per agent stage, plus image card knobs).
// Mirrors /api/config and /api/domain's shape.
export async function GET(): Promise<NextResponse> {
  try {
    const prompts: AgentPrompts = readAgentPrompts();
    return NextResponse.json(prompts, { status: 200 });
  } catch (err) {
    logger.error("GET /api/prompts failed", err);
    return NextResponse.json(
      { error: "Failed to read agent prompts" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logger.warn("POST /api/prompts — invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateAgentPrompts(body);

  try {
    writeAgentPrompts(validated);
    logger.info("POST /api/prompts — agent prompts updated");
    return NextResponse.json(validated, { status: 200 });
  } catch (err) {
    logger.error("POST /api/prompts failed", err);
    return NextResponse.json(
      { error: "Failed to write agent prompts" },
      { status: 500 },
    );
  }
}
