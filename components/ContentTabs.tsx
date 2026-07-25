"use client";

import { useState } from "react";
import type {
  ChecklistItem,
  ContentRow,
  StatusEnum,
} from "@/lib/types";
import type { Platform, PublishState } from "@/lib/publishStatus";
import { TodayContent } from "./TodayContent";
import { PublishChecklist } from "./PublishChecklist";
import { CalendarTable } from "./CalendarTable";
import { ExcelLog } from "./ExcelLog";
import { InfoTooltip } from "./InfoTooltip";

type TabId = "today" | "checklist" | "calendar" | "log";

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
  help: string;
}

const TABS: TabDef[] = [
  {
    id: "today",
    label: "Today's Content",
    icon: "✎",
    help: "Everything Agent 2 and 3 generated today, one accordion per platform, plus image cards.",
  },
  {
    id: "checklist",
    label: "Publish Checklist",
    icon: "✓",
    help: "Step-by-step publishing order per platform with best times and one-tap copy.",
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: "▦",
    help: "Full history of every generated day, newest first. Click a row for a preview.",
  },
  {
    id: "log",
    label: "Excel Log",
    icon: "≡",
    help: "The raw agent log parsed into a timeline, with a button to download the spreadsheet.",
  },
];

export interface ContentTabsProps {
  today: ContentRow | null;
  liveStatus: StatusEnum | null;
  calendar: ContentRow[];
  checklist: ChecklistItem[];
  fileModified: string | null;
  loading: {
    today: boolean;
    calendar: boolean;
    checklist: boolean;
  };
  onRun: () => void;
  pipelineRunning: boolean;
  progress: number;
  /** What's happening right now, shown in the Today tab while generating. */
  progressLabel?: string | null;
  /** Persist a calendar row's edits (publish status, content, notes). */
  onSaveRow?: (date: string, updates: Partial<ContentRow>) => Promise<void>;
  /** Map a stored image ref to a displayable URL (folder mode → blob URL). */
  resolveImage?: (ref: string) => Promise<string | null>;
  /** Delete a day's row + images and regenerate fresh content. */
  onRegenerate?: (date: string) => void | Promise<void>;
  /** Delete a day's row + images only — no regeneration. */
  onDelete?: (date: string) => void | Promise<void>;
  /** Publish a platform's content to that platform (Dev.to draft / Instagram live). */
  onPublishDraft?: (
    date: string,
    platform: Platform,
  ) => Promise<{ url: string; note?: string; state: PublishState }>;
}

export function ContentTabs({
  today,
  liveStatus,
  calendar,
  checklist,
  fileModified,
  loading,
  onRun,
  pipelineRunning,
  progress,
  progressLabel,
  onSaveRow,
  resolveImage,
  onRegenerate,
  onDelete,
  onPublishDraft,
}: ContentTabsProps): JSX.Element {
  const [active, setActive] = useState<TabId>("today");

  return (
    <div className="space-y-4">
      {/* Tab bar — horizontally scrollable on mobile */}
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="panel flex gap-1 overflow-x-auto p-1.5"
      >
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              id={`tab-${tab.id}`}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={`focus-ring group relative flex min-h-[40px] shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all sm:px-4 ${
                isActive
                  ? "bg-teal/15 text-teal"
                  : "text-subtext hover:bg-ink-600/40 hover:text-white"
              }`}
            >
              <span aria-hidden="true" className="text-xs">
                {tab.icon}
              </span>
              <span className="whitespace-nowrap">{tab.label}</span>
              <InfoTooltip text={tab.help} side="bottom" />
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-teal"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="animate-fade-up"
      >
        {active === "today" && (
          <TodayContent
            today={today}
            liveStatus={liveStatus}
            onRun={onRun}
            pipelineRunning={pipelineRunning}
            progress={progress}
            progressLabel={progressLabel}
            onRegenerate={onRegenerate}
            onDelete={onDelete}
            loading={loading.today}
          />
        )}
        {active === "checklist" && (
          <PublishChecklist
            checklist={checklist}
            today={today}
            loading={loading.checklist}
          />
        )}
        {active === "calendar" && (
          <CalendarTable
            rows={calendar}
            loading={loading.calendar}
            onSaveRow={onSaveRow}
            resolveImage={resolveImage}
            onRegenerate={onRegenerate}
            onDelete={onDelete}
            onPublishDraft={onPublishDraft}
          />
        )}
        {active === "log" && (
          <ExcelLog
            rows={calendar}
            today={today}
            fileModified={fileModified}
            loading={loading.calendar}
          />
        )}
      </div>
    </div>
  );
}
