"use client";

import { useState } from "react";
import type { ChecklistItem, ContentRow } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { InfoTooltip } from "./InfoTooltip";
import { Skeleton } from "./ui";

export interface PublishChecklistProps {
  checklist: ChecklistItem[];
  today: ContentRow | null;
  loading: boolean;
}

const PLATFORM_ICONS: Record<string, string> = {
  LinkedIn: "in",
  Medium: "M",
  Instagram: "IG",
  YouTube: "YT",
  "Dev.to": "DEV",
};

export function PublishChecklist({
  checklist,
  today,
  loading,
}: PublishChecklistProps): JSX.Element {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel space-y-3 p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (checklist.length === 0) {
    return (
      <div className="panel px-6 py-12 text-center text-sm text-subtext">
        No checklist available.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-sm text-subtext">
        Tick steps as you publish. Progress is local and resets on reload — by
        design, so each day starts fresh.
        <InfoTooltip
          text="Each platform card lists the exact order to post in, the best time, and one-tap copy for any value you need to paste."
          side="top"
        />
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {checklist.map((item) => (
          <ChecklistCard key={item.platform} item={item} today={today} />
        ))}
      </div>
    </div>
  );
}

function ChecklistCard({
  item,
  today,
}: {
  item: ChecklistItem;
  today: ContentRow | null;
}): JSX.Element {
  const [checked, setChecked] = useState<boolean[]>(() =>
    item.steps.map(() => false),
  );
  const doneCount = checked.filter(Boolean).length;
  const pct = Math.round((doneCount / item.steps.length) * 100);
  const complete = doneCount === item.steps.length;

  return (
    <div className="panel flex flex-col gap-3 p-4 animate-fade-up">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-ink-600 font-mono text-[0.62rem] font-bold text-teal">
          {PLATFORM_ICONS[item.platform] ?? item.platform.slice(0, 2)}
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">{item.platform}</h3>
          <p className="text-xs text-subtext">
            Best time:{" "}
            <span className="font-mono text-teal/90">{item.bestPostTime}</span>
          </p>
        </div>
        <span
          className={`text-xs font-medium ${complete ? "text-teal" : "text-subtext"}`}
        >
          {doneCount}/{item.steps.length}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-600"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${item.platform} progress`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            complete ? "bg-teal shadow-[0_0_8px_rgba(0,212,170,0.6)]" : "bg-teal/70"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {item.steps.map((step, i) => {
          const copyValue =
            step.copyKey && today ? String(today[step.copyKey] ?? "") : "";
          return (
            <li key={i} className="flex items-start gap-2">
              <label className="flex flex-1 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={() =>
                    setChecked((c) => c.map((v, j) => (j === i ? !v : v)))
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-teal"
                />
                <span
                  className={`text-sm leading-snug ${
                    checked[i] ? "text-subtext line-through" : "text-white/85"
                  }`}
                >
                  {step.label}
                </span>
              </label>
              {step.copyKey && (
                <CopyButton
                  value={copyValue}
                  compact
                  label={`Copy ${String(step.copyKey)}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
