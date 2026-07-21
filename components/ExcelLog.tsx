"use client";

import { useMemo, useState } from "react";
import type { ContentRow } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { relativeTime, Skeleton } from "./ui";

export interface ExcelLogProps {
  rows: ContentRow[];
  /** Today's row is the default selection. */
  today: ContentRow | null;
  /** xlsx file last-modified time (ISO) if known. */
  fileModified: string | null;
  loading: boolean;
}

interface LogLine {
  timestamp: string;
  agent: string;
  message: string;
  raw: string;
}

/** Parses lines like `[2026-06-14 09:00:01] Agent 1 → Topic: ... | Pillar: x`. */
function parseAgentLog(log: string): LogLine[] {
  return log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      const tsMatch = raw.match(/^\[([^\]]+)\]\s*/);
      const timestamp = tsMatch ? tsMatch[1] : "";
      const rest = tsMatch ? raw.slice(tsMatch[0].length) : raw;
      const agentMatch = rest.match(/^(Agent\s*\d+)\b/i);
      const agent = agentMatch ? agentMatch[1].replace(/\s+/g, " ") : "System";
      const message = agentMatch ? rest.slice(agentMatch[0].length).replace(/^[\s:→>-]+/, "") : rest;
      return { timestamp, agent, message, raw };
    });
}

const AGENT_COLORS: Record<string, string> = {
  "Agent 1": "text-teal",
  "Agent 2": "text-status-writing",
  "Agent 3": "text-status-imaging",
  System: "text-subtext",
};

export function ExcelLog({
  rows,
  today,
  fileModified,
  loading,
}: ExcelLogProps): JSX.Element {
  const dates = useMemo(() => rows.map((r) => r.date), [rows]);
  const [selectedDate, setSelectedDate] = useState<string>(today?.date ?? "");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const effectiveDate = selectedDate || today?.date || dates[0] || "";
  const selectedRow = rows.find((r) => r.date === effectiveDate) ?? today ?? null;

  const allLines = useMemo(
    () => (selectedRow ? parseAgentLog(selectedRow.agentLog) : []),
    [selectedRow],
  );
  const agents = useMemo(() => {
    const set = new Set(allLines.map((l) => l.agent));
    return Array.from(set);
  }, [allLines]);

  const lines = allLines.filter(
    (l) => agentFilter === "all" || l.agent === agentFilter,
  );

  if (loading) {
    return (
      <div className="panel space-y-2 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-subtext">
            Date
            <select
              value={effectiveDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="focus-ring min-h-[36px] rounded-lg border border-hairline bg-ink-700 px-2 py-1 font-mono text-xs text-white"
            >
              {dates.length === 0 && <option value="">—</option>}
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-subtext">
            Agent
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="focus-ring min-h-[36px] rounded-lg border border-hairline bg-ink-700 px-2 py-1 text-xs text-white"
            >
              <option value="all">All agents</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <InfoTooltip
            text="This is a readable view of the spreadsheet's AgentLog column for the selected day. Filter by which agent emitted the line."
            side="bottom"
          />
        </div>

        <a
          href="/api/download"
          className="focus-ring inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-teal/15 px-4 py-2 text-sm font-semibold text-teal transition-colors hover:bg-teal/25"
        >
          <DownloadIcon /> Download .xlsx
        </a>
      </div>

      {fileModified && (
        <p className="px-1 text-xs text-subtext">
          Spreadsheet last modified{" "}
          <span className="text-white/70">{relativeTime(fileModified)}</span>
          <span className="ml-1 font-mono text-[0.68rem] text-subtext/70">
            ({new Date(fileModified).toLocaleString()})
          </span>
        </p>
      )}

      {/* Timeline */}
      <div className="panel p-4">
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-subtext">
            No log entries for this day{agentFilter !== "all" ? " and agent" : ""}.
          </p>
        ) : (
          <ol className="relative space-y-0 border-l border-hairline pl-5">
            {lines.map((line, i) => (
              <li key={i} className="relative pb-4 last:pb-0">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink-800 ${
                    (AGENT_COLORS[line.agent] ?? "text-subtext").replace(
                      "text-",
                      "bg-",
                    )
                  }`}
                />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[0.68rem] text-subtext">
                    {line.timestamp || "—"}
                  </span>
                  <span
                    className={`text-xs font-semibold ${AGENT_COLORS[line.agent] ?? "text-subtext"}`}
                  >
                    {line.agent}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-sm text-white/85">
                  {line.message || line.raw}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function DownloadIcon(): JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
