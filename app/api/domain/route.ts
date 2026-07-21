import { NextRequest, NextResponse } from "next/server";

import {
  readDomainConfig,
  validateDomainConfig,
  writeDomainConfig,
} from "@/lib/domainConfig";
import { logger } from "@/lib/logger";
import type { ContentDomainConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET/POST /api/domain — local mode's content-domain.json (brand, pillars,
// enabled platforms, voice samples, hashtags, Dev.to tags). The "what to
// create" counterpart to /api/config's "how to run". Mirrors that route's
// shape exactly.
export async function GET(): Promise<NextResponse> {
  try {
    const domain: ContentDomainConfig = readDomainConfig();
    return NextResponse.json(domain, { status: 200 });
  } catch (err) {
    logger.error("GET /api/domain failed", err);
    return NextResponse.json(
      { error: "Failed to read content domain" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logger.warn("POST /api/domain — invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateDomainConfig(body);

  try {
    writeDomainConfig(validated);
    logger.info("POST /api/domain — content domain updated");
    return NextResponse.json(validated, { status: 200 });
  } catch (err) {
    logger.error("POST /api/domain failed", err);
    return NextResponse.json(
      { error: "Failed to write content domain" },
      { status: 500 },
    );
  }
}
