import type { StatusEnum } from "@/lib/types";

/**
 * Shared status-badge helper. Color is never the only signal: every state
 * carries a label and a glyph, and active states animate a spinner.
 */
export interface StatusMeta {
  label: string;
  /** Tailwind text/border/background classes for the badge. */
  className: string;
  /** Dot/spinner color class. */
  dotClass: string;
  /** Whether this state is "in flight" (shows a spinner). */
  active: boolean;
  /** Plain-language explanation for tooltips. */
  help: string;
}

export const STATUS_META: Record<StatusEnum, StatusMeta> = {
  Pending: {
    label: "Pending",
    className: "border-status-pending/40 bg-status-pending/10 text-subtext",
    dotClass: "bg-status-pending",
    active: false,
    help: "Topic picked and queued. Writing has not started yet.",
  },
  Writing: {
    label: "Writing",
    className: "border-status-writing/40 bg-status-writing/10 text-status-writing",
    dotClass: "bg-status-writing",
    active: true,
    help: "Agent 2 is drafting posts for each platform with Deepseek.",
  },
  Imaging: {
    label: "Imaging",
    className: "border-status-imaging/40 bg-status-imaging/10 text-status-imaging",
    dotClass: "bg-status-imaging",
    active: true,
    help: "Agent 3 is generating the branded image cards with OpenAI (gpt-image-1).",
  },
  Done: {
    label: "Done",
    className: "border-status-done/40 bg-status-done/10 text-status-done",
    dotClass: "bg-status-done",
    active: false,
    help: "All platforms written and images saved. Ready to publish.",
  },
  Error: {
    label: "Error",
    className: "border-status-error/40 bg-status-error/10 text-status-error",
    dotClass: "bg-status-error",
    active: false,
    help: "Something failed. Already-written content is preserved — re-run to resume.",
  },
};

export interface StatusBadgeProps {
  status: StatusEnum;
  /** Show the small text label next to the dot. Defaults to true. */
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function StatusBadge({
  status,
  showLabel = true,
  size = "md",
}: StatusBadgeProps): JSX.Element {
  const meta = STATUS_META[status];
  const pad = size === "sm" ? "px-2 py-0.5 text-[0.68rem]" : "px-2.5 py-1 text-xs";

  return (
    <span
      role="status"
      aria-label={`Status: ${meta.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad} ${meta.className}`}
    >
      {meta.active ? (
        <Spinner className={meta.dotClass} />
      ) : (
        <span
          className={`h-1.5 w-1.5 rounded-full ${meta.dotClass} ${
            status === "Done" ? "shadow-[0_0_8px_rgba(0,212,170,0.7)]" : ""
          }`}
          aria-hidden="true"
        />
      )}
      {showLabel && meta.label}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }): JSX.Element {
  // Normalize a `bg-*` color class to `text-*` so `border-current` picks it up.
  const colorClass = className.replace(/(^|\s)bg-/g, "$1text-");
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${colorClass}`}
    />
  );
}
