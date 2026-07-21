// lib/preflight.ts
// Live preflight validation of the Deepseek + OpenAI (image) API keys before a run.
// Each check is self-contained (no imports from agents.ts) and makes the
// cheapest possible call so a misconfigured key fails fast with a clear,
// actionable reason rather than a raw SDK error mid-pipeline.
// NOTE: deliberately NO request timeouts here (per spec).

import OpenAI from "openai";
import { logger } from "./logger";
import type { ContentForgeConfig } from "@/lib/types";

export type PreflightResult =
  | { ok: true }
  | {
      ok: false;
      kind: "missing" | "auth" | "quota" | "model" | "network";
      reason: string;
    };

function errStatus(err: unknown): number | undefined {
  return (err as { status?: number }).status;
}

function errCode(err: unknown): string {
  return (err as { code?: string }).code ?? "";
}

function errMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function looksLikeNetwork(err: unknown): boolean {
  const code = errCode(err);
  const message = errMessage(err);
  return (
    /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed/i.test(
      message,
    ) || /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(code)
  );
}

// ---------------------------------------------------------------------------
// Deepseek — required for every step.
// ---------------------------------------------------------------------------

export async function preflightDeepseek(
  config: ContentForgeConfig,
): Promise<PreflightResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      kind: "missing",
      reason:
        "Deepseek API key missing. Add DEEPSEEK_API_KEY to .env.local and restart the server.",
    };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.models.deepseekBaseUrl,
  });

  try {
    await client.chat.completions.create({
      model: config.models.deepseekModel,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true };
  } catch (err) {
    const status = errStatus(err);
    const message = errMessage(err);

    if (status === 401 || status === 403) {
      return {
        ok: false,
        kind: "auth",
        reason:
          "Deepseek rejected the API key (unauthorized). Check DEEPSEEK_API_KEY in .env.local is correct and active, then restart the server.",
      };
    }
    if (status === 429) {
      return {
        ok: false,
        kind: "quota",
        reason:
          "Deepseek returned 429 — the account is out of quota or has a billing issue. Top up credits or check billing, then re-run.",
      };
    }
    if (status === 404) {
      return {
        ok: false,
        kind: "model",
        reason: `Deepseek model '${config.models.deepseekModel}' was not found (404). Fix models.deepseekModel in contentforge.config.json.`,
      };
    }
    if (looksLikeNetwork(err)) {
      return {
        ok: false,
        kind: "network",
        reason:
          "Could not reach Deepseek (network error). Check your internet connection and the deepseekBaseUrl in contentforge.config.json, then re-run.",
      };
    }
    logger.warn(`[Preflight] Deepseek check failed (unclassified): ${message}`);
    return {
      ok: false,
      kind: "network",
      reason: `Deepseek preflight failed: ${message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI — only powers Agent 3 (images). A cheap models.retrieve check;
// never call image generation (that would waste image quota/credits).
// ---------------------------------------------------------------------------

export async function preflightOpenAIImage(
  config: ContentForgeConfig,
): Promise<PreflightResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      kind: "missing",
      reason:
        "OpenAI API key missing — images will be skipped. Add OPENAI_API_KEY to .env.local.",
    };
  }

  const client = new OpenAI({ apiKey }); // default api.openai.com — NOT the Deepseek base URL

  try {
    await client.models.retrieve(config.models.openaiImageModel);
    return { ok: true };
  } catch (err) {
    const status = errStatus(err);
    const message = errMessage(err);

    if (status === 401) {
      return {
        ok: false,
        kind: "auth",
        reason:
          "OpenAI rejected the API key (unauthorized). Images will be skipped. Check OPENAI_API_KEY in .env.local is correct and active.",
      };
    }
    if (status === 403) {
      return {
        ok: false,
        kind: "auth",
        reason: `OpenAI returned 403 for ${config.models.openaiImageModel}. Your OpenAI organization may need verification to use this image model (https://platform.openai.com/settings/organization). Images will be skipped until then.`,
      };
    }
    if (status === 404) {
      return {
        ok: false,
        kind: "model",
        reason: `OpenAI image model '${config.models.openaiImageModel}' was not found (404). Fix models.openaiImageModel in contentforge.config.json.`,
      };
    }
    if (status === 429) {
      return {
        ok: false,
        kind: "quota",
        reason:
          "OpenAI returned 429 — rate-limited or out of quota/credits. Images will be skipped; check billing and re-run.",
      };
    }
    if (looksLikeNetwork(err)) {
      return {
        ok: false,
        kind: "network",
        reason:
          "Could not reach OpenAI (network error). Images will be skipped; check your internet connection and re-run.",
      };
    }
    logger.warn(`[Preflight] OpenAI image check failed (unclassified): ${message}`);
    return {
      ok: false,
      kind: "network",
      reason: `OpenAI image preflight failed: ${message}`,
    };
  }
}
