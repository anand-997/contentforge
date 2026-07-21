"use client";

import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { InfoTooltip } from "./InfoTooltip";

export interface YouTubeTitleSelectorProps {
  titles: [string, string, string];
}

const FORMAT_HINTS = ["Number-based", "Problem / solution", "Story / experience"];

export function YouTubeTitleSelector({
  titles,
}: YouTubeTitleSelectorProps): JSX.Element {
  const [chosen, setChosen] = useState<number | null>(null);
  const available = titles.map((t) => t.trim());

  if (available.every((t) => t.length === 0)) {
    return (
      <p className="text-sm text-subtext">Title options appear after writing.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h4 className="text-sm font-semibold text-white">Pick a title</h4>
        <InfoTooltip
          text="Three angles on the same topic. Click the one you'll use — your choice is highlighted (local only)."
          side="right"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {available.map((title, i) => {
          if (!title) return null;
          const active = chosen === i;
          return (
            <div
              key={i}
              className={`group relative flex flex-col gap-2 rounded-xl border p-3 transition-all ${
                active
                  ? "border-teal/60 bg-teal/10 shadow-glow"
                  : "border-hairline bg-ink-600/50 hover:border-teal/30"
              }`}
            >
              <span className="font-mono text-[0.62rem] uppercase tracking-wider text-subtext">
                {FORMAT_HINTS[i] ?? `Option ${i + 1}`}
              </span>
              <button
                type="button"
                onClick={() => setChosen(active ? null : i)}
                aria-pressed={active}
                className="focus-ring flex-1 text-left text-sm font-medium leading-snug text-white"
              >
                {title}
              </button>
              <div className="flex items-center justify-between">
                <span
                  className={`flex items-center gap-1 text-[0.68rem] ${
                    active ? "text-teal" : "text-subtext"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                      active ? "border-teal bg-teal text-ink-900" : "border-subtext/50"
                    }`}
                  >
                    {active ? "✓" : ""}
                  </span>
                  {active ? "Chosen" : "Choose"}
                </span>
                <CopyButton value={title} compact label="Copy title" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
