"use client";

// components/TopicDetailModal.tsx
// Full-screen detail view for a single calendar topic. Shows every platform's
// content + images, tracks a per-platform publish lifecycle, and lets the user
// edit content / status / URL / notes. All edits are diffed against a baseline
// and persisted via `onSave` (server mode → /api/row, folder mode → workbook in
// the browser). With no `onSave` the modal is read-only.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ContentRow } from "@/lib/types";
import { parseImagePaths } from "@/lib/imagePaths";
import {
  PLATFORM_LABEL,
  PLATFORM_PUBLISH_FIELD,
  PUBLISH_STATES,
  WRITABLE_FIELDS,
  parsePublishStatus,
  publishProgress,
  serializePublishStatus,
  type Platform,
  type PublishState,
} from "@/lib/publishStatus";
import { PUBLISH_META, PublishStatusBadge } from "./publishStatusBadge";
import { StatusBadge } from "./statusBadge";
import { CopyButton } from "./CopyButton";
import { relativeTime } from "./ui";

export interface TopicDetailModalProps {
  row: ContentRow;
  onClose: () => void;
  /** Persist a row diff. When omitted, the modal is read-only. */
  onSave?: (date: string, updates: Partial<ContentRow>) => Promise<void>;
  /** Map a stored image ref to a displayable URL (folder mode → blob URL). */
  resolveImage?: (ref: string) => Promise<string | null>;
  /** Delete this day's row + images and regenerate fresh content. */
  onRegenerate?: (date: string) => void | Promise<void>;
  /** Delete this day's row + images only — no regeneration. */
  onDelete?: (date: string) => void | Promise<void>;
  /** Publish a platform's content to that platform. Omit to hide the button. */
  onPublishDraft?: (
    date: string,
    platform: Platform,
  ) => Promise<{ url: string; note?: string; state: PublishState }>;
}

/**
 * Platforms that expose a one-click publish button in the modal, with the
 * button label and (for irreversible live posts) a confirm prompt.
 */
const PUBLISH_BUTTONS: Partial<
  Record<
    Platform,
    { label: string; busyLabel: string; openText: string; confirm?: string }
  >
> = {
  linkedin: {
    label: "Post to LinkedIn",
    busyLabel: "Posting…",
    openText: "Posted — open on LinkedIn ↗",
    confirm:
      "This posts the image + body to LinkedIn LIVE, immediately (hashtags as the first comment). There is no draft or undo. Continue?",
  },
  devto: {
    label: "Save Dev.to draft",
    busyLabel: "Saving draft…",
    openText: "Draft created — open in Dev.to ↗",
  },
  medium: {
    label: "Save Medium draft",
    busyLabel: "Saving draft…",
    openText: "Draft created — open in Medium ↗",
  },
  instagram: {
    label: "Publish to Instagram",
    busyLabel: "Publishing…",
    openText: "Published — open on Instagram ↗",
    confirm:
      "This posts the image + caption to Instagram LIVE, immediately. There is no draft or undo. Continue?",
  },
};

interface FieldDef {
  key: keyof ContentRow;
  label: string;
  kind: "input" | "textarea" | "article";
}

interface PlatformDef {
  platform: Platform;
  images: Array<keyof ContentRow>;
  carousel?: boolean;
  fields: FieldDef[];
}

const PLATFORM_DEFS: PlatformDef[] = [
  {
    platform: "linkedin",
    images: ["imageLinkedin"],
    fields: [
      { key: "linkedin", label: "Post body", kind: "textarea" },
      { key: "linkedinHashtags", label: "Hashtags (first comment)", kind: "textarea" },
    ],
  },
  {
    platform: "medium",
    images: ["imageMedium"],
    fields: [
      { key: "mediumTitle", label: "Title", kind: "input" },
      { key: "mediumSubtitle", label: "Subtitle", kind: "input" },
      { key: "mediumSlug", label: "URL slug", kind: "input" },
      { key: "mediumMetaDesc", label: "Meta description (SEO)", kind: "textarea" },
      { key: "medium", label: "Article (Markdown)", kind: "article" },
    ],
  },
  {
    platform: "instagram",
    images: ["imageInstagram"],
    carousel: true,
    fields: [{ key: "instagram", label: "Caption", kind: "textarea" }],
  },
  {
    platform: "youtube",
    images: [],
    fields: [
      { key: "youtubeTitle1", label: "Title option 1", kind: "input" },
      { key: "youtubeTitle2", label: "Title option 2", kind: "input" },
      { key: "youtubeTitle3", label: "Title option 3", kind: "input" },
      { key: "youtubeDescription", label: "Description", kind: "textarea" },
      { key: "youtube", label: "Script", kind: "article" },
    ],
  },
  {
    platform: "devto",
    images: [],
    fields: [{ key: "devto", label: "Article (with frontmatter)", kind: "article" }],
  },
];

function messageFrom(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Couldn't save. Try again.";
}

function diffRow(base: ContentRow, draft: ContentRow): Partial<ContentRow> {
  const out: Partial<ContentRow> = {};
  for (const f of WRITABLE_FIELDS) {
    if (String(base[f] ?? "") !== String(draft[f] ?? "")) {
      (out as Record<string, string>)[f as string] = String(draft[f] ?? "");
    }
  }
  return out;
}

function imageRefs(def: PlatformDef, row: ContentRow): string[] {
  const refs: string[] = [];
  for (const field of def.images) {
    const raw = String(row[field] ?? "");
    if (def.carousel) {
      // Instagram may hold a JSON-array string of slides or a legacy single
      // path; parseImagePaths normalizes both (and empty) to a string[].
      refs.push(...parseImagePaths(raw));
    } else if (raw.trim()) {
      refs.push(raw.trim());
    }
  }
  return refs;
}

export function TopicDetailModal({
  row,
  onClose,
  onSave,
  resolveImage,
  onRegenerate,
  onDelete,
  onPublishDraft,
}: TopicDetailModalProps): JSX.Element {
  const editable = typeof onSave === "function";

  const [draft, setDraft] = useState<ContentRow>(row);
  const [baseline, setBaseline] = useState<ContentRow>(row);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [imgMap, setImgMap] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState<Platform | null>(null);
  const [publishMsg, setPublishMsg] = useState<
    {
      platform: Platform;
      url?: string;
      note?: string;
      error?: string;
      state?: PublishState;
    } | null
  >(null);

  const dateRef = useRef(row.date);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Reseed only when a different topic opens — never clobber in-progress edits.
  useEffect(() => {
    if (dateRef.current !== row.date) {
      dateRef.current = row.date;
      setDraft(row);
      setBaseline(row);
      setSaveError(null);
      setSavedTick(0);
    }
  }, [row]);

  const updates = useMemo(() => diffRow(baseline, draft), [baseline, draft]);
  const dirty = Object.keys(updates).length > 0;

  const setField = useCallback((key: keyof ContentRow, value: string): void => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const setPublishState = useCallback(
    (platform: Platform, state: PublishState): void => {
      const field = PLATFORM_PUBLISH_FIELD[platform];
      const current = parsePublishStatus(String(draft[field] ?? ""));
      const next = { ...current, state };
      if (state === "published" && !next.at) next.at = new Date().toISOString();
      setField(field, serializePublishStatus(next));
    },
    [draft, setField],
  );

  const setPublishUrl = useCallback(
    (platform: Platform, url: string): void => {
      const field = PLATFORM_PUBLISH_FIELD[platform];
      const current = parsePublishStatus(String(draft[field] ?? ""));
      setField(field, serializePublishStatus({ ...current, url }));
    },
    [draft, setField],
  );

  const attemptClose = useCallback((): void => {
    if (
      dirty &&
      !window.confirm("Discard unsaved changes?")
    ) {
      return;
    }
    onClose();
  }, [dirty, onClose]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!onSave || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(row.date, updates);
      setBaseline(draft);
      setSavedTick((t) => t + 1);
    } catch (err) {
      setSaveError(messageFrom(err));
    } finally {
      setSaving(false);
    }
  }, [onSave, dirty, row.date, updates, draft]);

  // Publish a platform's content. On success also advance the baseline for that
  // platform's status field so the persisted publish status doesn't surface as
  // an unsaved edit (the caller already wrote it). The lifecycle state comes
  // back from the caller — "in-review" for a Dev.to draft, "published" for a
  // live Instagram post. Live posts are gated behind a confirm prompt.
  const handlePublishDraft = useCallback(
    async (platform: Platform): Promise<void> => {
      if (!onPublishDraft) return;
      const cfg = PUBLISH_BUTTONS[platform];
      if (cfg?.confirm && !window.confirm(cfg.confirm)) return;
      setPublishing(platform);
      setPublishMsg(null);
      try {
        const { url, note, state } = await onPublishDraft(row.date, platform);
        const field = PLATFORM_PUBLISH_FIELD[platform];
        const packed = serializePublishStatus({
          state,
          url,
          at: new Date().toISOString(),
        });
        setDraft((d) => ({ ...d, [field]: packed }));
        setBaseline((b) => ({ ...b, [field]: packed }));
        setPublishMsg({ platform, url, note, state });
      } catch (err) {
        setPublishMsg({ platform, error: messageFrom(err) });
      } finally {
        setPublishing(null);
      }
    },
    [onPublishDraft, row.date],
  );

  // Focus the close button on open; lock body scroll while open.
  useEffect(() => {
    closeBtnRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc closes (with unsaved guard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") attemptClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [attemptClose]);

  // Resolve image refs for the open topic; revoke any blob URLs we create.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    const refs = Array.from(
      new Set(PLATFORM_DEFS.flatMap((def) => imageRefs(def, row))),
    );
    void (async () => {
      const map: Record<string, string> = {};
      for (const ref of refs) {
        const url = resolveImage ? await resolveImage(ref) : ref;
        if (url) {
          map[ref] = url;
          if (url.startsWith("blob:")) created.push(url);
        }
      }
      if (!cancelled) setImgMap(map);
      else created.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [row, resolveImage]);

  const progress = publishProgress(draft);

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={attemptClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${row.topic}`}
        onClick={(e) => e.stopPropagation()}
        className="panel my-4 flex max-h-[92vh] w-full max-w-3xl animate-fade-up flex-col p-0"
      >
        {/* Header */}
        <header className="flex items-start gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-white sm:text-lg">
              {row.topic || "Untitled topic"}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtext">
              <span className="font-mono">{row.date}</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{row.pillar.replace("-", " ")}</span>
              <span aria-hidden="true">·</span>
              <span>{row.postStructure}</span>
              <span aria-hidden="true">·</span>
              <span>updated {relativeTime(row.lastUpdated)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={row.status} size="sm" />
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium ${
                  progress.published === progress.total && progress.total > 0
                    ? "border-status-done/40 bg-status-done/10 text-status-done"
                    : "border-hairline bg-ink-600/40 text-subtext"
                }`}
              >
                {progress.published} / {progress.total} published
              </span>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={attemptClose}
            aria-label="Close details"
            className="focus-ring -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline text-subtext transition-colors hover:border-teal/40 hover:text-white"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ✕
            </span>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {row.errorMessage.trim() && (
            <p
              role="alert"
              className="rounded-lg border border-status-error/40 bg-status-error/10 p-3 text-xs text-status-error"
            >
              ⚠ {row.errorMessage}
            </p>
          )}

          {PLATFORM_DEFS.map((def) => (
            <PlatformSection
              key={def.platform}
              def={def}
              draft={draft}
              editable={editable}
              imgMap={imgMap}
              onField={setField}
              onState={setPublishState}
              onUrl={setPublishUrl}
              onPublish={onPublishDraft ? () => handlePublishDraft(def.platform) : undefined}
              publishing={publishing === def.platform}
              publishMsg={publishMsg && publishMsg.platform === def.platform ? publishMsg : null}
            />
          ))}

          {/* Per-topic notes */}
          <section className="rounded-xl border border-hairline bg-ink-800/40 p-4">
            <FieldHeader label="Notes" copyValue={draft.performanceNotes} />
            <textarea
              value={draft.performanceNotes}
              onChange={(e) => setField("performanceNotes", e.target.value)}
              readOnly={!editable}
              rows={3}
              placeholder="Performance notes, reminders, follow-ups…"
              className="mt-1.5 w-full resize-y rounded-lg border border-hairline bg-ink-800/60 px-3 py-2 text-sm text-white/90 placeholder:text-subtext focus-ring read-only:opacity-80"
            />
          </section>
        </div>

        {/* Footer */}
        {(editable || onRegenerate || onDelete) && (
          <footer className="flex items-center gap-3 border-t border-hairline px-5 py-3">
            {onRegenerate && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete the content and images for ${row.date}, then regenerate fresh content?`,
                    )
                  ) {
                    void onRegenerate(row.date);
                    onClose();
                  }
                }}
                title="Delete this day's content and regenerate"
                className="focus-ring rounded-lg border border-hairline bg-ink-600/60 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-status-error/50 hover:text-status-error"
              >
                ↻ Delete &amp; regenerate
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete the content and images for ${row.date}? This cannot be undone.`,
                    )
                  ) {
                    void onDelete(row.date);
                    onClose();
                  }
                }}
                title="Delete this day's content and images"
                className="focus-ring rounded-lg border border-hairline bg-ink-600/60 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-status-error/50 hover:text-status-error"
              >
                🗑 Delete
              </button>
            )}
            <div className="min-w-0 flex-1 text-xs">
              {editable &&
                (saveError ? (
                  <span className="text-status-error">{saveError}</span>
                ) : dirty ? (
                  <span className="text-amber-soft">Unsaved changes</span>
                ) : savedTick > 0 ? (
                  <span className="text-status-done">All changes saved</span>
                ) : (
                  <span className="text-subtext">No changes yet</span>
                ))}
            </div>
            <button
              type="button"
              onClick={attemptClose}
              className="focus-ring rounded-lg border border-hairline bg-ink-600/60 px-3.5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-teal/40 hover:text-teal"
            >
              Close
            </button>
            {editable && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                className="focus-ring rounded-lg bg-teal px-4 py-1.5 text-xs font-semibold text-ink-900 shadow-glow transition-colors hover:bg-teal-soft disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function PlatformSection({
  def,
  draft,
  editable,
  imgMap,
  onField,
  onState,
  onUrl,
  onPublish,
  publishing,
  publishMsg,
}: {
  def: PlatformDef;
  draft: ContentRow;
  editable: boolean;
  imgMap: Record<string, string>;
  onField: (key: keyof ContentRow, value: string) => void;
  onState: (platform: Platform, state: PublishState) => void;
  onUrl: (platform: Platform, url: string) => void;
  onPublish?: () => void;
  publishing?: boolean;
  publishMsg?: {
    platform: Platform;
    url?: string;
    note?: string;
    error?: string;
    state?: PublishState;
  } | null;
}): JSX.Element {
  const field = PLATFORM_PUBLISH_FIELD[def.platform];
  const info = parsePublishStatus(String(draft[field] ?? ""));
  const refs = imageRefs(def, draft).map((r) => imgMap[r]).filter(Boolean);
  const publishButton = PUBLISH_BUTTONS[def.platform];

  return (
    <section className="rounded-xl border border-hairline bg-ink-800/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">
          {PLATFORM_LABEL[def.platform]}
        </h3>
        <div className="flex items-center gap-2">
          {publishButton && onPublish && info.state !== "published" && (
            <button
              type="button"
              onClick={() => void onPublish()}
              disabled={publishing}
              className="focus-ring rounded-lg border border-teal/50 bg-teal/15 px-2.5 py-1 text-xs font-semibold text-teal transition-colors hover:bg-teal/25 disabled:opacity-50"
            >
              {publishing ? publishButton.busyLabel : publishButton.label}
            </button>
          )}
          <PublishStatusBadge state={info.state} size="sm" />
          {editable && (
            <select
              value={info.state}
              onChange={(e) =>
                onState(def.platform, e.target.value as PublishState)
              }
              aria-label={`${PLATFORM_LABEL[def.platform]} publish status`}
              className="focus-ring rounded-lg border border-hairline bg-ink-700 px-2 py-1 text-xs text-white/90"
            >
              {PUBLISH_STATES.map((s) => (
                <option key={s} value={s}>
                  {PUBLISH_META[s].label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {publishMsg && (
        <div className="mt-2 text-xs">
          {publishMsg.error ? (
            <p className="text-status-error">{publishMsg.error}</p>
          ) : (
            <p className="text-status-done">
              <a
                href={publishMsg.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-status-done/80"
              >
                {PUBLISH_BUTTONS[publishMsg.platform]?.openText ??
                  "Open published post ↗"}
              </a>
              {publishMsg.note && (
                <span className="ml-2 text-subtext">{publishMsg.note}</span>
              )}
            </p>
          )}
        </div>
      )}

      {info.state === "published" && (
        <div className="mt-3">
          <label className="mb-1 block text-[0.68rem] uppercase tracking-wider text-subtext">
            Live URL
          </label>
          <input
            type="url"
            value={info.url ?? ""}
            onChange={(e) => onUrl(def.platform, e.target.value)}
            readOnly={!editable}
            placeholder="https://…"
            className="w-full rounded-lg border border-hairline bg-ink-800/60 px-3 py-1.5 text-sm text-white/90 placeholder:text-subtext focus-ring read-only:opacity-80"
          />
          {info.at && (
            <p className="mt-1 text-[0.68rem] text-subtext">
              Marked published {relativeTime(info.at)}
            </p>
          )}
        </div>
      )}

      {refs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {refs.map((src, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={i}
              src={src}
              alt={`${PLATFORM_LABEL[def.platform]} image ${i + 1}`}
              className="h-24 w-40 rounded-md border border-hairline object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-3 space-y-3">
        {def.fields.map((f) => (
          <EditableField
            key={String(f.key)}
            label={f.label}
            value={String(draft[f.key] ?? "")}
            kind={f.kind}
            editable={editable}
            onChange={(v) => onField(f.key, v)}
          />
        ))}
      </div>
    </section>
  );
}

function EditableField({
  label,
  value,
  kind,
  editable,
  onChange,
}: {
  label: string;
  value: string;
  kind: "input" | "textarea" | "article";
  editable: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const base =
    "w-full rounded-lg border border-hairline bg-ink-800/60 px-3 py-2 text-sm text-white/90 placeholder:text-subtext focus-ring read-only:opacity-80";
  return (
    <div>
      <FieldHeader label={label} copyValue={value} />
      {kind === "input" ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={!editable}
          className={`mt-1.5 ${base}`}
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={!editable}
          rows={kind === "article" ? 10 : 4}
          className={`mt-1.5 resize-y ${kind === "article" ? "font-mono" : "font-sans"} ${base}`}
        />
      )}
    </div>
  );
}

function FieldHeader({
  label,
  copyValue,
}: {
  label: string;
  copyValue: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[0.68rem] uppercase tracking-wider text-subtext">
        {label}
      </span>
      <CopyButton value={copyValue} compact />
    </div>
  );
}
