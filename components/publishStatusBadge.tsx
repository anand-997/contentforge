import type { PublishState } from "@/lib/publishStatus";

/**
 * Per-platform publish-status badge. Mirrors the StatusBadge pattern (label +
 * dot, color never the only signal) but for the publish lifecycle. Reuses the
 * existing `status-*` Tailwind tokens — no config change.
 */
export interface PublishStatusMeta {
  label: string;
  className: string;
  dotClass: string;
  help: string;
}

export const PUBLISH_META: Record<PublishState, PublishStatusMeta> = {
  "not-started": {
    label: "Not started",
    className: "border-status-pending/40 bg-status-pending/10 text-subtext",
    dotClass: "bg-status-pending",
    help: "No action taken yet on this platform.",
  },
  "in-review": {
    label: "In review",
    className: "border-status-imaging/40 bg-status-imaging/10 text-status-imaging",
    dotClass: "bg-status-imaging",
    help: "Being edited or reviewed before posting.",
  },
  scheduled: {
    label: "Scheduled",
    className: "border-status-writing/40 bg-status-writing/10 text-status-writing",
    dotClass: "bg-status-writing",
    help: "Queued to post — not live yet.",
  },
  published: {
    label: "Published",
    className: "border-status-done/40 bg-status-done/10 text-status-done",
    dotClass: "bg-status-done",
    help: "Live. Captures the post URL and time.",
  },
  skipped: {
    label: "Skipped",
    className: "border-hairline bg-ink-600/40 text-subtext",
    dotClass: "bg-subtext",
    help: "Deliberately not posting on this platform.",
  },
};

export interface PublishStatusBadgeProps {
  state: PublishState;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function PublishStatusBadge({
  state,
  showLabel = true,
  size = "sm",
}: PublishStatusBadgeProps): JSX.Element {
  const meta = PUBLISH_META[state];
  const pad = size === "sm" ? "px-2 py-0.5 text-[0.68rem]" : "px-2.5 py-1 text-xs";
  return (
    <span
      role="status"
      aria-label={`Publish status: ${meta.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad} ${meta.className}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${meta.dotClass} ${
          state === "published" ? "shadow-[0_0_8px_rgba(0,212,170,0.7)]" : ""
        }`}
      />
      {showLabel && meta.label}
    </span>
  );
}
