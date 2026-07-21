import { logger } from "@/lib/logger";
import { getPipelineState, subscribePipeline } from "@/lib/pipeline";
import type { StreamEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        const send = (event: StreamEvent): void => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          } catch {
            // Controller may already be closed if the client disconnected.
            logger.warn("SSE enqueue failed (client likely disconnected)");
          }
        };

        // Initial event reflecting current pipeline state.
        const state = getPipelineState();
        const initial: StreamEvent = {
          step: state.currentStep ?? state.lastError ?? "idle",
          status: state.running ? "running" : state.lastError ? "error" : "idle",
          timestamp: state.lastUpdated ?? new Date().toISOString(),
          progress: state.progress,
          ...(state.lastError ? { errorMessage: state.lastError } : {}),
        };
        send(initial);

        // Subscribe to subsequent pipeline events.
        unsubscribe = subscribePipeline((event: StreamEvent): void => {
          send(event);
        });

        // Heartbeat keep-alive: emit an SSE comment every 15s so the
        // connection stays open and a dead stream becomes detectable.
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            if (heartbeat) {
              clearInterval(heartbeat);
            }
          }
        }, 15000);
      },
      cancel(): void {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    logger.error("GET /api/stream failed", err);
    return new Response(
      JSON.stringify({ error: "Failed to open stream" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
