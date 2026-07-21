"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamEvent } from "@/lib/types";
import { Spinner } from "./statusBadge";

export interface LiveLogFeedProps {
  /** Whether the pipeline is currently running. */
  running: boolean;
  /** Recent SSE events (oldest first). */
  events: StreamEvent[];
  /** Whether the SSE connection is live (vs. polling fallback). */
  connected: boolean;
  /** Overall pipeline progress 0–100. */
  progress: number;
  /** Whether the latest run has gone stale (no recent update). */
  stale?: boolean;
  /** Seconds since the last status update, when known. */
  secondsSinceUpdate?: number | null;
  /** Whether the server is currently reachable. */
  serverReachable?: boolean;
}

/**
 * Collapsible live log panel. Renders only while the pipeline runs.
 * - Desktop: docked bottom-right.
 * - Mobile: bottom sheet spanning full width.
 */
export function LiveLogFeed({
  running,
  events,
  connected,
  progress,
  stale,
  secondsSinceUpdate,
  serverReachable,
}: LiveLogFeedProps): JSX.Element | null {
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest line.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, open]);

  // Re-open whenever a new run begins.
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  if (!running) return null;

  const recent = events.slice(-10);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:left-auto sm:right-4 sm:w-[420px] sm:px-0">
      <div className="panel overflow-hidden border-teal/30 shadow-glow animate-fade-up">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="focus-ring flex w-full items-center gap-2 border-b border-hairline bg-ink-700/80 px-4 py-2.5 text-left"
        >
          <Spinner className="text-teal" />
          <span className="text-sm font-semibold text-white">
            Live pipeline log
          </span>
          {serverReachable === false ? (
            <span className="flex items-center gap-1 text-[0.62rem] text-status-error">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-status-error animate-pulse-soft"
              />
              Disconnected — can&apos;t reach server
            </span>
          ) : stale ? (
            <span className="flex items-center gap-1 text-[0.62rem] text-amber">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse-soft"
              />
              Stalled — no update for{" "}
              {typeof secondsSinceUpdate === "number" ? secondsSinceUpdate : "—"}s
            </span>
          ) : (
            <span
              className={`flex items-center gap-1 text-[0.62rem] ${
                connected ? "text-teal" : "text-amber"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? "bg-teal animate-pulse-soft" : "bg-amber animate-pulse-soft"
                }`}
              />
              {connected ? "live" : "polling"}
            </span>
          )}
          <span className="ml-auto font-mono text-xs font-semibold text-status-imaging">
            {Math.round(progress)}%
          </span>
          <span
            aria-hidden="true"
            className={`text-subtext transition-transform ${
              open ? "" : "rotate-180"
            }`}
          >
            ▾
          </span>
        </button>

        {/* Thin progress bar under the header */}
        <div className="h-1 w-full bg-ink-700">
          <span
            className="block h-full bg-status-imaging transition-all duration-500"
            style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
          />
        </div>

        {open && (
          <div
            ref={scrollRef}
            className="max-h-48 overflow-y-auto bg-ink-900/80 px-4 py-3 font-mono text-xs"
          >
            {recent.length === 0 ? (
              <p className="text-subtext">Waiting for the first event…</p>
            ) : (
              <ul className="space-y-1.5">
                {recent.map((ev, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 text-subtext/70">
                      {formatTime(ev.timestamp)}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`shrink-0 ${
                        ev.status === "error"
                          ? "text-status-error"
                          : ev.status === "idle"
                            ? "text-teal"
                            : "text-status-imaging"
                      }`}
                    >
                      ›
                    </span>
                    <span className="break-words text-white/85">{ev.step}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
