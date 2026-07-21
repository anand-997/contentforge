import type { ApiKeyHealth } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";

export interface ApiKeyIndicatorProps {
  name: string;
  health: ApiKeyHealth;
  /** The model id this key drives, shown as a subtle subtitle. */
  model?: string;
  help?: string;
}

const HEALTH_META: Record<
  ApiKeyHealth,
  { label: string; dot: string; text: string; glow: string }
> = {
  healthy: {
    label: "healthy",
    dot: "bg-teal",
    text: "text-teal",
    glow: "shadow-[0_0_8px_rgba(0,212,170,0.8)]",
  },
  missing: {
    label: "missing",
    dot: "bg-status-error",
    text: "text-status-error",
    glow: "",
  },
  invalid: {
    label: "invalid",
    dot: "bg-amber",
    text: "text-amber",
    glow: "",
  },
};

export function ApiKeyIndicator({
  name,
  health,
  model,
  help,
}: ApiKeyIndicatorProps): JSX.Element {
  const meta = HEALTH_META[health];
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-ink-600/40 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-white/90">{name}</span>
          {help && <InfoTooltip text={help} side="right" />}
        </div>
        {model && (
          <p className="truncate font-mono text-[0.68rem] text-subtext">
            {model}
          </p>
        )}
      </div>
      <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${meta.text}`}>
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${meta.dot} ${meta.glow} ${
            health !== "healthy" ? "animate-pulse-soft" : ""
          }`}
        />
        <span className="capitalize">{meta.label}</span>
      </span>
    </div>
  );
}
