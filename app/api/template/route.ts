import { NextResponse } from "next/server";

import { BufferExcelManager } from "@/lib/excelBuffer";
import { CREDENTIALS_TEMPLATE } from "@/lib/credentialsTemplate";
import {
  GENERATION_LOG_TEMPLATE,
  KNOWLEDGE_README,
  WEEKLY_PLAN_TEMPLATE,
} from "@/lib/templates";
import { GENERIC_DEFAULT_DOMAIN } from "@/lib/domainConfig";
import { DEFAULT_CONFIG } from "@/lib/configManager";
import { DEFAULT_PROMPTS } from "@/lib/promptConfig";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/template — returns the starter files the client writes into a freshly
// chosen folder: the credentials text, an empty 32-column workbook, the weekday
// plan, the knowledge folder readme, an empty generation log, and brand-neutral
// starters for content-domain.json / contentforge.config.json / agent-prompts.json
// so a brand-new visitor's identity/settings live in their own folder from the
// start, not on the server.
export async function GET(): Promise<NextResponse> {
  try {
    const mgr = await BufferExcelManager.fromBuffer(null);
    await mgr.ensureFileExists(); // adds the sheet + 32-col header row
    const buf = await mgr.toBuffer();
    return NextResponse.json({
      credentialsEnv: CREDENTIALS_TEMPLATE,
      workbookBase64: buf.toString("base64"),
      weeklyPlanJson: WEEKLY_PLAN_TEMPLATE,
      knowledgeReadme: KNOWLEDGE_README,
      generationLogJson: GENERATION_LOG_TEMPLATE,
      contentDomainJson: JSON.stringify(GENERIC_DEFAULT_DOMAIN, null, 2) + "\n",
      configJson: JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
      agentPromptsJson: JSON.stringify(DEFAULT_PROMPTS, null, 2) + "\n",
    });
  } catch (err) {
    logger.error("GET /api/template failed", err);
    return NextResponse.json({ error: "Failed to build template" }, { status: 500 });
  }
}
