import { NextResponse } from "next/server";

import { BufferExcelManager } from "@/lib/excelBuffer";
import {
  createBufferContext,
  CollectedImageSink,
  type RunCreds,
} from "@/lib/runContext";
import { validateConfig } from "@/lib/configManager";
import { validateDomainConfig } from "@/lib/domainConfig";
import { validateAgentPrompts } from "@/lib/promptConfig";
import { resolveStartStep } from "@/lib/pipeline";
import {
  agent1TopicGenerator,
  agent2ContentWriter,
  agent3ImageGenerator,
} from "@/lib/agents";
import { logger } from "@/lib/logger";
import type {
  BrandVoice,
  GenerationLogEntry,
  WeeklyTheme,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Generation runs several LLM calls; needs a generous function timeout. Hosts
// with short serverless limits should raise this or drive the steps per-call.
export const maxDuration = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// Folder mode resolves the day's theme/voice/material/history in the browser
// and posts them here. Each parser returns undefined for anything malformed so
// the agents fall back to their defaults rather than crashing.
function parseTheme(v: unknown): WeeklyTheme | undefined {
  if (
    isRecord(v) &&
    typeof v.theme === "string" &&
    isStringArray(v.keywords) &&
    typeof v.pillar === "string" &&
    isStringArray(v.learningTags)
  ) {
    const theme: WeeklyTheme = {
      theme: v.theme,
      keywords: v.keywords,
      pillar: v.pillar as WeeklyTheme["pillar"],
      learningTags: v.learningTags,
    };
    if (isStringArray(v.knowledgeFiles)) {
      theme.knowledgeFiles = v.knowledgeFiles;
    }
    return theme;
  }
  return undefined;
}

function parseVoice(v: unknown): BrandVoice | undefined {
  if (
    isRecord(v) &&
    typeof v.name === "string" &&
    typeof v.persona === "string" &&
    isStringArray(v.toneDirectives)
  ) {
    return {
      name: v.name,
      persona: v.persona,
      toneDirectives: v.toneDirectives,
    };
  }
  return undefined;
}

function parseHistory(v: unknown): GenerationLogEntry[] | undefined {
  if (!Array.isArray(v)) {
    return undefined;
  }
  const entries: GenerationLogEntry[] = [];
  for (const item of v) {
    if (
      isRecord(item) &&
      typeof item.date === "string" &&
      typeof item.topic === "string" &&
      typeof item.pillar === "string" &&
      typeof item.structure === "string" &&
      typeof item.hookArchetype === "string" &&
      typeof item.hook === "string" &&
      typeof item.closer === "string"
    ) {
      entries.push({
        date: item.date,
        topic: item.topic,
        pillar: item.pillar,
        structure: item.structure,
        hookArchetype: item.hookArchetype,
        hook: item.hook,
        closer: item.closer,
      });
    }
  }
  return entries;
}

// POST /api/generate
// Body: { creds: {deepseekApiKey, openaiApiKey?, geminiApiKey?}, workbookBase64 }
// Runs the resumable pipeline fully in memory (no server filesystem state) and
// returns the updated workbook + generated images for the browser to write back
// to the user's folder. Keys are used transiently and never persisted/logged.
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const credsRaw = isRecord(body.creds) ? body.creds : {};
  const creds: RunCreds = {
    deepseekApiKey:
      typeof credsRaw.deepseekApiKey === "string" ? credsRaw.deepseekApiKey.trim() : "",
    openaiApiKey:
      typeof credsRaw.openaiApiKey === "string" ? credsRaw.openaiApiKey.trim() : "",
    geminiApiKey:
      typeof credsRaw.geminiApiKey === "string" ? credsRaw.geminiApiKey.trim() : "",
    tavilyApiKey:
      typeof credsRaw.tavilyApiKey === "string" ? credsRaw.tavilyApiKey.trim() : "",
  };
  if (!creds.deepseekApiKey) {
    return NextResponse.json(
      { error: "DEEPSEEK_API_KEY is missing. Add it to credentials.env in your folder." },
      { status: 400 },
    );
  }

  const workbookBase64 =
    typeof body.workbookBase64 === "string" ? body.workbookBase64 : "";

  // Optional folder-mode overrides (validated defensively; malformed → ignored).
  const theme = parseTheme(body.theme);
  const voice = parseVoice(body.voice);
  const material = typeof body.material === "string" ? body.material : undefined;
  const history = parseHistory(body.history);
  // Regenerating a past day targets that date; default (undefined) = today.
  const targetDate =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : undefined;

  try {
    // Stateless: config/domain/prompts come from the visitor's own storage
    // (posted in the body, same as theme/voice/material/history above), never
    // from the server filesystem — each visitor's brand/settings stay their
    // own. Missing/malformed fields fall back to safe, brand-neutral defaults
    // rather than throwing. The local-only knowledge feature is always off (a
    // deployed visitor has no learnings corpus on the server).
    const config = validateConfig(body.config);
    config.knowledge.enabled = false;
    const domain = validateDomainConfig(body.domain);
    const agentPrompts = validateAgentPrompts(body.agentPrompts);

    const buffer = workbookBase64
      ? Buffer.from(workbookBase64, "base64")
      : null;
    const mgr = await BufferExcelManager.fromBuffer(buffer);
    await mgr.ensureFileExists();

    const sink = new CollectedImageSink();
    const ctx = createBufferContext({
      creds,
      config,
      domain,
      prompts: agentPrompts,
      excel: mgr,
      images: sink,
      targetDate,
      theme,
      voice,
      material,
      history,
    });

    const existing = targetDate
      ? await mgr.getRowForDate(targetDate)
      : await mgr.getTodayRow();
    let note = "";

    if (existing?.status === "Done") {
      note = "Already completed for today.";
    } else {
      const start = resolveStartStep(existing?.status);
      if (start <= 1) {
        await agent1TopicGenerator(ctx);
      }
      if (start <= 2) {
        const failed = await agent2ContentWriter(ctx);
        if (failed.length > 0) {
          note = `${failed.length} platform(s) failed: ${failed.join(", ")}. Generate again to retry.`;
        }
      }
      if (note === "" && start <= 3) {
        const warning = await agent3ImageGenerator(ctx);
        if (warning) note = warning;
      }
    }

    const updated = await mgr.toBuffer();
    const row = targetDate
      ? await mgr.getRowForDate(targetDate)
      : await mgr.getTodayRow();

    return NextResponse.json({
      workbookBase64: updated.toString("base64"),
      images: sink.images.map((img) => ({
        name: img.name,
        base64: img.buffer.toString("base64"),
      })),
      status: row?.status ?? null,
      errorMessage: row?.errorMessage ?? null,
      agentLog: row?.agentLog ?? null,
      note,
    });
  } catch (err) {
    // Log the error only — never the request body / keys.
    logger.error("POST /api/generate failed", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 },
    );
  }
}
