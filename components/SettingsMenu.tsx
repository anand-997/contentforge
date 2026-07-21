"use client";

// components/SettingsMenu.tsx
// A gear "Settings" control for folder mode. Toggles a right-aligned dropdown
// that lets the user switch folders, reconnect to a recent one (folder mode),
// download files (upload mode), and see at a glance whether their API keys and
// knowledge files are set up. All data flows through the storage context.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStorage } from "./StorageContext";
import { DriveSetup } from "./DriveSetup";
import { ContentDomainEditor } from "./ContentDomainEditor";
import { AgentPromptsEditor } from "./AgentPromptsEditor";
import { WeeklyPlanEditor } from "./WeeklyPlanEditor";
import { UploadDownloadStorage, listRecentFolders } from "@/lib/client/storage";
import { hasFullDriveGrant, isGoogleAuthError, listRecentDrives } from "@/lib/client/driveAuth";
import { importLocalFolder, isImportSupported } from "@/lib/client/importLocal";
import type { ImportProgress, ImportResult } from "@/lib/client/importLocal";
import { CREDENTIALS_FILENAME } from "@/lib/credentialsTemplate";
import {
  CONTENT_DOMAIN_FILENAME,
  PROMPTS_FILENAME,
  WEEKLY_PLAN_FILENAME,
} from "@/lib/client/storageNames";
import type { RecentFolder } from "@/lib/client/contract";
// Value imports only as `import type` below — lib/promptConfig.ts and
// lib/weeklyConfig.ts both import `fs` at module scope for their server-side
// read/write functions, so a runtime import here would break the client
// bundle. Fallback shapes are inlined instead (BLANK_PROMPTS/BLANK_PLAN below).
import type { AgentPrompts } from "@/lib/promptConfig";
import type { ContentDomainConfig, Weekday, WeekdayPlan } from "@/lib/types";

const BLANK_DOMAIN: ContentDomainConfig = {
  niche: "",
  description: "",
  brand: {
    name: "",
    handle: "",
    location: "",
    timezone: "UTC",
    devtoSeries: "",
    mediumHandle: "",
    roles: "",
    expertise: "",
    mission: "",
    imageColors: {
      background: "#0d1117",
      accent: "#00d4aa",
      secondaryAccent: "#f0a500",
      text: "#ffffff",
      subtext: "#8b949e",
    },
  },
  pillars: [],
  enabledPlatforms: { linkedin: true, medium: true, instagram: true, youtube: true, devto: true },
  keywords: [],
  hashtagUniverse: [],
  devtoTags: [],
  voiceSamples: [],
};

const BLANK_PROMPT_BLOCK = { role: "", instructions: [], parameters: [], tone: "" };
const BLANK_PROMPTS: AgentPrompts = {
  topic: BLANK_PROMPT_BLOCK,
  brief: BLANK_PROMPT_BLOCK,
  content: BLANK_PROMPT_BLOCK,
  image: { role: "", parameters: [], sublineSource: "fact", headlineMaxChars: 56 },
};

const BLANK_WEEKDAY_PLAN: WeekdayPlan = {
  theme: "",
  keywords: [],
  pillar: "",
  learningTags: [],
  knowledgeFiles: [],
  voice: { name: "", persona: "", toneDirectives: [] },
};
const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const BLANK_PLAN: Record<Weekday, WeekdayPlan> = Object.fromEntries(
  WEEKDAYS.map((d) => [d, BLANK_WEEKDAY_PLAN]),
) as Record<Weekday, WeekdayPlan>;

function parseJsonOr<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function SettingsMenu(): JSX.Element {
  const {
    info,
    provider,
    knowledgeCount,
    credentials,
    switchFolder,
    reconnect,
    chooseDrive,
    chooseDriveFolder,
    reconnectDrive,
    driveConfigured,
    drivePickerConfigured,
    driveCredsSource,
    driveNeedsConsent,
    error,
    busy,
    refresh,
  } = useStorage();
  const [recent, setRecent] = useState<RecentFolder[]>([]);
  const [open, setOpen] = useState(false);
  // In-app credentials.env editor — Drive folders can't be edited with a desktop
  // text editor, so we let the user edit the file in-app.
  const [editingKeys, setEditingKeys] = useState(false);
  const [keysText, setKeysText] = useState("");
  const [keysBusy, setKeysBusy] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  // Local → Drive import.
  const [confirmImport, setConfirmImport] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [driveSetupOpen, setDriveSetupOpen] = useState(false);

  // Brand & content editors — content-domain.json / agent-prompts.json /
  // weekly-plan.json, all stored in this same folder/Drive location.
  const [editingDomain, setEditingDomain] = useState(false);
  const [editingPrompts, setEditingPrompts] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [domainDraft, setDomainDraft] = useState<ContentDomainConfig | null>(null);
  const [promptsDraft, setPromptsDraft] = useState<AgentPrompts | null>(null);
  const [planDraft, setPlanDraft] = useState<Record<Weekday, WeekdayPlan> | null>(null);
  const [loadingSection, setLoadingSection] = useState<"domain" | "prompts" | "plan" | null>(null);

  const isDrive = info?.mode === "drive";

  async function openDomainEditor(): Promise<void> {
    if (!provider) return;
    setLoadingSection("domain");
    try {
      const text = await provider.readText(CONTENT_DOMAIN_FILENAME);
      setDomainDraft(parseJsonOr(text, BLANK_DOMAIN));
      setEditingDomain(true);
    } finally {
      setLoadingSection(null);
    }
  }

  async function openPromptsEditor(): Promise<void> {
    if (!provider) return;
    setLoadingSection("prompts");
    try {
      const text = await provider.readText(PROMPTS_FILENAME);
      setPromptsDraft(parseJsonOr(text, BLANK_PROMPTS));
      setEditingPrompts(true);
    } finally {
      setLoadingSection(null);
    }
  }

  async function openPlanEditor(): Promise<void> {
    if (!provider) return;
    setLoadingSection("plan");
    try {
      const text = await provider.readText(WEEKLY_PLAN_FILENAME);
      setPlanDraft(parseJsonOr(text, BLANK_PLAN));
      setEditingPlan(true);
    } finally {
      setLoadingSection(null);
    }
  }

  const runImport = async (): Promise<void> => {
    if (!provider) return;
    setConfirmImport(false);
    setImportError(null);
    setImportResult(null);
    setImportProgress({ done: 0, total: 0, current: "" });
    try {
      const result = await importLocalFolder(provider, setImportProgress);
      // null = the user cancelled the folder picker.
      if (result) {
        setImportResult(result);
        await refresh();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImportProgress(null);
    }
  };

  const openKeyEditor = async (): Promise<void> => {
    if (!provider) return;
    setKeysError(null);
    setKeysBusy(true);
    try {
      const text = await provider.readText(CREDENTIALS_FILENAME);
      setKeysText(text ?? "");
      setEditingKeys(true);
    } catch (err) {
      setKeysError(err instanceof Error ? err.message : "Couldn't load credentials.");
    } finally {
      setKeysBusy(false);
    }
  };

  const saveKeys = async (): Promise<void> => {
    if (!provider) return;
    setKeysError(null);
    setKeysBusy(true);
    try {
      await provider.writeText(CREDENTIALS_FILENAME, keysText);
      await refresh();
      setEditingKeys(false);
    } catch (err) {
      setKeysError(err instanceof Error ? err.message : "Couldn't save credentials.");
    } finally {
      setKeysBusy(false);
    }
  };

  useEffect(() => {
    if (info?.mode === "folder") {
      void listRecentFolders().then(setRecent).catch(() => setRecent([]));
    } else if (info?.mode === "drive") {
      void listRecentDrives().then(setRecent).catch(() => setRecent([]));
    } else {
      setRecent([]);
    }
  }, [info?.mode, info?.folderName]);

  const keysDone =
    info?.credentialsFilled === true ||
    (credentials?.deepseekApiKey?.trim().length ?? 0) > 0;
  const knowledgeDone = (knowledgeCount ?? 0) > 0;
  const others = recent.filter((f) => f.name !== info?.folderName);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex items-center gap-2 rounded-md border border-hairline bg-ink-700/50 px-2.5 py-1 text-xs text-white hover:border-teal/40"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden="true" className="text-teal">
          ⚙
        </span>
        <span>Settings</span>
        <span aria-hidden="true" className="text-subtext">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-72 rounded-lg border border-hairline bg-ink-800 p-3 shadow-xl"
        >
          <p className="px-0.5 text-sm font-semibold text-white">Settings</p>

          <div className="mt-2 rounded-md border border-hairline bg-ink-700/50 px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-subtext">
              Current folder
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-white">
              {info?.mode === "upload" ? "Upload mode" : info?.folderName ?? "—"}
            </p>
            {/* Surface the Drive permission level: a limited grant is why an app
                can look at a populated folder and see nothing. */}
            {isDrive && (
              <p
                className={`mt-1 text-[10px] ${
                  hasFullDriveGrant() ? "text-teal" : "text-status-error"
                }`}
              >
                {hasFullDriveGrant()
                  ? "✓ Full Drive access"
                  : "✗ Limited access — app-created files only"}
              </p>
            )}
          </div>

          {error && (
            <div className="mt-2">
              <p role="alert" className="px-0.5 text-xs text-status-error">
                {error}
              </p>
              {driveNeedsConsent && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    void chooseDrive();
                  }}
                  className="focus-ring mt-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-status-imaging/60 bg-status-imaging/15 px-2.5 py-2 text-sm font-semibold text-status-imaging transition-colors hover:bg-status-imaging/25 disabled:opacity-50"
                >
                  {busy ? "Opening…" : "Grant Drive access"}
                </button>
              )}
              {/* Any other Drive OAuth failure (popup closed/blocked, Client ID
                  rejected by Google) — retrying with the same value fails
                  identically, so point at Drive setup to review/fix it instead. */}
              {!driveNeedsConsent && isGoogleAuthError(error) && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setDriveSetupOpen(true);
                  }}
                  className="focus-ring mt-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-status-imaging/60 bg-status-imaging/15 px-2.5 py-2 text-sm font-semibold text-status-imaging transition-colors hover:bg-status-imaging/25 disabled:opacity-50"
                >
                  Check Google Drive setup
                </button>
              )}
            </div>
          )}

          {/* Picking a specific Drive folder needs the optional Picker API key. */}
          {info?.mode !== "upload" && (!isDrive || drivePickerConfigured) && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                if (isDrive) {
                  void chooseDriveFolder();
                } else {
                  void switchFolder();
                }
              }}
              className="focus-ring mt-2 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10 disabled:opacity-50"
            >
              {isDrive ? "Choose a different Drive folder" : "Switch folder"}
            </button>
          )}

          {driveConfigured && !isDrive && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                void chooseDrive();
              }}
              className="focus-ring mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10 disabled:opacity-50"
            >
              Connect Google Drive
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDriveSetupOpen(true);
            }}
            className="focus-ring mt-1 flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10"
          >
            <span>Google Drive setup</span>
            <span className="text-[10px] uppercase tracking-wide text-subtext">
              {driveCredsSource === "user"
                ? "saved"
                : driveCredsSource === "env"
                  ? "default"
                  : "not set"}
            </span>
          </button>

          {(info?.mode === "folder" || isDrive) && others.length > 0 && (
            <>
              <p className="px-2.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-subtext">
                {isDrive ? "Recent Drive folders" : "Recent folders"}
              </p>
              {others.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    if (isDrive) {
                      void reconnectDrive(f.id);
                    } else {
                      void reconnect(f.id);
                    }
                  }}
                  className="focus-ring block w-full truncate rounded-md px-2.5 py-1.5 text-left font-mono text-xs text-white hover:bg-ink-700 disabled:opacity-50"
                >
                  {f.name}
                </button>
              ))}
            </>
          )}

          {info?.mode === "upload" && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                if (provider instanceof UploadDownloadStorage) {
                  void provider.downloadAll();
                }
              }}
              className="focus-ring mt-1 flex w-full items-center gap-2 rounded-md border border-teal/40 bg-teal/10 px-2.5 py-2 text-left text-sm font-semibold text-teal hover:bg-teal/20 disabled:opacity-50"
            >
              Download files
            </button>
          )}

          <div className="mt-3 border-t border-hairline pt-2">
            <div className="flex items-center justify-between px-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-subtext">
                Your data
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void refresh();
                }}
                className="focus-ring rounded text-xs text-teal hover:underline disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <ul className="mt-1.5 space-y-1">
              <li className="flex items-center gap-2 px-0.5 text-xs">
                <span
                  aria-hidden="true"
                  className={keysDone ? "text-teal" : "text-subtext"}
                >
                  {keysDone ? "✓" : "✗"}
                </span>
                <span className={keysDone ? "text-white" : "text-subtext"}>
                  API keys added
                </span>
              </li>
              <li className="flex items-center gap-2 px-0.5 text-xs">
                <span
                  aria-hidden="true"
                  className={knowledgeDone ? "text-teal" : "text-subtext"}
                >
                  {knowledgeDone ? "✓" : "✗"}
                </span>
                <span className={knowledgeDone ? "text-white" : "text-subtext"}>
                  Knowledge files added ({knowledgeCount ?? 0})
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-3 border-t border-hairline pt-2">
            <p className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-subtext">
              Content &amp; brand
            </p>
            <button
              type="button"
              role="menuitem"
              disabled={busy || loadingSection !== null}
              onClick={() => {
                setOpen(false);
                void openDomainEditor();
              }}
              className="focus-ring mt-1 flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10 disabled:opacity-50"
            >
              Brand, pillars, platforms &amp; voice
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy || loadingSection !== null}
              onClick={() => {
                setOpen(false);
                void openPromptsEditor();
              }}
              className="focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10 disabled:opacity-50"
            >
              Agent prompts
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy || loadingSection !== null}
              onClick={() => {
                setOpen(false);
                void openPlanEditor();
              }}
              className="focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10 disabled:opacity-50"
            >
              Weekly plan
            </button>
          </div>

          {isDrive && (
            <div className="mt-3 border-t border-hairline pt-2">
              {!editingKeys ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy || keysBusy}
                  onClick={() => void openKeyEditor()}
                  className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10 disabled:opacity-50"
                >
                  {keysBusy ? "Loading…" : "Edit API keys"}
                </button>
              ) : (
                <div className="px-0.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-subtext">
                    credentials.env
                  </p>
                  <textarea
                    value={keysText}
                    onChange={(e) => setKeysText(e.target.value)}
                    spellCheck={false}
                    rows={8}
                    className="mt-1 block w-full rounded-md border border-hairline bg-ink-700/50 p-2 font-mono text-[11px] text-white focus-ring"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={keysBusy}
                      onClick={() => void saveKeys()}
                      className="focus-ring flex-1 rounded-md border border-teal/40 bg-teal/10 px-2.5 py-1.5 text-xs font-semibold text-teal hover:bg-teal/20 disabled:opacity-50"
                    >
                      {keysBusy ? "Saving…" : "Save keys"}
                    </button>
                    <button
                      type="button"
                      disabled={keysBusy}
                      onClick={() => setEditingKeys(false)}
                      className="focus-ring rounded-md border border-hairline px-2.5 py-1.5 text-xs text-subtext hover:text-white disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {keysError && (
                <p role="alert" className="mt-2 px-0.5 text-xs text-status-error">
                  {keysError}
                </p>
              )}

              {/* Local → Drive import. Files added via the Drive web UI are
                  invisible to the app (drive.file scope), so importing through
                  the app is how content gets into Drive. */}
              {isImportSupported() && (
                <div className="mt-1">
                  {importProgress ? (
                    <div className="px-2.5 py-2">
                      <p className="text-xs text-white">
                        Importing… {importProgress.done}/{importProgress.total}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-subtext">
                        {importProgress.current}
                      </p>
                    </div>
                  ) : !confirmImport ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy || keysBusy}
                      onClick={() => {
                        setImportResult(null);
                        setImportError(null);
                        setConfirmImport(true);
                      }}
                      className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10 disabled:opacity-50"
                    >
                      Import from local folder
                    </button>
                  ) : (
                    <div className="rounded-md border border-hairline bg-ink-700/50 p-2.5">
                      <p className="text-xs text-subtext">
                        Pick your local folder (e.g.{" "}
                        <span className="font-mono text-white">social-media-config</span>).
                        Its files are copied into Drive, <strong>overwriting</strong>{" "}
                        same-named files there. Extraction caches are skipped.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void runImport()}
                          className="focus-ring flex-1 rounded-md border border-teal/40 bg-teal/10 px-2.5 py-1.5 text-xs font-semibold text-teal hover:bg-teal/20"
                        >
                          Choose folder &amp; import
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmImport(false)}
                          className="focus-ring rounded-md border border-hairline px-2.5 py-1.5 text-xs text-subtext hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {importResult && (
                    <p className="mt-1 px-2.5 text-xs text-subtext">
                      Imported <span className="text-white">{importResult.copied}</span>{" "}
                      files from{" "}
                      <span className="font-mono text-white">{importResult.sourceName}</span>
                      {importResult.skipped > 0 && ` · ${importResult.skipped} skipped`}
                      {importResult.failed > 0 && (
                        <span className="text-status-error">
                          {" "}
                          · {importResult.failed} failed
                        </span>
                      )}
                    </p>
                  )}

                  {importError && (
                    <p role="alert" className="mt-1 px-2.5 text-xs text-status-error">
                      {importError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {driveSetupOpen &&
        // Portaled to document.body — this menu (and its dropdown) is mounted
        // inside FolderApp's <header>, which has backdrop-blur-xl and so
        // establishes a CSS containing block for `position: fixed` — without
        // the portal this modal gets trapped inside the header's own box
        // instead of covering the viewport. See ContentDomainEditor.tsx.
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
            onClick={() => setDriveSetupOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Google Drive setup"
              onClick={(e) => e.stopPropagation()}
              className="my-auto w-full max-w-md rounded-2xl border border-hairline bg-ink-800 p-5 shadow-xl"
            >
              <DriveSetup
                onDone={() => setDriveSetupOpen(false)}
                onCancel={() => setDriveSetupOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )}

      {editingDomain && domainDraft && (
        <ContentDomainEditor
          domain={domainDraft}
          deepseekApiKey={credentials?.deepseekApiKey}
          onSave={async (next) => {
            if (!provider) return;
            await provider.writeText(CONTENT_DOMAIN_FILENAME, JSON.stringify(next, null, 2));
          }}
          onClose={() => setEditingDomain(false)}
        />
      )}
      {editingPrompts && promptsDraft && (
        <AgentPromptsEditor
          prompts={promptsDraft}
          onSave={async (next) => {
            if (!provider) return;
            await provider.writeText(PROMPTS_FILENAME, JSON.stringify(next, null, 2));
          }}
          onClose={() => setEditingPrompts(false)}
        />
      )}
      {editingPlan && planDraft && (
        <WeeklyPlanEditor
          plan={planDraft}
          pillars={domainDraft?.pillars ?? []}
          onSave={async (next) => {
            if (!provider) return;
            await provider.writeText(WEEKLY_PLAN_FILENAME, JSON.stringify(next, null, 2));
          }}
          onClose={() => setEditingPlan(false)}
        />
      )}
    </div>
  );
}
