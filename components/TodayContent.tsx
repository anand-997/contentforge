"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContentRow, StatusEnum } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { ImageCarousel } from "./ImageCarousel";
import { YouTubeTitleSelector } from "./YouTubeTitleSelector";
import { InfoTooltip } from "./InfoTooltip";
import { StatusBadge } from "./statusBadge";
import { Skeleton } from "./ui";

export interface TodayContentProps {
  today: ContentRow | null;
  /** Live status overrides the row status while the pipeline runs. */
  liveStatus: StatusEnum | null;
  onRun: () => void;
  pipelineRunning: boolean;
  progress: number;
  /** What's happening right now (e.g. "Agent 2 → LinkedIn written (187 words)"),
   *  shown in place of the generic "Generating…" subtext when available. */
  progressLabel?: string | null;
  /** Delete today's row + images and regenerate fresh content. */
  onRegenerate?: (date: string) => void | Promise<void>;
  /** Delete today's row + images only — no regeneration. */
  onDelete?: (date: string) => void | Promise<void>;
  /**
   * True while today's row is still being fetched/parsed. Without this,
   * "still loading" and "genuinely no content yet" render identically (both
   * show the empty state below) — which reads as a flash of wrong content
   * once the real row arrives a moment later.
   */
  loading?: boolean;
}

const PLATFORM_ICONS: Record<string, string> = {
  LinkedIn: "in",
  Medium: "M",
  Instagram: "IG",
  YouTube: "YT",
  "Dev.to": "DEV",
};

export function TodayContent({
  today,
  liveStatus,
  onRun,
  pipelineRunning,
  progress,
  progressLabel,
  onRegenerate,
  onDelete,
  loading = false,
}: TodayContentProps): JSX.Element {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-5 w-64" />
          </div>
          <Skeleton className="h-6 w-20 shrink-0" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel space-y-3 p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!today) {
    return (
      <div className="panel flex flex-col items-center justify-center gap-5 px-6 py-16 text-center animate-fade-up">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-teal/30 bg-teal/5 shadow-glow">
          <span className="text-3xl" aria-hidden="true">
            ✨
          </span>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">
            No content for today yet
          </h3>
          <p className="mt-1 max-w-sm text-sm text-subtext">
            Run the pipeline to generate today&apos;s content across LinkedIn,
            Medium, Instagram, YouTube, and Dev.to.
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={pipelineRunning}
          className="focus-ring flex min-h-[48px] items-center gap-2 rounded-xl bg-teal px-6 py-3 text-sm font-semibold text-ink-900 shadow-glow transition-all hover:bg-teal-soft active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden="true">▶</span>
          {pipelineRunning
            ? `Pipeline running… ${Math.round(progress)}%`
            : "Run Pipeline Now"}
        </button>
        {pipelineRunning && (
          <p className="max-w-xs text-xs text-subtext">
            {progressLabel ||
              "Generating across all five platforms — content will appear here as each one finishes."}
          </p>
        )}
      </div>
    );
  }

  const status = liveStatus ?? today.status;

  return (
    <div className="space-y-3">
      {/* Topic header */}
      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between animate-fade-up">
        <div className="min-w-0">
          <p className="font-mono text-xs text-teal">
            {today.date} · {today.pillar.replace("-", " ")} · {today.postStructure}
          </p>
          <h2 className="mt-1 text-lg font-bold leading-snug text-white">
            {today.topic}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={status} live={pipelineRunning} />
          {onRegenerate && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Delete today's content and images, then regenerate fresh content?",
                  )
                ) {
                  void onRegenerate(today.date);
                }
              }}
              disabled={pipelineRunning}
              title="Delete today's content and regenerate"
              className="focus-ring flex min-h-[36px] items-center gap-1.5 rounded-lg border border-hairline bg-ink-600/60 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-teal/40 hover:text-teal disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">↻</span>
              {pipelineRunning ? "Working…" : "Delete & regenerate"}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Delete today's content and images? This cannot be undone.",
                  )
                ) {
                  void onDelete(today.date);
                }
              }}
              disabled={pipelineRunning}
              title="Delete today's content and images"
              className="focus-ring flex min-h-[36px] items-center gap-1.5 rounded-lg border border-hairline bg-ink-600/60 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-status-error/50 hover:text-status-error disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">🗑</span>
              Delete
            </button>
          )}
        </div>
      </div>

      {!pipelineRunning &&
        !today.errorMessage.trim() &&
        (status === "Writing" || status === "Imaging") && (
          <div className="flex flex-col gap-3 rounded-xl border border-status-imaging/40 bg-status-imaging/10 p-3 text-sm text-status-imaging sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-2">
              <span aria-hidden="true">⏸</span>
              <span>
                This day stopped mid-{status === "Writing" ? "writing" : "imaging"} from
                an earlier interrupted run (closed tab, network drop, or a server
                timeout) — nothing is generating right now. Tap Generate to resume
                from where it left off.
              </span>
            </div>
            <button
              type="button"
              onClick={onRun}
              className="focus-ring flex min-h-[40px] shrink-0 items-center gap-2 self-start rounded-lg border border-status-imaging/50 bg-status-imaging/15 px-4 py-2 text-xs font-semibold text-status-imaging transition-all hover:bg-status-imaging/25 active:scale-[0.98]"
            >
              <span aria-hidden="true">▶</span>
              Resume generating
            </button>
          </div>
        )}

      {today.errorMessage.trim() &&
        (today.status === "Done" ? (
          // Content is complete; this is a non-blocking note (e.g. images).
          <div className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm text-amber-soft">
            <span aria-hidden="true">ℹ</span>
            <span>{today.errorMessage}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-status-error/40 bg-status-error/10 p-3 text-sm text-status-error sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-2">
              <span aria-hidden="true">⚠</span>
              <span>{today.errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={onRun}
              disabled={pipelineRunning}
              className="focus-ring flex min-h-[40px] shrink-0 items-center gap-2 self-start rounded-lg border border-status-error/50 bg-status-error/15 px-4 py-2 text-xs font-semibold text-status-error transition-all hover:bg-status-error/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span aria-hidden="true">↻</span>
              {pipelineRunning
                ? `Running… ${Math.round(progress)}%`
                : "Run again"}
            </button>
          </div>
        ))}

      {/* Platform accordions */}
      <LinkedInSection row={today} />
      <MediumSection row={today} />
      <InstagramSection row={today} />
      <YouTubeSection row={today} />
      <DevtoSection row={today} />

      {/* Images */}
      <div className="panel p-4">
        <ImageCarousel
          key={today.lastUpdated}
          imageMedium={today.imageMedium}
          imageLinkedin={today.imageLinkedin}
          imageInstagram={today.imageInstagram}
          version={today.lastUpdated}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accordion shell                                                     */
/* ------------------------------------------------------------------ */

function Accordion({
  platform,
  ready,
  defaultOpen = false,
  headerExtra,
  children,
}: {
  platform: string;
  ready: boolean;
  defaultOpen?: boolean;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel overflow-hidden animate-fade-up">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-600/30"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-ink-600 font-mono text-[0.62rem] font-bold text-teal">
          {PLATFORM_ICONS[platform] ?? platform.slice(0, 2)}
        </span>
        <span className="flex-1 text-sm font-semibold text-white">{platform}</span>
        {headerExtra}
        <span
          className={`flex items-center gap-1.5 text-[0.68rem] ${
            ready ? "text-teal" : "text-subtext"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              ready ? "bg-teal" : "bg-subtext/50"
            }`}
          />
          {ready ? "Ready" : "Empty"}
        </span>
        <span
          aria-hidden="true"
          className={`text-subtext transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="border-t border-hairline px-4 py-4 animate-fade-up">
          {children}
        </div>
      )}
    </div>
  );
}

function FieldHeader({
  title,
  value,
  label,
  help,
}: {
  title: string;
  value: string;
  label: string;
  help?: string;
}): JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtext">
        {title}
        {help && <InfoTooltip text={help} side="top" />}
      </span>
      <CopyButton value={value} label={label} />
    </div>
  );
}

function PlainText({ text }: { text: string }): JSX.Element {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-ink-800/60 p-3 font-sans text-sm leading-relaxed text-white/85">
      {text || "—"}
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/* LinkedIn                                                            */
/* ------------------------------------------------------------------ */

function LinkedInSection({ row }: { row: ContentRow }): JSX.Element {
  return (
    <Accordion platform="LinkedIn" ready={Boolean(row.linkedin.trim())}>
      <FieldHeader
        title="Post body"
        value={row.linkedin}
        label="Copy post"
        help="The post text. Hashtags are intentionally kept out of the body."
      />
      <PlainText text={row.linkedin} />

      <div className="mt-4 rounded-lg border border-amber/30 bg-amber/5 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber">
            First-comment hashtags
            <InfoTooltip
              text="Post hashtags in the FIRST COMMENT, not the body. It keeps the post clean and LinkedIn's algorithm still indexes them — often with better reach."
              side="top"
            />
          </span>
          <CopyButton value={row.linkedinHashtags} label="Copy first comment hashtags" />
        </div>
        <p className="break-words font-mono text-sm text-white/85">
          {row.linkedinHashtags || "—"}
        </p>
      </div>
    </Accordion>
  );
}

/* ------------------------------------------------------------------ */
/* Medium                                                              */
/* ------------------------------------------------------------------ */

function MediumSection({ row }: { row: ContentRow }): JSX.Element {
  const [seoOpen, setSeoOpen] = useState(false);
  return (
    <Accordion platform="Medium" ready={Boolean(row.medium.trim())}>
      {row.mediumTitle && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white">{row.mediumTitle}</h3>
          <CopyButton value={row.mediumTitle} label="Copy title" compact />
        </div>
      )}

      <FieldHeader title="Article (Markdown)" value={row.medium} label="Copy article" />
      <div className="md-body max-h-[420px] overflow-y-auto rounded-lg border border-hairline bg-ink-800/60 p-4">
        {row.medium.trim() ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.medium}</ReactMarkdown>
        ) : (
          <p className="text-subtext">—</p>
        )}
      </div>

      {/* SEO collapsible */}
      <div className="mt-3 rounded-lg border border-hairline bg-ink-600/30">
        <button
          type="button"
          onClick={() => setSeoOpen((v) => !v)}
          aria-expanded={seoOpen}
          className="focus-ring flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-subtext"
        >
          SEO fields
          <InfoTooltip
            text="Metadata for search and social previews: the URL slug, the kicker subtitle, and the 155-char meta description."
            side="top"
          />
          <span
            aria-hidden="true"
            className={`ml-auto transition-transform ${seoOpen ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </button>
        {seoOpen && (
          <div className="space-y-2 border-t border-hairline px-3 py-3">
            <SeoRow label="Slug" value={row.mediumSlug} />
            <SeoRow label="Subtitle" value={row.mediumSubtitle} />
            <SeoRow label="Meta description" value={row.mediumMetaDesc} />
          </div>
        )}
      </div>
    </Accordion>
  );
}

function SeoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[0.68rem] uppercase tracking-wider text-subtext">
          {label}
        </p>
        <p className="break-words font-mono text-xs text-white/85">{value || "—"}</p>
      </div>
      <CopyButton value={value} compact label={`Copy ${label}`} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Instagram                                                           */
/* ------------------------------------------------------------------ */

function InstagramSection({ row }: { row: ContentRow }): JSX.Element {
  return (
    <Accordion platform="Instagram" ready={Boolean(row.instagram.trim())}>
      <FieldHeader
        title="Caption"
        value={row.instagram}
        label="Copy caption"
        help="Full caption: hook, body lines, CTA, and hashtags on the last line."
      />
      <PlainText text={row.instagram} />
    </Accordion>
  );
}

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

function YouTubeSection({ row }: { row: ContentRow }): JSX.Element {
  return (
    <Accordion platform="YouTube" ready={Boolean(row.youtube.trim())}>
      <YouTubeTitleSelector
        titles={[row.youtubeTitle1, row.youtubeTitle2, row.youtubeTitle3]}
      />

      <div className="mt-4">
        <FieldHeader
          title="Script"
          value={row.youtube}
          label="Copy script"
          help="Spoken-word script. [timestamp] markers are highlighted in monospace."
        />
        <ScriptWithTimestamps text={row.youtube} />
      </div>

      <div className="mt-4">
        <FieldHeader
          title="Description"
          value={row.youtubeDescription}
          label="Copy description"
          help="The video description, including the chapters block."
        />
        <PlainText text={row.youtubeDescription} />
      </div>
    </Accordion>
  );
}

/** Highlights [timestamp]/[B-ROLL] markers in monospace teal. */
function ScriptWithTimestamps({ text }: { text: string }): JSX.Element {
  if (!text.trim()) return <PlainText text="" />;
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-ink-800/60 p-3 font-sans text-sm leading-relaxed text-white/85">
      {parts.map((part, i) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <span
            key={i}
            className="mr-1 rounded bg-teal/15 px-1 font-mono text-[0.82em] font-medium text-teal"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/* Dev.to                                                              */
/* ------------------------------------------------------------------ */

function DevtoSection({ row }: { row: ContentRow }): JSX.Element {
  const { frontmatter, body } = splitFrontmatter(row.devto);
  return (
    <Accordion platform="Dev.to" ready={Boolean(row.devto.trim())}>
      <FieldHeader
        title="Article (Markdown)"
        value={row.devto}
        label="Copy article"
        help="Includes the YAML frontmatter block dev.to needs at the top."
      />
      {frontmatter && (
        <div className="mb-3">
          <p className="mb-1 text-[0.68rem] uppercase tracking-wider text-subtext">
            Frontmatter
          </p>
          <pre className="overflow-x-auto rounded-lg border border-hairline bg-ink-900 p-3 font-mono text-xs text-teal-soft">
            {frontmatter}
          </pre>
        </div>
      )}
      <div className="md-body max-h-[420px] overflow-y-auto rounded-lg border border-hairline bg-ink-800/60 p-4">
        {body.trim() ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        ) : (
          <p className="text-subtext">—</p>
        )}
      </div>
    </Accordion>
  );
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match) {
    return { frontmatter: `---\n${match[1]}\n---`, body: match[2] };
  }
  return { frontmatter: "", body: raw };
}
