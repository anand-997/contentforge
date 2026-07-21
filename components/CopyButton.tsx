"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface CopyButtonProps {
  /** The text that gets copied to the clipboard. */
  value: string;
  /** Visible label. Defaults to "Copy". */
  label?: string;
  /** Render as a compact icon-only button. */
  compact?: boolean;
  className?: string;
}

/**
 * Copies `value` to the clipboard and shows "Copied!" for 2s, then resets.
 * Disabled (and dimmed) when there is nothing to copy.
 */
export function CopyButton({
  value,
  label = "Copy",
  compact = false,
  className = "",
}: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empty = value.trim().length === 0;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    if (empty) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* swallow */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, [value, empty]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={empty}
      aria-label={empty ? "Nothing to copy" : copied ? "Copied" : label}
      aria-live="polite"
      className={`focus-ring inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
        copied
          ? "border-teal/50 bg-teal/15 text-teal"
          : "border-hairline bg-ink-600/80 text-subtext hover:border-teal/40 hover:text-white"
      } ${empty ? "cursor-not-allowed opacity-40" : ""} ${className}`}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
      {!compact && <span>{copied ? "Copied!" : label}</span>}
    </button>
  );
}

function CopyIcon({ className = "" }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
