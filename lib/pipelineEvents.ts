// lib/pipelineEvents.ts
// Shared in-memory pipeline state + SSE event bus.
// Lives in its own module so both pipeline.ts and agents.ts can emit progress
// without creating a circular import between them.

import { logger } from "./logger";
import type { ApiKeyHealth, StreamEvent } from "@/lib/types";

type EmitStatus = "running" | "idle" | "error";

interface PipelineState {
  running: boolean;
  currentStep: string | null;
  lastUpdated: string | null;
  progress: number; // 0..100
  /** Most recent error reason; set on "error", cleared on run start / "idle". */
  lastError: string | null;
}

const state: PipelineState = {
  running: false,
  currentStep: null,
  lastUpdated: null,
  progress: 0,
  lastError: null,
};

const subscribers = new Set<(e: StreamEvent) => void>();

// Cache of the last live key-health result from preflight (lib/preflight.ts),
// so /api/status can show "invalid" for a present-but-non-working key rather
// than just "healthy". Null = not yet tested this session.
const keyHealthCache: {
  deepseek: ApiKeyHealth | null;
  openai: ApiKeyHealth | null;
} = { deepseek: null, openai: null };

export function setKeyHealth(
  provider: "deepseek" | "openai",
  health: ApiKeyHealth,
): void {
  keyHealthCache[provider] = health;
}

export function getKeyHealthCache(): {
  deepseek: ApiKeyHealth | null;
  openai: ApiKeyHealth | null;
} {
  return { ...keyHealthCache };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function broadcast(status: EmitStatus, step: string): void {
  const event: StreamEvent = {
    step,
    status,
    timestamp: state.lastUpdated ?? new Date().toISOString(),
    progress: state.progress,
    ...(status === "error" ? { errorMessage: state.lastError ?? step } : {}),
  };
  for (const listener of subscribers) {
    try {
      listener(event);
    } catch (err) {
      logger.error("SSE subscriber threw", err);
    }
  }
}

/** Emit a status change with an optional progress value (0–100). */
export function emitStatus(
  status: EmitStatus,
  step: string,
  progress?: number,
): void {
  state.running = status === "running";
  state.currentStep = step;
  state.lastUpdated = new Date().toISOString();
  if (typeof progress === "number") {
    state.progress = clamp(progress);
  }
  // Track the last error so /api/status (the poll fallback) can report the
  // reason even when the live "error" SSE event was missed. A clean completion
  // ("idle") clears it.
  if (status === "error") {
    state.lastError = step;
  } else if (status === "idle") {
    state.lastError = null;
  }
  broadcast(status, step);
}

/**
 * Report fine-grained progress mid-step (e.g. per platform in Agent 2)
 * without changing the running/idle status.
 */
export function reportProgress(progress: number, step?: string): void {
  state.progress = clamp(progress);
  state.lastUpdated = new Date().toISOString();
  if (step) {
    state.currentStep = step;
  }
  broadcast(state.running ? "running" : "idle", step ?? state.currentStep ?? "");
}

/** Reset progress to 0 (and clear any stale error) at the very start of a run. */
export function resetProgress(): void {
  state.progress = 0;
  state.lastError = null;
}

export function getPipelineState(): PipelineState {
  return { ...state };
}

export function subscribePipeline(
  listener: (e: StreamEvent) => void,
): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
