"use client";

import type { ContentRow, StatusResponse } from "@/lib/types";
import { StatusBadge, STATUS_META } from "./statusBadge";
import { InfoTooltip } from "./InfoTooltip";
import { relativeTime, useNow, Skeleton } from "./ui";

export interface StatusCardsProps {
  today: ContentRow | null;
  status: StatusResponse | null;
  loading: boolean;
  running: boolean;
  progress: number;
  currentStep: string | null;
  stale?: boolean;
  secondsSinceUpdate?: number | null;
}

export function StatusCards({
  today,
  status,
  loading,
  running,
  progress,
  currentStep,
  stale,
  secondsSinceUpdate,
}: StatusCardsProps): JSX.Element {
  useNow(30000);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel space-y-3 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const effectiveStatus = today?.status ?? "Pending";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        label="Today's Topic"
        help="The headline Agent 1 picked for today, drawn from the active content pillar."
        accent="teal"
      >
        {today?.topic ? (
          <p className="line-clamp-3 text-base font-semibold leading-snug text-white">
            {today.topic}
          </p>
        ) : (
          <p className="text-base font-medium text-subtext">Not yet generated</p>
        )}
        {today && (
          <p className="mt-1 text-xs capitalize text-subtext">
            {today.pillar.replace("-", " ")} · {today.postStructure}
          </p>
        )}
      </Card>

      <Card
        label="Pipeline Status"
        help="Where today's run is in the four-agent pipeline. Spinning states are actively working."
        accent={accentForStatus(effectiveStatus)}
      >
        <div className="flex items-center gap-2">
          <StatusBadge status={effectiveStatus} />
          {running && (
            <span className="ml-auto font-mono text-sm font-semibold text-status-imaging">
              {Math.round(progress)}%
            </span>
          )}
        </div>
        {running && (
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-600"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className="block h-full rounded-full bg-status-imaging transition-all duration-500"
              style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
            />
          </div>
        )}
        <p className="mt-1.5 line-clamp-2 text-xs text-subtext">
          {(running ? currentStep : null) ??
            status?.currentStep ??
            STATUS_META[effectiveStatus].help}
        </p>
        {running && typeof secondsSinceUpdate === "number" && (
          <p className="mt-1 text-[0.68rem] text-subtext/80">
            updated {secondsSinceUpdate}s ago
          </p>
        )}
        {stale && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber/40 bg-amber/10 p-2 text-[0.7rem] leading-snug text-amber-soft">
            <span aria-hidden="true">⚠</span>
            <span>
              Still working — no update for{" "}
              {typeof secondsSinceUpdate === "number" ? secondsSinceUpdate : "—"}s. You
              can keep waiting or re-run.
            </span>
          </div>
        )}
      </Card>

      <Card
        label="Last Updated"
        help="How long ago today's row last changed in the spreadsheet."
        accent="default"
      >
        <p className="text-xl font-semibold text-white">
          {relativeTime(today?.lastUpdated)}
        </p>
        {today?.lastUpdated && (
          <p className="mt-1 font-mono text-[0.68rem] text-subtext">
            {new Date(today.lastUpdated).toLocaleString()}
          </p>
        )}
      </Card>

      <Card
        label="Content Streak"
        help="Consecutive days the pipeline reached Done. Resets after a missed or errored day."
        accent="amber"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-amber-soft">
            {status?.streakDays ?? 0}
          </span>
          <span className="text-sm text-subtext">
            day{(status?.streakDays ?? 0) === 1 ? "" : "s"}
          </span>
          <span className="ml-auto text-2xl" aria-hidden="true">
            🔥
          </span>
        </div>
      </Card>
    </div>
  );
}

type Accent = "teal" | "amber" | "default" | "error" | "writing";

function accentForStatus(status: ContentRow["status"]): Accent {
  switch (status) {
    case "Done":
      return "teal";
    case "Error":
      return "error";
    case "Writing":
      return "writing";
    case "Imaging":
      return "amber";
    default:
      return "default";
  }
}

const ACCENT_BAR: Record<Accent, string> = {
  teal: "from-teal/70",
  amber: "from-amber/70",
  writing: "from-status-writing/70",
  error: "from-status-error/70",
  default: "from-subtext/40",
};

function Card({
  label,
  help,
  accent,
  children,
}: {
  label: string;
  help: string;
  accent: Accent;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="panel group relative overflow-hidden p-4 animate-fade-up">
      {/* Accent edge */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r to-transparent ${ACCENT_BAR[accent]}`}
      />
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-[0.7rem] font-semibold uppercase tracking-wider text-subtext">
          {label}
        </h3>
        <InfoTooltip text={help} side="top" />
      </div>
      {children}
    </div>
  );
}
