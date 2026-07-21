import { NextResponse } from "next/server";

import { readConfig } from "@/lib/configManager";
import { extractBuffer } from "@/lib/knowledge/extractors";
import { logger } from "@/lib/logger";
import type { KnowledgeConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ExtractInputFile {
  name: string;
  base64: string;
}

interface ExtractBody {
  files: ExtractInputFile[];
  creds?: { openaiApiKey?: string };
}

// POST /api/extract — extract text from browser-uploaded files entirely in
// memory (no server filesystem), so the deployed/folder-mode app can ingest a
// user's knowledge files. The raw bytes and any provided key are never logged.
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ExtractBody;
    const files = Array.isArray(body.files) ? body.files : [];

    const cfg: KnowledgeConfig = readConfig().knowledge;

    // Use the caller's OpenAI key for this request so the vision fallback works
    // in deployed/multi-user mode where the server has no key of its own.
    if (body.creds?.openaiApiKey && body.creds.openaiApiKey.trim().length > 0) {
      process.env.OPENAI_API_KEY = body.creds.openaiApiKey;
    }

    const results = [];
    for (const file of files) {
      const bytes = Buffer.from(file.base64, "base64");
      const r = await extractBuffer(file.name, bytes, cfg);
      results.push({
        name: file.name,
        text: r.text,
        ocrUsed: r.ocrUsed,
        visionUsed: r.visionUsed,
        scanned: r.scanned,
      });
    }

    return NextResponse.json({ results });
  } catch (err) {
    logger.error("POST /api/extract failed", err);
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}
