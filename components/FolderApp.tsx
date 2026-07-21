"use client";

// components/FolderApp.tsx
// The dashboard for deployed "bring your own folder" mode. Reads today's content
// from the in-memory workbook (no server data calls), shows the folder switcher
// and a manual "Generate today" button, and writes results back to the folder.
// FolderGate decides between onboarding and this view.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChecklistItem, ContentDomainConfig, ContentRow } from "@/lib/types";
import { ContentTabs } from "./ContentTabs";
import { SettingsMenu } from "./SettingsMenu";
import { FolderOnboarding } from "./FolderOnboarding";
import { ContentDomainEditor } from "./ContentDomainEditor";
import { useStorage, StorageProviderRoot } from "./StorageContext";
import { parseWorkbook, todayString, imageBasename } from "@/lib/client/parseWorkbook";
import { parseImagePaths } from "@/lib/imagePaths";
import { CONTENT_DOMAIN_FILENAME } from "@/lib/client/storageNames";

// A domain is "blank" (never set up) when it has no brand name, niche label,
// or pillars. Duplicated from lib/domainConfig.ts's isBlankDomain (rather than
// imported) because that module pulls in `fs` at module scope and must never
// enter the client bundle.
function isBlankDomain(domain: ContentDomainConfig): boolean {
  return (
    domain.niche.trim().length === 0 &&
    domain.pillars.length === 0 &&
    domain.brand.name.trim().length === 0
  );
}

const IMAGE_FIELDS = ["imageMedium", "imageLinkedin", "imageInstagram"] as const;

// Static publish checklist (client mirror of lib/status.ts buildChecklist).
// Filtered by the domain's enabledPlatforms before being passed down (see
// FolderApp's render below) so a disabled platform never shows a checklist.
const CHECKLIST: ChecklistItem[] = [
  {
    id: "linkedin",
    platform: "LinkedIn",
    bestPostTime: "8:00 AM IST",
    steps: [
      { label: "Copy post body", copyKey: "linkedin" },
      { label: "Paste into LinkedIn and post" },
      { label: "Immediately add first comment with hashtags", copyKey: "linkedinHashtags" },
      { label: "Upload LinkedIn image", copyKey: "imageLinkedin" },
      { label: "Engage with comments within first 60 minutes" },
    ],
  },
  {
    id: "medium",
    platform: "Medium",
    bestPostTime: "11:00 AM IST",
    steps: [
      { label: "Copy article title", copyKey: "mediumTitle" },
      { label: "Copy subtitle", copyKey: "mediumSubtitle" },
      { label: "Copy article body", copyKey: "medium" },
      { label: "Set the URL slug", copyKey: "mediumSlug" },
      { label: "Add SEO meta description", copyKey: "mediumMetaDesc" },
      { label: "Upload cover image", copyKey: "imageMedium" },
      { label: "Publish" },
    ],
  },
  {
    id: "instagram",
    platform: "Instagram",
    bestPostTime: "9:00 AM IST",
    steps: [
      { label: "Copy caption", copyKey: "instagram" },
      { label: "Upload Instagram image", copyKey: "imageInstagram" },
      { label: "Paste caption and post" },
    ],
  },
  {
    id: "youtube",
    platform: "YouTube",
    bestPostTime: "10:00 AM IST",
    steps: [
      { label: "Choose and copy a title", copyKey: "youtubeTitle1" },
      { label: "Record using the script", copyKey: "youtube" },
      { label: "Copy the description with chapters", copyKey: "youtubeDescription" },
    ],
  },
  {
    id: "devto",
    platform: "Dev.to",
    bestPostTime: "12:00 PM IST",
    steps: [
      { label: "Copy the full article with frontmatter", copyKey: "devto" },
      { label: "Paste into dev.to and verify canonical URL" },
      { label: "Publish (set published: true)" },
    ],
  },
];

export function FolderGate(): JSX.Element {
  const { provider } = useStorage();
  return provider ? <FolderApp /> : <FolderOnboarding />;
}

// Single entry point for folder mode, lazy-loaded so local mode never pays for
// this code (or its exceljs client parse) in its bundle.
export function FolderRoot(): JSX.Element {
  return (
    <StorageProviderRoot>
      <FolderGate />
    </StorageProviderRoot>
  );
}

function FolderApp(): JSX.Element {
  const {
    provider,
    workbook,
    credentials,
    info,
    generating,
    error,
    note,
    knowledgeCount,
    generateToday,
    refresh,
    saveRow,
    regenerate,
    publishDraft,
  } = useStorage();
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [todayRow, setTodayRow] = useState<ContentRow | null>(null);
  // Genuinely tracks whether parseWorkbook() is in flight, so the tab
  // skeletons can show real loading state instead of the previous hardcoded
  // `false` (which meant they could never appear even while parsing a
  // freshly-loaded workbook).
  const [parsing, setParsing] = useState(true);

  // Parse the in-memory workbook into rows whenever it changes.
  useEffect(() => {
    let cancelled = false;
    if (!workbook) {
      setRows([]);
      setParsing(false);
      return;
    }
    setParsing(true);
    void parseWorkbook(workbook)
      .then((parsed) => {
        if (!cancelled) setRows(parsed);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workbook]);

  // Resolve today's row + swap image references for previewable blob URLs from
  // the folder. Revoke previous object URLs when the row changes.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    const base = rows.find((r) => r.date === todayString()) ?? null;
    if (!base || !provider) {
      setTodayRow(base);
      return;
    }
    void (async () => {
      const patched: ContentRow = { ...base };
      for (const field of IMAGE_FIELDS) {
        const ref = base[field];
        if (!ref || ref.trim().length === 0) continue;
        // Instagram may hold multiple slide paths (JSON-array string); resolve
        // each to a blob URL and re-serialize so the carousel sees all slides.
        // Single-path fields keep their existing single-blob behavior.
        const paths = parseImagePaths(ref);
        if (paths.length > 1) {
          const resolved: string[] = [];
          for (const p of paths) {
            const url = await provider.imageObjectUrl(imageBasename(p));
            if (url) {
              resolved.push(url);
              created.push(url);
            }
          }
          patched[field] = JSON.stringify(resolved);
        } else {
          const url = await provider.imageObjectUrl(imageBasename(ref));
          patched[field] = url ?? "";
          if (url) created.push(url);
        }
      }
      if (!cancelled) setTodayRow(patched);
      else created.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [rows, provider]);

  const calendar = useMemo(
    () => [...rows].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [rows],
  );

  // Turn a stored image ref (e.g. "/images/2026-…png") into a previewable blob
  // URL from the user's folder for the detail modal.
  const resolveImage = useCallback(
    (ref: string): Promise<string | null> =>
      provider ? provider.imageObjectUrl(imageBasename(ref)) : Promise.resolve(null),
    [provider],
  );

  const keysMissing = !credentials || credentials.deepseekApiKey.trim() === "";
  const hasKnowledge = (knowledgeCount ?? 0) > 0;

  // Brand & content setup — read once per folder connection so a brand-new
  // visitor is prompted to define their own niche instead of generating with
  // a blank/placeholder brand.
  const [domain, setDomain] = useState<ContentDomainConfig | null>(null);
  const [domainEditorOpen, setDomainEditorOpen] = useState(false);
  // True until the read below settles — while true, we genuinely don't yet
  // know if brand/content setup is needed, so callers must not treat "not
  // known to be blank" as "known to be fine" (that's the same stale-flash bug
  // as the workbook race, just for this one field).
  const [domainLoading, setDomainLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    if (!provider) {
      setDomain(null);
      setDomainLoading(false);
      return;
    }
    setDomainLoading(true);
    void provider
      .readText(CONTENT_DOMAIN_FILENAME)
      .then((text) => {
        if (cancelled) return;
        try {
          setDomain(text ? (JSON.parse(text) as ContentDomainConfig) : null);
        } catch {
          setDomain(null);
        }
      })
      .finally(() => {
        if (!cancelled) setDomainLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, info?.folderName]);
  const domainNotSetUp = domain !== null && isBlankDomain(domain);

  const notReady =
    keysMissing || knowledgeCount === 0 || domainLoading || domainNotSetUp;

  return (
    <div className="min-h-screen bg-ink-900">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-hairline bg-ink-800/90 px-4 py-3 backdrop-blur-xl sm:px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-teal/40 bg-teal/10 font-mono text-sm font-bold text-teal">
          {(domain?.brand.name.trim().slice(0, 2) || "CF").toUpperCase()}
        </span>
        <span className="font-semibold text-white">ContentForge</span>
        <div className="ml-auto flex items-center gap-2">
          <SettingsMenu />
          <button
            type="button"
            onClick={() => void generateToday()}
            disabled={generating || keysMissing}
            className="focus-ring rounded-lg border border-teal/50 bg-teal/15 px-3.5 py-1.5 text-sm font-semibold text-teal transition-colors hover:bg-teal/25 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate today"}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {notReady && (
          <div
            role="alert"
            className="flex flex-col gap-4 rounded-xl border border-amber/40 bg-amber/10 p-4"
          >
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-white">Add your data to get started</p>
              <p className="text-sm text-subtext">
                Everything lives in your chosen folder — add the files below, then refresh.
              </p>
            </div>

            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`shrink-0 font-mono ${keysMissing ? "text-subtext" : "text-teal"}`}
                >
                  {keysMissing ? "✗" : "✓"}
                </span>
                <span className="text-white">
                  ① Add your API keys to <span className="font-mono text-amber">credentials.env</span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`shrink-0 font-mono ${hasKnowledge ? "text-teal" : "text-subtext"}`}
                >
                  {hasKnowledge ? "✓" : "✗"}
                </span>
                <span className="text-white">
                  ② Drop your notes (.pdf, .docx, .pptx, .xlsx, .png) into the{" "}
                  <span className="font-mono text-amber">knowledge/</span> folder
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`shrink-0 font-mono ${
                    domainLoading ? "text-subtext" : domainNotSetUp ? "text-subtext" : "text-teal"
                  }`}
                >
                  {domainLoading ? "…" : domainNotSetUp ? "✗" : "✓"}
                </span>
                <span className="text-white">
                  ③ Set up your brand &amp; content — name, niche, pillars, and voice
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="shrink-0 font-mono text-subtext">
                  •
                </span>
                <span className="text-subtext">
                  ④ (optional) Open Settings → Weekly plan to set each weekday&apos;s theme,
                  voice, and which knowledge files to use
                </span>
              </li>
            </ul>

            <div className="flex gap-2">
              {domainNotSetUp && (
                <button
                  type="button"
                  onClick={() => setDomainEditorOpen(true)}
                  className="focus-ring shrink-0 self-start rounded-lg border border-amber/50 bg-amber/15 px-3 py-1.5 text-sm font-semibold text-amber-soft hover:bg-amber/25"
                >
                  Set up brand &amp; content
                </button>
              )}
              <button
                type="button"
                onClick={() => void refresh()}
                className="focus-ring shrink-0 self-start rounded-lg border border-teal/50 bg-teal/10 px-3 py-1.5 text-sm font-semibold text-teal hover:bg-teal/20"
              >
                Refresh
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-status-error/40 bg-status-error/10 p-3 text-sm text-status-error">
            {error}
          </p>
        )}
        {note && !error && (
          <p className="rounded-lg border border-teal/30 bg-teal/10 p-3 text-sm text-teal">{note}</p>
        )}

        <ContentTabs
          today={todayRow}
          liveStatus={null}
          calendar={calendar}
          checklist={CHECKLIST}
          fileModified={todayRow?.lastUpdated ?? null}
          loading={{ today: parsing, calendar: parsing, checklist: parsing }}
          onRun={() => void generateToday()}
          pipelineRunning={generating}
          progress={generating ? 50 : 0}
          onSaveRow={saveRow}
          resolveImage={resolveImage}
          onRegenerate={regenerate}
          onPublishDraft={publishDraft}
        />
        <p className="pt-2 text-center text-xs text-subtext">
          Mode:{" "}
          {info?.mode === "folder"
            ? `folder (${info.folderName})`
            : info?.mode === "drive"
              ? `Google Drive (${info.folderName})`
              : "upload/download"}{" "}
          ·{" "}
          {info?.mode === "drive"
            ? "your data and keys stay in your Google Drive"
            : "your data and keys stay on this device"}
        </p>
      </main>

      {domainEditorOpen && domain && (
        <ContentDomainEditor
          domain={domain}
          deepseekApiKey={credentials?.deepseekApiKey}
          onSave={async (next) => {
            if (!provider) return;
            await provider.writeText(CONTENT_DOMAIN_FILENAME, JSON.stringify(next, null, 2));
            setDomain(next);
          }}
          onClose={() => setDomainEditorOpen(false)}
        />
      )}
    </div>
  );
}
