// lib/pipeline.ts
// Orchestrates Agents 1/2/3. Pipeline state + SSE bridge live in pipelineEvents.

import { logger } from "./logger";
import {
  acquireLock,
  releaseLock,
  isPipelineLocked,
  PipelineStoppedError,
} from "./pipelineLock";
import { excelManager } from "./excelManager";
import {
  agent1TopicGenerator,
  agent2ContentWriter,
  agent3ImageGenerator,
} from "./agents";
import {
  emitStatus,
  getPipelineState,
  resetProgress,
  setKeyHealth,
} from "./pipelineEvents";
import { preflightDeepseek, preflightOpenAIImage } from "./preflight";
import { readConfig } from "./configManager";
import { createLocalContext } from "./runContext";
import type { StatusEnum } from "@/lib/types";

function todayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// Re-export so existing importers (status route/helper, stream route) keep working.
export { getPipelineState, subscribePipeline } from "./pipelineEvents";

export function resolveStartStep(status: StatusEnum | undefined): number {
  switch (status) {
    case undefined:
    case "Pending":
      return 1;
    case "Writing":
      return 2;
    case "Imaging":
      return 3;
    case "Done":
      return 99;
    case "Error":
      return 1;
    default:
      return 1;
  }
}

// Persist a preflight failure to today's Excel row so the dashboard shows the
// reason after a reload. Upserts via the existing serialized ExcelManager
// methods (never fs.writeFileSync); the 32-column A–AF schema is unchanged.
async function persistPreflightError(reason: string, date: string): Promise<void> {
  await excelManager.ensureFileExists();
  const existing = await excelManager.getRowForDate(date);
  if (existing) {
    await excelManager.updateRow(date, {
      status: "Error",
      errorMessage: reason,
      lastUpdated: nowIso(),
    });
  } else {
    await excelManager.appendRow({
      date,
      status: "Error",
      errorMessage: reason,
      lastUpdated: nowIso(),
    });
  }
}

export async function runPipeline(opts?: { targetDate?: string }): Promise<void> {
  if (isPipelineLocked()) {
    logger.warn("Pipeline already running — skipping trigger");
    return;
  }

  acquireLock();

  const date = opts?.targetDate ?? todayString();

  try {
    resetProgress();

    const config = readConfig();
    // Local run context: same filesystem/env behavior the agents have always used.
    const ctx = createLocalContext(config);
    // Regenerating a past day targets that date end-to-end; default is today.
    if (opts?.targetDate) ctx.targetDate = opts.targetDate;

    // If the target row is already Done, skip BEFORE preflight so we never spend
    // an API call (Deepseek ping / OpenAI model check) on a completed day.
    const existingRow = await excelManager.getRowForDate(date);
    if (existingRow?.status === "Done") {
      logger.info("Already completed for this day — skipping");
      emitStatus("idle", "Already completed for today", 100);
      return;
    }

    // Live preflight: Deepseek is required for every step. Validate the key
    // with a minimal call and report key health to the UI. On failure, persist
    // an Error row so the dashboard shows the reason across reloads.
    const ds = await preflightDeepseek(config);
    setKeyHealth(
      "deepseek",
      ds.ok ? "healthy" : ds.kind === "missing" ? "missing" : "invalid",
    );
    if (!ds.ok) {
      logger.error(`Pipeline blocked (Deepseek preflight): ${ds.reason}`);
      await persistPreflightError(ds.reason, date);
      emitStatus("error", ds.reason, 0);
      return;
    }

    // OpenAI only powers Agent 3 when imageEngine is "openai". The default
    // "template" engine renders branded PNGs locally and needs no API key, so a
    // failed OpenAI preflight must not block image generation in that mode.
    const needsOpenAI = config.models.imageEngine === "openai";
    const img = await preflightOpenAIImage(config);
    setKeyHealth(
      "openai",
      img.ok ? "healthy" : img.kind === "missing" ? "missing" : "invalid",
    );
    if (needsOpenAI && !img.ok) {
      logger.warn(`OpenAI image preflight not ok (images may be skipped): ${img.reason}`);
    }

    const startStep = resolveStartStep(existingRow?.status);

    if (startStep <= 1) {
      emitStatus(
        "running",
        "Agent 1: Selecting pillar and generating topic...",
        8,
      );
      await agent1TopicGenerator(ctx);
      emitStatus("running", "Topic ready — preparing to write content", 20);
    }

    if (startStep <= 2) {
      emitStatus("running", "Agent 2: Writing platform content...", 22);
      // Agent 2 reports its own sub-progress (22 -> 78) as each platform lands.
      // It returns the list of FAILED platform names (empty = all succeeded).
      const failed = await agent2ContentWriter(ctx);
      if (failed.length > 0) {
        const msg = `${failed.length} platform(s) failed: ${failed.join(", ")}. Run again to retry.`;
        logger.error(`Pipeline halted after Agent 2: ${msg}`);
        // Skip Agent 3 — the text content is incomplete.
        emitStatus("error", msg, getPipelineState().progress);
        return;
      }
    }

    if (startStep <= 3) {
      if (needsOpenAI && !img.ok) {
        // OpenAI key/model/quota problem AND the AI image engine is selected —
        // deliver the finished text and tell the user why images are
        // unavailable. Not an error: text is complete.
        const msg = `Content ready. Images unavailable: ${img.reason}`;
        logger.warn(`Skipping Agent 3 — ${img.reason}`);
        emitStatus("idle", msg, 100);
        return;
      }
      emitStatus("running", "Agent 3: Generating branded images...", 82);
      // Agent 3 never throws on image issues — it returns a warning string
      // (or null) so a failed image can't hide the finished text content.
      const imageWarning = await agent3ImageGenerator(ctx);
      if (imageWarning) {
        emitStatus("idle", `Content ready. ${imageWarning}`, 100);
        logger.warn(`Pipeline complete with image warning: ${imageWarning}`);
        return;
      }
    }

    emitStatus("idle", "Pipeline complete — content ready", 100);
    logger.info("Pipeline completed successfully");
  } catch (err) {
    if (err instanceof PipelineStoppedError) {
      // Clean stop — partial work is already saved per platform/image, and the
      // row status (Writing/Imaging) lets a re-run resume from this point.
      emitStatus(
        "idle",
        "Pipeline stopped. Re-run to continue from where it left off.",
        getPipelineState().progress,
      );
      logger.warn("Pipeline stopped by user");
    } else {
      emitStatus(
        "error",
        `Pipeline failed: ${String(err)}`,
        getPipelineState().progress,
      );
      logger.error("Pipeline failed", err);
    }
  } finally {
    releaseLock();
  }
}
