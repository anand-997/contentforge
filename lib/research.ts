// lib/research.ts
// Optional web-research grounding. Before writing, the agent can pull real,
// cite-able context about the chosen topic so posts are grounded in actual
// discussion/examples instead of invented specifics. Uses Tavily (LLM-oriented
// search, single key, clean JSON) via plain fetch — no new npm dependency.
//
// Graceful by design: with no API key it returns null and the pipeline falls
// back to the author's own material / honest general mode. It never throws.

import { logger } from "./logger";

export interface ResearchResult {
  /** Distilled real-world context to feed the brief's fact extraction. */
  context: string;
  /** Source URLs the context came from (for the agent log). */
  sources: string[];
}

interface TavilyResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

interface TavilyResponse {
  answer?: unknown;
  results?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const DEFAULT_MAX_CHARS = 4000;

export async function webResearch(opts: {
  apiKey?: string;
  topic: string;
  keywords: ReadonlyArray<string>;
  maxChars?: number;
}): Promise<ResearchResult | null> {
  const key = opts.apiKey?.trim();
  if (!key) return null; // unconfigured → skip silently

  const query = [opts.topic, ...opts.keywords.slice(0, 4)]
    .join(" ")
    .trim()
    .slice(0, 380);
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!res.ok) {
      logger.warn(`[research] Tavily search failed (HTTP ${res.status}) — skipping`);
      return null;
    }
    const data = (await res.json()) as TavilyResponse;
    const results: TavilyResult[] = Array.isArray(data.results)
      ? (data.results as TavilyResult[])
      : [];

    const parts: string[] = [];
    const sources: string[] = [];
    const answer = asString(data.answer).trim();
    if (answer) parts.push(`Summary: ${answer}`);

    for (const r of results) {
      const title = asString(r.title).trim();
      const content = asString(r.content).trim();
      const url = asString(r.url).trim();
      if (content) {
        parts.push(`- ${title ? `${title}: ` : ""}${content}`);
      }
      if (url) sources.push(url);
    }

    const context = parts.join("\n").slice(0, maxChars);
    if (context.trim().length === 0) return null;
    return { context, sources };
  } catch (err) {
    logger.warn(
      `[research] web research errored (${err instanceof Error ? err.message : String(err)}) — skipping`,
    );
    return null;
  }
}
