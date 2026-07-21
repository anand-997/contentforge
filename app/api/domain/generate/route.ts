import { NextResponse } from "next/server";
import OpenAI from "openai";

import { validateDomainConfig } from "@/lib/domainConfig";
import { readConfig } from "@/lib/configManager";
import { logger } from "@/lib/logger";
import type { ContentDomainConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// Pull the first {...} JSON object out of a model response (tolerates fences).
function extractJsonObject(text: string): string {
  const t = text.replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start !== -1 && end > start ? t.slice(start, end + 1) : t;
}

// POST /api/domain/generate — AI-assist for onboarding/Settings. Takes a short
// free-text niche description and drafts pillars, keywords, hashtags, Dev.to
// tags, and 1-2 sample posts via one Deepseek call. Never auto-saved — the
// caller reviews/edits the draft before writing it to their own storage.
// Stateless: works identically for local mode (server key) and folder/Drive
// mode (the visitor's own key, posted in the body like /api/generate).
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

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (description.length === 0) {
    return NextResponse.json(
      { error: "Describe your niche first (e.g. \"skincare and beauty tips\")." },
      { status: 400 },
    );
  }

  const credsRaw = isRecord(body.creds) ? body.creds : {};
  const deepseekApiKey =
    (typeof credsRaw.deepseekApiKey === "string" && credsRaw.deepseekApiKey.trim().length > 0
      ? credsRaw.deepseekApiKey.trim()
      : process.env.DEEPSEEK_API_KEY) ?? "";
  if (!deepseekApiKey) {
    return NextResponse.json(
      { error: "A Deepseek API key is required for AI-assist." },
      { status: 400 },
    );
  }

  const brandName = typeof body.brandName === "string" ? body.brandName.trim() : "";

  try {
    const config = readConfig();
    const client = new OpenAI({ apiKey: deepseekApiKey, baseURL: config.models.deepseekBaseUrl });

    const prompt = `A content creator${brandName ? ` named "${brandName}"` : ""} described their niche as:
"""
${description}
"""

Draft a content strategy for them as a practicing expert in that niche, writing content
for other people learning or working in the same space.

Return ONLY valid minified JSON (no markdown, no commentary) with exactly these keys:
{
  "niche": "<short label for this niche, e.g. 'Skincare & Beauty'>",
  "pillars": [
    {"name": "<pillar name>", "weight": <20-35>, "keywords": ["<keyword>", ...4-6 total], "toneHint": "<one sentence describing the voice for this pillar>"}
    ... exactly 4 pillars, each a genuinely distinct angle on the niche (e.g. skill-building, tools/product picks, career/business side, industry opinions) ...
  ],
  "keywords": ["<general niche keyword>", ...8-12 total],
  "hashtagUniverse": ["#<Tag>", ...4-6 total, no spaces, PascalCase],
  "devtoTags": ["<lowercase-tag>", ...2-4 total, only relevant if this niche has a technical/developer angle, else an empty array],
  "voiceSamples": [
    {"pillarId": "<slug of one pillar name, lowercase-hyphenated>", "text": "<a realistic ~120-180 word LinkedIn-style post in this niche's voice, following the pillar's tone, with a hook opening and a closing question. No invented specific numbers, names, or events.>"}
    ... exactly 2 samples, for two different pillars ...
  ]
}`;

    const completion = await client.chat.completions.create({
      model: config.models.deepseekModel,
      max_tokens: 2200,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (completion.choices[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(extractJsonObject(raw)) as unknown;

    if (!isRecord(parsed)) {
      throw new Error("Model returned an unexpected shape");
    }

    // pillars come back without ids — validateDomainConfig derives one from
    // each name (slugify), same as a hand-typed pillar would get in Settings.
    const draft: ContentDomainConfig = validateDomainConfig({
      niche: parsed.niche,
      description,
      brand: isRecord(body.brand) ? body.brand : {},
      pillars: parsed.pillars,
      enabledPlatforms: isRecord(body.enabledPlatforms) ? body.enabledPlatforms : undefined,
      keywords: parsed.keywords,
      hashtagUniverse: parsed.hashtagUniverse,
      devtoTags: parsed.devtoTags,
      voiceSamples: parsed.voiceSamples,
    });

    return NextResponse.json(draft);
  } catch (err) {
    logger.error("POST /api/domain/generate failed", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI-assist failed" },
      { status: 500 },
    );
  }
}
