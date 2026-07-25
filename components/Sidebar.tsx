"use client";

import { useEffect, useState } from "react";
import type { AgentPrompts } from "@/lib/promptConfig";
import type { ContentDomainConfig, ContentForgeConfig, StatusResponse, Weekday, WeekdayPlan } from "@/lib/types";
import { ApiKeyIndicator } from "./ApiKeyIndicator";
import { InfoTooltip } from "./InfoTooltip";
import { Spinner } from "./statusBadge";
import { ContentDomainEditor } from "./ContentDomainEditor";
import { AgentPromptsEditor } from "./AgentPromptsEditor";
import { WeeklyPlanEditor } from "./WeeklyPlanEditor";
import {
  useToast,
  validateCron,
  describeCron,
  relativeTime,
  useNow,
} from "./ui";

// A domain is "blank" (never set up) when it has no brand name, niche label,
// or pillars — this is GENERIC_DEFAULT_DOMAIN's shape. Duplicated here (rather
// than imported from lib/domainConfig.ts) because that module pulls in `fs`
// at module scope and must never enter the client bundle.
function isBlankDomain(domain: ContentDomainConfig): boolean {
  return (
    domain.niche.trim().length === 0 &&
    domain.pillars.length === 0 &&
    domain.brand.name.trim().length === 0
  );
}

/** Known-good Deepseek model ids; anything else triggers a soft warning. */
const KNOWN_DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

export interface SidebarProps {
  status: StatusResponse | null;
  config: ContentForgeConfig | null;
  domain: ContentDomainConfig | null;
  pipelineRunning: boolean;
  progress: number;
  onRun: () => void;
  onStop: () => void;
  onConfigSaved: (config: ContentForgeConfig) => void;
  onDomainSaved: (domain: ContentDomainConfig) => void;
  /** Mobile drawer state. */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({
  status,
  config,
  domain,
  pipelineRunning,
  progress,
  onRun,
  onStop,
  onConfigSaved,
  onDomainSaved,
  open,
  onClose,
}: SidebarProps): JSX.Element {
  return (
    <>
      {/* Mobile overlay */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-ink-900/70 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-[84vw] max-w-[300px] flex-col gap-5 overflow-y-auto border-r border-hairline bg-ink-800/95 px-5 py-6 backdrop-blur-xl transition-transform duration-300 lg:sticky lg:top-0 lg:z-0 lg:h-screen lg:w-[280px] lg:translate-x-0 lg:bg-ink-800/40 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="focus-ring absolute right-3 top-3 rounded-lg p-2 text-subtext hover:text-white lg:hidden"
        >
          ✕
        </button>

        <BrandHeader domain={domain} />

        {domain && isBlankDomain(domain) && (
          <SetupBanner domain={domain} onDomainSaved={onDomainSaved} />
        )}

        <RunButton
          running={pipelineRunning}
          progress={progress}
          onRun={onRun}
          onStop={onStop}
        />

        <SidebarSection
          title="API Keys"
          help="Live health of the two services that power the pipeline. Deepseek writes the posts; OpenAI draws the image cards."
        >
          <ApiKeyIndicator
            name="Deepseek"
            health={status?.deepseek ?? "missing"}
            model={status?.deepseekModel}
            help="Writes all platform content. A missing key blocks the whole pipeline."
          />
          <ApiKeyIndicator
            name="OpenAI"
            health={status?.openai ?? "missing"}
            model={status?.openaiImageModel}
            help="Generates the branded image cards with gpt-image-1. If missing, posts still get written — only images are skipped."
          />
        </SidebarSection>

        <ContentSettings domain={domain} onDomainSaved={onDomainSaved} />

        <ConfigEditor config={config} onConfigSaved={onConfigSaved} />

        <ScheduleInfo status={status} config={config} />

        <StreakBadge days={status?.streakDays ?? 0} />

        <p className="mt-auto pt-2 text-center text-[0.65rem] text-subtext/60">
          ContentForge · local build
        </p>
      </aside>
    </>
  );
}

function BrandHeader({ domain }: { domain: ContentDomainConfig | null }): JSX.Element {
  const name = domain?.brand.name.trim() || "Your Brand";
  const handle = domain?.brand.handle.trim() || "";
  const initials = (domain?.brand.name.trim().slice(0, 2) || "CF").toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-teal/40 bg-teal/10 shadow-glow">
        <span className="font-mono text-lg font-bold text-teal">{initials}</span>
      </div>
      <div>
        <h1 className="text-lg font-bold leading-tight tracking-tight text-white">
          {name}
        </h1>
        {handle && <p className="font-mono text-xs text-teal/80">{handle}</p>}
      </div>
    </div>
  );
}

function SetupBanner({
  domain,
  onDomainSaved,
}: {
  domain: ContentDomainConfig;
  onDomainSaved: (d: ContentDomainConfig) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring rounded-xl border border-amber/40 bg-amber/10 px-3 py-2.5 text-left text-xs text-amber-soft transition-colors hover:bg-amber/20"
      >
        <span className="font-semibold">Set up your brand &amp; content →</span>
        <br />
        No niche configured yet — content generation will use placeholders until you do.
      </button>
      {open && (
        <ContentDomainEditor
          domain={domain}
          onSave={async (next) => {
            const res = await fetch("/api/domain", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(next),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            onDomainSaved((await res.json()) as ContentDomainConfig);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ContentSettings({
  domain,
  onDomainSaved,
}: {
  domain: ContentDomainConfig | null;
  onDomainSaved: (d: ContentDomainConfig) => void;
}): JSX.Element {
  const toast = useToast();
  const [editingDomain, setEditingDomain] = useState(false);
  const [editingPrompts, setEditingPrompts] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [prompts, setPrompts] = useState<AgentPrompts | null>(null);
  const [plan, setPlan] = useState<Record<Weekday, WeekdayPlan> | null>(null);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);

  async function openPrompts(): Promise<void> {
    setLoadingPrompts(true);
    try {
      const res = await fetch("/api/prompts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPrompts((await res.json()) as AgentPrompts);
      setEditingPrompts(true);
    } catch {
      toast.push("error", "Could not load prompts.");
    } finally {
      setLoadingPrompts(false);
    }
  }

  async function openPlan(): Promise<void> {
    setLoadingPlan(true);
    try {
      const res = await fetch("/api/weekly-plan", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPlan((await res.json()) as Record<Weekday, WeekdayPlan>);
      setEditingPlan(true);
    } catch {
      toast.push("error", "Could not load the weekly plan.");
    } finally {
      setLoadingPlan(false);
    }
  }

  return (
    <SidebarSection
      title="Content & Brand"
      help="What this brand is and what it creates — separate from the technical settings below."
    >
      <button
        type="button"
        onClick={() => setEditingDomain(true)}
        className="focus-ring flex w-full items-center justify-between rounded-lg border border-hairline bg-ink-700/40 px-3 py-2 text-left text-xs text-white hover:border-teal/40"
      >
        Brand, pillars, platforms &amp; voice
        <span aria-hidden="true" className="text-subtext">→</span>
      </button>
      <button
        type="button"
        onClick={() => void openPrompts()}
        disabled={loadingPrompts}
        className="focus-ring flex w-full items-center justify-between rounded-lg border border-hairline bg-ink-700/40 px-3 py-2 text-left text-xs text-white hover:border-teal/40 disabled:opacity-50"
      >
        Agent prompts
        {loadingPrompts ? <Spinner className="text-teal" /> : <span aria-hidden="true" className="text-subtext">→</span>}
      </button>
      <button
        type="button"
        onClick={() => void openPlan()}
        disabled={loadingPlan}
        className="focus-ring flex w-full items-center justify-between rounded-lg border border-hairline bg-ink-700/40 px-3 py-2 text-left text-xs text-white hover:border-teal/40 disabled:opacity-50"
      >
        Weekly plan
        {loadingPlan ? <Spinner className="text-teal" /> : <span aria-hidden="true" className="text-subtext">→</span>}
      </button>

      {editingDomain && domain && (
        <ContentDomainEditor
          domain={domain}
          onSave={async (next) => {
            const res = await fetch("/api/domain", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(next),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            onDomainSaved((await res.json()) as ContentDomainConfig);
          }}
          onClose={() => setEditingDomain(false)}
        />
      )}
      {editingPrompts && prompts && (
        <AgentPromptsEditor
          prompts={prompts}
          onSave={async (next) => {
            const res = await fetch("/api/prompts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(next),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          }}
          onClose={() => setEditingPrompts(false)}
        />
      )}
      {editingPlan && plan && (
        <WeeklyPlanEditor
          plan={plan}
          pillars={domain?.pillars ?? []}
          onSave={async (next) => {
            const res = await fetch("/api/weekly-plan", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(next),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          }}
          onClose={() => setEditingPlan(false)}
        />
      )}
    </SidebarSection>
  );
}

function RunButton({
  running,
  progress,
  onRun,
  onStop,
}: {
  running: boolean;
  progress: number;
  onRun: () => void;
  onStop: () => void;
}): JSX.Element {
  if (running) {
    const pct = Math.max(0, Math.min(100, Math.round(progress)));
    return (
      <div className="space-y-2">
        <div className="relative flex min-h-[48px] w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-status-imaging/40 bg-status-imaging/10 px-4 py-3 text-sm font-semibold text-status-imaging">
          {/* progress fill */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-status-imaging/15 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
          <span className="relative flex items-center gap-2">
            <Spinner className="text-status-imaging" />
            Pipeline running… {pct}%
          </span>
        </div>
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop the running pipeline"
          className="focus-ring flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-status-error/40 bg-status-error/10 px-4 py-2 text-sm font-semibold text-status-error transition-colors hover:bg-status-error/20"
        >
          <span aria-hidden="true">■</span>
          Stop pipeline
        </button>
        <p className="text-center text-[0.65rem] text-subtext">
          Stops after the current step. Re-run continues where it left off.
        </p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onRun}
      aria-label="Run pipeline now"
      className="focus-ring group relative flex min-h-[48px] w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-teal px-4 py-3 text-sm font-semibold text-ink-900 shadow-glow transition-all hover:bg-teal-soft active:scale-[0.98]"
    >
      <span aria-hidden="true">▶</span>
      Run Pipeline Now
    </button>
  );
}

function SidebarSection({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-wider text-subtext">
          {title}
        </h2>
        {help && <InfoTooltip text={help} side="right" />}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ConfigEditor({
  config,
  onConfigSaved,
}: {
  config: ContentForgeConfig | null;
  onConfigSaved: (c: ContentForgeConfig) => void;
}): JSX.Element {
  const toast = useToast();
  const [model, setModel] = useState("");
  const [cron, setCron] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [savingCron, setSavingCron] = useState(false);

  useEffect(() => {
    if (config) {
      setModel(config.models.deepseekModel);
      setCron(config.scheduler.cronSchedule);
    }
  }, [config]);

  const modelUnknown =
    model.trim().length > 0 && !KNOWN_DEEPSEEK_MODELS.includes(model.trim());
  const cronError = cron.trim().length > 0 ? validateCron(cron) : "Schedule required";
  const modelDirty = config ? model.trim() !== config.models.deepseekModel : false;
  const cronDirty = config ? cron.trim() !== config.scheduler.cronSchedule : false;

  async function save(next: ContentForgeConfig): Promise<void> {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = (await res.json()) as ContentForgeConfig;
    onConfigSaved(updated);
  }

  async function saveModel(): Promise<void> {
    if (!config || !modelDirty) return;
    setSavingModel(true);
    try {
      await save({
        ...config,
        models: { ...config.models, deepseekModel: model.trim() },
      });
      toast.push("success", "Deepseek model updated.");
    } catch {
      toast.push("error", "Could not save the model. Check the server.");
    } finally {
      setSavingModel(false);
    }
  }

  async function saveCron(): Promise<void> {
    if (!config || !cronDirty) return;
    if (cronError) {
      toast.push("error", cronError);
      return;
    }
    setSavingCron(true);
    try {
      await save({
        ...config,
        scheduler: { ...config.scheduler, cronSchedule: cron.trim() },
      });
      toast.push("success", "Schedule updated and scheduler restarted.");
    } catch {
      toast.push("error", "Could not save the schedule.");
    } finally {
      setSavingCron(false);
    }
  }

  return (
    <SidebarSection
      title="Configuration"
      help="These two values are editable live. Saving the schedule restarts the cron job immediately."
    >
      {/* Deepseek model */}
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs text-subtext">
          Deepseek model
          <InfoTooltip
            text="The text model that writes your posts. deepseek-v4-flash is the safe default. Unrecognized names still save but are flagged."
            side="right"
          />
        </span>
        <div className="flex gap-1.5">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveModel();
            }}
            spellCheck={false}
            className={`focus-ring min-h-[40px] w-full rounded-lg border bg-ink-700 px-2.5 py-1.5 font-mono text-xs text-white transition-colors ${
              modelUnknown ? "border-amber/50" : "border-hairline"
            }`}
            aria-invalid={modelUnknown}
          />
          <SaveChip
            disabled={!modelDirty}
            saving={savingModel}
            onClick={() => void saveModel()}
          />
        </div>
        {modelUnknown && (
          <p className="mt-1 flex items-center gap-1 text-[0.68rem] text-amber">
            <span aria-hidden="true">⚠</span> Unrecognized model — save only if
            you are sure.
          </p>
        )}
      </label>

      {/* Cron schedule */}
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs text-subtext">
          Cron schedule
          <InfoTooltip
            text='5 fields: minute hour day month weekday. Example: "0 9 * * *" = every day at 9:00 AM.'
            side="right"
          />
        </span>
        <div className="flex gap-1.5">
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveCron();
            }}
            spellCheck={false}
            className={`focus-ring min-h-[40px] w-full rounded-lg border bg-ink-700 px-2.5 py-1.5 font-mono text-xs text-white transition-colors ${
              cronError && cronDirty ? "border-status-error/50" : "border-hairline"
            }`}
            aria-invalid={Boolean(cronError) && cronDirty}
          />
          <SaveChip
            disabled={!cronDirty || Boolean(cronError)}
            saving={savingCron}
            onClick={() => void saveCron()}
          />
        </div>
        {cron.trim().length > 0 && (
          <p
            className={`mt-1 text-[0.68rem] ${
              cronError ? "text-status-error" : "text-teal/80"
            }`}
          >
            {cronError ?? describeCron(cron)}
          </p>
        )}
      </label>
    </SidebarSection>
  );
}

function SaveChip({
  disabled,
  saving,
  onClick,
}: {
  disabled: boolean;
  saving: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      aria-label="Save"
      className={`focus-ring flex min-h-[40px] shrink-0 items-center justify-center rounded-lg border px-2.5 text-xs font-medium transition-all ${
        disabled
          ? "cursor-not-allowed border-hairline bg-ink-700 text-subtext/40"
          : "border-teal/40 bg-teal/15 text-teal hover:bg-teal/25"
      }`}
    >
      {saving ? <Spinner className="text-teal" /> : "Save"}
    </button>
  );
}

function ScheduleInfo({
  status,
  config,
}: {
  status: StatusResponse | null;
  config: ContentForgeConfig | null;
}): JSX.Element {
  useNow(30000);
  return (
    <div className="space-y-1.5 rounded-lg border border-hairline bg-ink-600/30 px-3 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-subtext">
          Next run
          <InfoTooltip
            text="When the scheduler will next trigger the pipeline automatically, based on your cron schedule and timezone."
            side="top"
          />
        </span>
        <span className="font-mono text-teal">
          {status?.nextScheduledRun ?? "—"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-subtext">Last run</span>
        <span className="font-mono text-white/80">
          {relativeTime(status?.lastRun)}
        </span>
      </div>
      {config && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtext">Timezone</span>
          <span className="font-mono text-white/60">
            {config.scheduler.timezone}
          </span>
        </div>
      )}
    </div>
  );
}

function StreakBadge({ days }: { days: number }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden="true">
          🔥
        </span>
        <div>
          <p className="text-sm font-semibold text-amber-soft">
            Streak: {days} day{days === 1 ? "" : "s"}
          </p>
          <p className="text-[0.65rem] text-subtext">Consecutive done days</p>
        </div>
      </div>
      <InfoTooltip
        text="Counts back from today: each consecutive day whose pipeline reached the Done status adds one. A missed or errored day resets it."
        side="top"
      />
    </div>
  );
}
