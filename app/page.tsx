"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChecklistItem,
  ContentDomainConfig,
  ContentForgeConfig,
  ContentRow,
  StatusEnum,
  StatusResponse,
  StreamEvent,
} from "@/lib/types";
import { Sidebar } from "@/components/Sidebar";
import { StatusCards } from "@/components/StatusCards";
import { ContentTabs } from "@/components/ContentTabs";
import { LiveLogFeed } from "@/components/LiveLogFeed";
import { ToastProvider, useToast } from "@/components/ui";
import { LoadingProvider, useGlobalLoading } from "@/components/LoadingProvider";
import type { Platform, PublishState } from "@/lib/publishStatus";
import dynamic from "next/dynamic";

// Deployed multi-user mode uses the browser folder picker; local/unset keeps the
// existing server-backed dashboard exactly as before. The folder UI (and its
// exceljs client parser) is lazy-loaded so local mode's bundle is unchanged.
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE;

const FolderRoot = dynamic(
  () => import("@/components/FolderApp").then((m) => m.FolderRoot),
  { ssr: false },
);

export default function Page(): JSX.Element {
  if (STORAGE_MODE === "folder") {
    return (
      <LoadingProvider>
        <ToastProvider>
          <FolderRoot />
        </ToastProvider>
      </LoadingProvider>
    );
  }
  return (
    <LoadingProvider>
      <ToastProvider>
        <Dashboard />
      </ToastProvider>
    </LoadingProvider>
  );
}

function Dashboard(): JSX.Element {
  const toast = useToast();
  const { run: runLoading } = useGlobalLoading();

  // ---- Data state -------------------------------------------------
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [today, setToday] = useState<ContentRow | null>(null);
  const [calendar, setCalendar] = useState<ContentRow[]>([]);
  const [config, setConfig] = useState<ContentForgeConfig | null>(null);
  const [domain, setDomain] = useState<ContentDomainConfig | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  const [loading, setLoading] = useState({
    status: true,
    today: true,
    calendar: true,
    checklist: true,
  });

  // ---- Real-time state -------------------------------------------
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [liveStep, setLiveStep] = useState<StreamEvent | null>(null);
  const [connected, setConnected] = useState(false);

  // ---- Mobile drawer ---------------------------------------------
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Optimistic "running" right after the user clicks Run, before the server
  // status snapshot catches up. Auto-cleared on handoff / completion / timeout.
  const [optimisticRun, setOptimisticRun] = useState(false);

  // ---- Observability state ---------------------------------------
  // Whether the API server is reachable (flips false after 2 consecutive
  // fetch failures, back true on the next success).
  const [serverReachable, setServerReachable] = useState(true);
  const failureCountRef = useRef(0);

  // Ticks every second while the pipeline runs, to drive the staleness readout.
  const [now, setNow] = useState(() => Date.now());

  // Tracks the last point at which the pipeline made REAL progress (the step
  // text or the progress value changed). A hung LLM call emits no new step, so
  // an unchanged-but-successful poll must NOT count as activity.
  const lastChangeRef = useRef<{
    step: string | null;
    progress: number;
    at: number;
  }>({ step: null, progress: 0, at: Date.now() });

  // True once any SSE event has arrived since the most recent run was started.
  // Used by the run-confirmation guard to avoid a false "couldn't confirm" toast.
  const sseSinceRunRef = useRef(false);

  // Mirrors of live flags so the run-confirmation timeout reads current values
  // rather than the stale closure captured when the run was kicked off.
  const optimisticRunRef = useRef(false);
  const serverRunningRef = useRef(false);
  const serverReachableRef = useRef(true);

  // The server snapshot is the source of truth for whether the pipeline is
  // running — so the UI self-heals (within the 3s poll) even if the final SSE
  // event is missed. Optimistic only bridges the brief click->confirm gap.
  const serverRunning = status?.pipelineRunning ?? false;
  const pipelineRunning = serverRunning || optimisticRun;

  // Hand off from optimistic to the authoritative server flag once it confirms.
  useEffect(() => {
    if (serverRunning) setOptimisticRun(false);
  }, [serverRunning]);

  // Keep the timeout-readable refs in sync with the latest render values.
  optimisticRunRef.current = optimisticRun;
  serverRunningRef.current = serverRunning;
  serverReachableRef.current = serverReachable;

  // Live progress 0–100 (live event first, then the polled snapshot).
  const progress = liveStep?.progress ?? status?.progress ?? 0;

  // Live status badge override while running.
  const liveStatus: StatusEnum | null = deriveLiveStatus(liveStep, today);

  // Records a (step, progress) sample; bumps the "last real progress" timestamp
  // only when something actually changed. Called on every SSE event and on
  // every completed status poll.
  const markProgress = useCallback(
    (step: string | null, prog: number): void => {
      const prev = lastChangeRef.current;
      if (prev.step !== step || prev.progress !== prog) {
        lastChangeRef.current = { step, progress: prog, at: Date.now() };
      }
    },
    [],
  );

  // Single resolved error message from any source: the live SSE step, the
  // server status snapshot, or today's persisted row. Null when there's none.
  const errorText: string | null =
    (liveStep?.status === "error"
      ? (liveStep.errorMessage ?? liveStep.step)
      : null) ??
    status?.errorMessage ??
    (today?.status === "Error" ? today.errorMessage : null) ??
    null;

  // ---- Fetch helpers ---------------------------------------------
  const fetchStatus = useCallback(async () => {
    await runLoading(async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as StatusResponse;
          setStatus(next);
          // A completed poll only counts as activity if the step or progress
          // actually moved — an unchanged snapshot from a hung run does not.
          markProgress(next.currentStep ?? null, next.progress ?? 0);
        }
        failureCountRef.current = 0;
        setServerReachable(true);
      } catch {
        /* offline — leave previous snapshot */
        failureCountRef.current += 1;
        if (failureCountRef.current >= 2) setServerReachable(false);
      } finally {
        setLoading((l) => ({ ...l, status: false }));
      }
    });
  }, [markProgress, runLoading]);

  const fetchToday = useCallback(async () => {
    await runLoading(async () => {
      try {
        const res = await fetch("/api/today", { cache: "no-store" });
        if (res.ok) setToday((await res.json()) as ContentRow | null);
        failureCountRef.current = 0;
        setServerReachable(true);
      } catch {
        /* ignore */
        failureCountRef.current += 1;
        if (failureCountRef.current >= 2) setServerReachable(false);
      } finally {
        setLoading((l) => ({ ...l, today: false }));
      }
    });
  }, [runLoading]);

  const fetchCalendar = useCallback(async () => {
    await runLoading(async () => {
      try {
        const res = await fetch("/api/calendar", { cache: "no-store" });
        if (res.ok) setCalendar((await res.json()) as ContentRow[]);
      } catch {
        /* ignore */
      } finally {
        setLoading((l) => ({ ...l, calendar: false }));
      }
    });
  }, [runLoading]);

  const fetchConfig = useCallback(async () => {
    await runLoading(async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        if (res.ok) setConfig((await res.json()) as ContentForgeConfig);
      } catch {
        /* ignore */
      }
    });
  }, [runLoading]);

  const fetchChecklist = useCallback(async () => {
    await runLoading(async () => {
      try {
        const res = await fetch("/api/checklist", { cache: "no-store" });
        if (res.ok) setChecklist((await res.json()) as ChecklistItem[]);
      } catch {
        /* ignore */
      } finally {
        setLoading((l) => ({ ...l, checklist: false }));
      }
    });
  }, [runLoading]);

  const fetchDomain = useCallback(async () => {
    await runLoading(async () => {
      try {
        const res = await fetch("/api/domain", { cache: "no-store" });
        if (res.ok) setDomain((await res.json()) as ContentDomainConfig);
      } catch {
        /* ignore */
      }
    });
  }, [runLoading]);

  // ---- Initial load ----------------------------------------------
  useEffect(() => {
    void fetchStatus();
    void fetchToday();
    void fetchCalendar();
    void fetchConfig();
    void fetchChecklist();
    void fetchDomain();
  }, [fetchStatus, fetchToday, fetchCalendar, fetchConfig, fetchChecklist, fetchDomain]);

  // ---- SSE with polling fallback ---------------------------------
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let closedByUs = false;

    const startPolling = (): void => {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(() => {
        void fetchStatus();
        void fetchToday();
      }, 3000);
    };
    const stopPolling = (): void => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const connect = (): void => {
      try {
        es = new EventSource("/api/stream");
      } catch {
        startPolling();
        return;
      }

      es.onopen = (): void => {
        setConnected(true);
        stopPolling();
      };

      es.onmessage = (e: MessageEvent<string>): void => {
        try {
          const ev = JSON.parse(e.data) as StreamEvent;
          setEvents((prev) => [...prev.slice(-40), ev]);
          setLiveStep(ev);
          sseSinceRunRef.current = true;
          markProgress(ev.step, ev.progress);

          // Refresh snapshots as the pipeline progresses.
          void fetchStatus();
          void fetchToday();
          if (ev.status === "idle" || ev.status === "error") {
            setOptimisticRun(false);
            void fetchCalendar();
            void fetchChecklist();
          }
        } catch {
          /* ignore malformed line */
        }
      };

      es.onerror = (): void => {
        setConnected(false);
        if (closedByUs) return;
        es?.close();
        es = null;
        startPolling();
        // Attempt to reconnect shortly.
        setTimeout(() => {
          if (!closedByUs) connect();
        }, 5000);
      };
    };

    connect();

    return () => {
      closedByUs = true;
      es?.close();
      stopPolling();
    };
  }, [fetchStatus, fetchToday, fetchCalendar, fetchChecklist, markProgress]);

  // ---- Staleness ticker ------------------------------------------
  // While the pipeline runs, tick `now` once a second so the "updated Xs ago"
  // readout stays current. Interval is torn down the moment it stops running.
  useEffect(() => {
    if (!pipelineRunning) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pipelineRunning]);

  const secondsSinceUpdate = pipelineRunning
    ? Math.floor((now - lastChangeRef.current.at) / 1000)
    : null;
  const stale =
    pipelineRunning && secondsSinceUpdate !== null && secondsSinceUpdate > 45;

  // ---- Run pipeline ----------------------------------------------
  // Wraps only the initial POST /api/run (accepted-or-not) request — the
  // pipeline itself runs in the background server-side and is already
  // tracked separately via pipelineRunning/progress/the live log.
  const handleRun = useCallback(async () => {
    await runLoading(async () => {
      try {
        const res = await fetch("/api/run", { method: "POST" });
        if (res.status === 202) {
          toast.push("info", "Pipeline started. Watch the live log below.");
          setOptimisticRun(true);
          sseSinceRunRef.current = false;
          // Guarded confirmation. The 202 already proves the run started server-side;
          // this only catches a UI that never receives live updates. On a cold Next.js
          // dev compile the /api/stream + /api/status routes can take ~30s to build on
          // first hit, so a short window here would false-alarm on a perfectly healthy
          // run. Use a generous window and a soft (info) message — not an error —
          // since the run is confirmed started. Refs avoid stale closures.
          window.setTimeout(() => {
            if (
              optimisticRunRef.current &&
              !serverRunningRef.current &&
              serverReachableRef.current &&
              !sseSinceRunRef.current
            ) {
              toast.push(
                "info",
                "Run started, but live updates are slow to arrive — watch the live log, or check logs/pipeline.log.",
              );
              setOptimisticRun(false);
            }
          }, 45000);
          setLiveStep({
            step: "Pipeline starting…",
            status: "running",
            timestamp: new Date().toISOString(),
            progress: 2,
          });
          void fetchStatus();
        } else if (res.status === 409) {
          toast.push("error", "A pipeline run is already in progress.");
        } else {
          toast.push("error", `Could not start the pipeline (HTTP ${res.status}).`);
        }
      } catch {
        toast.push("error", "Network error — is the server running?");
      }
    });
  }, [toast, fetchStatus, runLoading]);

  const handleStop = useCallback(async () => {
    await runLoading(async () => {
      try {
        const res = await fetch("/api/stop", { method: "POST" });
        if (res.status === 202) {
          toast.push("info", "Stopping after the current step finishes…");
        } else if (res.status === 409) {
          toast.push("error", "Nothing is running right now.");
          setOptimisticRun(false);
        } else {
          toast.push("error", `Could not stop the pipeline (HTTP ${res.status}).`);
        }
        void fetchStatus();
      } catch {
        toast.push("error", "Network error — is the server running?");
      }
    });
  }, [toast, fetchStatus, runLoading]);

  const handleConfigSaved = useCallback((next: ContentForgeConfig) => {
    setConfig(next);
    void fetchStatus();
  }, [fetchStatus]);

  const handleDomainSaved = useCallback((next: ContentDomainConfig) => {
    setDomain(next);
    void fetchChecklist();
  }, [fetchChecklist]);

  // Persist a calendar row's edits (publish status, content, notes) to the
  // on-disk workbook, then refresh so the UI reflects the saved state.
  const saveRow = useCallback(
    async (date: string, updates: Partial<ContentRow>): Promise<void> => {
      await runLoading(async () => {
        const res = await fetch("/api/row", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, updates }),
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) detail = body.error;
          } catch {
            /* keep status code */
          }
          throw new Error(detail);
        }
        await Promise.all([fetchCalendar(), fetchToday()]);
      });
    },
    [fetchCalendar, fetchToday, runLoading],
  );

  // Publish a platform's content. In local mode the server reads the
  // content/key/image from disk and writes the publish status column itself, so
  // we only send { date, platform } and refresh to pick up the written status.
  // The lifecycle state (Dev.to "in-review" vs Instagram "published") comes back
  // from the server.
  const handlePublishDraft = useCallback(
    async (
      date: string,
      platform: Platform,
    ): Promise<{ url: string; note?: string; state: PublishState }> =>
      runLoading(async () => {
        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, platform }),
        });
        const data = (await res.json()) as {
          url?: string;
          note?: string;
          state?: PublishState;
          error?: string;
        };
        if (!res.ok || !data.url) throw new Error(data.error ?? "Publishing failed.");
        // Refresh calendar/today data so the written publish status shows up.
        await Promise.all([fetchCalendar(), fetchToday()]);
        return { url: data.url, note: data.note, state: data.state ?? "in-review" };
      }),
    [fetchCalendar, fetchToday, runLoading],
  );

  // Delete a day's row + images and re-run the pipeline for that date.
  const handleRegenerate = useCallback(
    async (date: string): Promise<void> => {
      await runLoading(async () => {
        try {
          const res = await fetch("/api/regenerate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date }),
          });
          if (res.status === 202) {
            toast.push("info", "Regenerating — watch the live log below.");
            setOptimisticRun(true);
            sseSinceRunRef.current = false;
            setLiveStep({
              step: "Regenerating…",
              status: "running",
              timestamp: new Date().toISOString(),
              progress: 2,
            });
            void fetchStatus();
            void fetchCalendar();
            void fetchToday();
          } else if (res.status === 409) {
            toast.push("error", "A pipeline run is already in progress.");
          } else {
            toast.push("error", `Could not regenerate (HTTP ${res.status}).`);
          }
        } catch {
          toast.push("error", "Network error — is the server running?");
        }
      });
    },
    [toast, fetchStatus, fetchCalendar, fetchToday, runLoading],
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Mobile top app bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-hairline bg-ink-800/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="focus-ring flex h-10 w-10 items-center justify-center rounded-lg border border-hairline text-white"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-teal/40 bg-teal/10 font-mono text-sm font-bold text-teal">
            {(domain?.brand.name.trim().slice(0, 2) || "CF").toUpperCase()}
          </span>
          <span className="font-semibold text-white">ContentForge</span>
        </div>
        {pipelineRunning && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-status-imaging">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-status-imaging" />
            {progress > 0 ? `${progress}%` : "running"}
          </span>
        )}
      </header>

      <Sidebar
        status={status}
        config={config}
        domain={domain}
        pipelineRunning={pipelineRunning}
        progress={progress}
        onRun={handleRun}
        onStop={handleStop}
        onConfigSaved={handleConfigSaved}
        onDomainSaved={handleDomainSaved}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          <PageHeading />
          {errorText && !pipelineRunning && (
            <ErrorBanner message={errorText} onRetry={handleRun} />
          )}
          <StatusCards
            today={today}
            status={status}
            loading={loading.status}
            running={pipelineRunning}
            progress={progress}
            currentStep={liveStep?.step ?? status?.currentStep ?? null}
            stale={stale}
            secondsSinceUpdate={secondsSinceUpdate}
          />
          <ContentTabs
            today={today}
            liveStatus={liveStatus}
            calendar={calendar}
            checklist={checklist}
            fileModified={today?.lastUpdated ?? null}
            loading={{
              today: loading.today,
              calendar: loading.calendar,
              checklist: loading.checklist,
            }}
            onRun={handleRun}
            pipelineRunning={pipelineRunning}
            progress={progress}
            onSaveRow={saveRow}
            onRegenerate={handleRegenerate}
            onPublishDraft={handlePublishDraft}
          />
          {/* Spacer so the live log doesn't cover content when open */}
          {pipelineRunning && <div className="h-44 sm:h-4" aria-hidden="true" />}
        </div>
      </main>

      <LiveLogFeed
        running={pipelineRunning}
        events={events}
        connected={connected}
        progress={progress}
        stale={stale}
        secondsSinceUpdate={secondsSinceUpdate}
        serverReachable={serverReachable}
      />
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): JSX.Element {
  // Strip the noisy "Pipeline failed: Error:" prefix for a cleaner read.
  const clean = message
    .replace(/^Pipeline failed:\s*/i, "")
    .replace(/^Error:\s*/i, "");
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-status-error/40 bg-status-error/10 p-4 sm:flex-row sm:items-center sm:justify-between animate-fade-up"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="mt-0.5 text-status-error">
          ⚠
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            The pipeline stopped with an error
          </p>
          <p className="mt-0.5 break-words text-sm text-subtext">{clean}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring shrink-0 self-start rounded-lg border border-teal/50 bg-teal/10 px-4 py-2 text-sm font-semibold text-teal transition-colors hover:bg-teal/20 sm:self-auto"
      >
        ▶ Run again
      </button>
    </div>
  );
}

function PageHeading(): JSX.Element {
  return (
    <div className="hidden lg:block">
      <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
      <p className="mt-0.5 text-sm text-subtext">
        Generate, review, and publish today&apos;s content across every platform.
      </p>
    </div>
  );
}

/**
 * Maps the live SSE step text onto a StatusEnum for badge display while the
 * pipeline runs. Falls back to the persisted row status when idle.
 */
function deriveLiveStatus(
  liveStep: StreamEvent | null,
  today: ContentRow | null,
): StatusEnum | null {
  if (!liveStep) return null;
  if (liveStep.status === "error") return "Error";
  if (liveStep.status === "idle") return today?.status ?? "Done";
  const step = liveStep.step.toLowerCase();
  if (step.includes("image") || step.includes("agent 3")) return "Imaging";
  if (step.includes("writing") || step.includes("agent 2")) return "Writing";
  if (step.includes("topic") || step.includes("agent 1")) return "Pending";
  return today?.status ?? "Writing";
}
