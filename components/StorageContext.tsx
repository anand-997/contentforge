"use client";

// components/StorageContext.tsx
// Client-side state for "bring your own folder" mode. Holds the active storage
// provider (a folder handle or the upload/download fallback), the in-memory
// workbook bytes, parsed credentials + info, and the actions the dashboard UI
// calls. All filesystem access goes through the provider — this context never
// touches `window` outside effects/handlers, and the server is only reached via
// the stateless POST /api/generate route.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Credentials,
  GenerateResponse,
  StorageInfo,
  StorageProvider,
} from "@/lib/client/contract";
import {
  UploadDownloadStorage,
  isFolderApiSupported,
  pickFolder,
  reconnectFolder,
} from "@/lib/client/storage";
import {
  DriveScopeError,
  connectDrive,
  isDriveConfigured,
  isDrivePickerConfigured,
  pickDriveFolder,
  reconnectDrive,
  resetDriveAuth,
} from "@/lib/client/driveAuth";
import {
  clearDriveCredentials,
  driveCredentialsSource,
  readDriveCredentials,
  saveDriveCredentials,
} from "@/lib/client/driveCredentials";
import type { DriveCredentialsSource } from "@/lib/client/driveCredentials";
import type {
  ContentRow,
  GenerationLogEntry,
  WeekdayPlan,
} from "@/lib/types";
import { parseWorkbook, todayString, imageBasename } from "@/lib/client/parseWorkbook";
import { applyRowUpdates, deleteRowFromWorkbook } from "@/lib/client/writeWorkbook";
import { firstLine, lastLine } from "@/lib/similarity";
import { parseImagePaths } from "@/lib/imagePaths";
import {
  CONTENT_DOMAIN_FILENAME,
  CONFIG_FILENAME,
  PROMPTS_FILENAME,
} from "@/lib/client/storageNames";
import {
  serializePublishStatus,
  PLATFORM_PUBLISH_FIELD,
  type Platform,
  type PublishState,
} from "@/lib/publishStatus";
import { useGlobalLoading } from "./LoadingProvider";

export interface StorageContextValue {
  // ---- State -----------------------------------------------------
  provider: StorageProvider | null;
  workbook: ArrayBuffer | null;
  credentials: Credentials | null;
  info: StorageInfo | null;
  /** True while a folder/upload action or a generate run is in flight. */
  busy: boolean;
  /** Last user-facing error, or null. */
  error: string | null;
  /**
   * True when the last Drive connect/reconnect attempt got a token but not full
   * Drive access. The UI should offer a "Grant Drive access" retry — a fresh
   * tap, which is required for the follow-up consent popup to work on Safari.
   */
  driveNeedsConsent: boolean;
  /** Last informational note (e.g. the generate response `note`), or null. */
  note: string | null;
  /** True while POST /api/generate is running. */
  generating: boolean;
  /** Human-readable "what's happening right now" while generating (e.g. "Agent
   *  2 → LinkedIn written (187 words)"), or null when not generating. Each
   *  /api/generate call now does one pipeline step, so this updates between
   *  calls instead of sitting on one fixed message for the whole run. */
  generateProgressLabel: string | null;
  /** Rough 0-100 progress through the current generate run, for a progress bar. */
  generateProgressPct: number;
  folderApiSupported: boolean;
  /** True once a Google OAuth Client ID is available (user-saved or deployment default). */
  driveConfigured: boolean;
  /** True when a Picker API key is also available (needed only to pick a custom folder). */
  drivePickerConfigured: boolean;
  /** Where the active Google credentials came from. */
  driveCredsSource: DriveCredentialsSource;
  /** The Google credentials currently in effect, for pre-filling the setup form. */
  driveCreds: { clientId: string; apiKey: string };
  /** Number of files in the folder's knowledge/ dir; null until hydrated. */
  knowledgeCount: number | null;

  // ---- Actions ---------------------------------------------------
  chooseFolder: () => Promise<void>;
  switchFolder: () => Promise<void>;
  reconnect: (id: string) => Promise<void>;
  /** Connect Google Drive: find-or-create ContentForge at My Drive root. */
  chooseDrive: () => Promise<void>;
  /** Choose a specific Drive folder with the Google Picker instead. */
  chooseDriveFolder: () => Promise<void>;
  /** Reconnect to a previously used Drive folder by its id. */
  reconnectDrive: (id: string) => Promise<void>;
  /** Save this browser's Google credentials and re-arm the Drive auth client. */
  saveDriveCreds: (clientId: string, apiKey: string) => void;
  /** Forget this browser's Google credentials (falls back to any deployment default). */
  clearDriveCreds: () => void;
  useUpload: (workbook?: ArrayBuffer, credsText?: string) => Promise<void>;
  refresh: () => Promise<void>;
  generateToday: () => Promise<void>;
  /** Apply a single row's edits to the workbook and persist it to the folder. */
  saveRow: (date: string, updates: Partial<ContentRow>) => Promise<void>;
  /** Delete a day's row + images, then regenerate fresh content for that date. */
  regenerate: (date: string) => Promise<void>;
  /** Push a platform's content to that platform. Returns the resulting URL + state. */
  publishDraft: (
    date: string,
    platform: Platform,
  ) => Promise<{ url: string; note?: string; state: PublishState }>;
}

const StorageContext = createContext<StorageContextValue | null>(null);

export function useStorage(): StorageContextValue {
  const ctx = useContext(StorageContext);
  if (!ctx) {
    throw new Error("useStorage must be used within a StorageProvider");
  }
  return ctx;
}

/** Decodes an ArrayBuffer to a base64 string without spreading huge arrays. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000; // 32 KB per pass — avoids call-stack limits on apply.
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Decodes a base64 string back into an ArrayBuffer. */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buffer;
}

/** SHA-256 of the given bytes as a lowercase hex string. */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Today's weekday key, e.g. "thu". */
function todayWeekdayKey(): string {
  return WEEKDAY_KEYS[new Date().getDay()];
}

const MATERIAL_CHAR_CAP = 8000;
// Max NEW (uncached) knowledge files extracted per run — bounds serverless time.
// Remaining files are picked up on the next run (cache fills incrementally).
const MAX_NEW_EXTRACT_PER_RUN = 15;
// Text-bearing notes are extracted before images so the budget favors them.
const TEXT_EXTS = ["md", "txt", "pdf", "docx", "pptx", "xlsx"];
function extractPriority(relPath: string): number {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTS.includes(ext) ? 0 : 1;
}

function messageFrom(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong. Please try again.";
}

const PLATFORM_IDS = ["linkedin", "medium", "instagram", "youtube", "devto"] as const;

/** How many platforms this domain has enabled — used only to shape the
 *  generate-progress bar, so a safe default (all 5) is fine if unreadable. */
function countEnabledPlatforms(domain: unknown): number {
  if (typeof domain !== "object" || domain === null) return PLATFORM_IDS.length;
  const enabled = (domain as { enabledPlatforms?: unknown }).enabledPlatforms;
  if (typeof enabled !== "object" || enabled === null) return PLATFORM_IDS.length;
  const record = enabled as Record<string, unknown>;
  return PLATFORM_IDS.filter((id) => record[id] !== false).length;
}

export function StorageProviderRoot({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { run: runLoading } = useGlobalLoading();
  const [provider, setProvider] = useState<StorageProvider | null>(null);
  const [workbook, setWorkbook] = useState<ArrayBuffer | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateProgressLabel, setGenerateProgressLabel] = useState<string | null>(null);
  const [generateProgressPct, setGenerateProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [driveNeedsConsent, setDriveNeedsConsent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [folderApiSupported, setFolderApiSupported] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [drivePickerConfigured, setDrivePickerConfigured] = useState(false);
  const [driveCredsSource, setDriveCredsSource] =
    useState<DriveCredentialsSource>("none");
  const [driveCreds, setDriveCreds] = useState({ clientId: "", apiKey: "" });
  const [knowledgeCount, setKnowledgeCount] = useState<number | null>(null);

  // The provider is the single source of state; keep a ref so the
  // generate/refresh handlers always read the live instance.
  const providerRef = useRef<StorageProvider | null>(null);
  providerRef.current = provider;

  // Re-read the Google credential state (localStorage is browser-only, so this
  // must never run during render).
  const syncDriveCreds = useCallback((): void => {
    setDriveConfigured(isDriveConfigured());
    setDrivePickerConfigured(isDrivePickerConfigured());
    setDriveCredsSource(driveCredentialsSource());
    setDriveCreds(readDriveCredentials());
  }, []);

  useEffect(() => {
    // Browser-only capability check — runs after mount, never during render.
    setFolderApiSupported(isFolderApiSupported());
    syncDriveCreds();
  }, [syncDriveCreds]);

  const saveDriveCreds = useCallback(
    (clientId: string, apiKey: string): void => {
      saveDriveCredentials({ clientId, apiKey });
      // The GIS token client captures the client id at construction — drop it so
      // the next connect uses the new credentials.
      resetDriveAuth();
      syncDriveCreds();
    },
    [syncDriveCreds],
  );

  const clearDriveCreds = useCallback((): void => {
    clearDriveCredentials();
    resetDriveAuth();
    syncDriveCreds();
  }, [syncDriveCreds]);

  // Pull the latest workbook / credentials / info off a provider into state.
  // `knownWorkbook`, when passed, is used instead of re-reading the workbook
  // from the provider — for callers that just wrote these exact bytes
  // themselves (generateToday/saveRow/publishDraft), a read-immediately-after-
  // write has no consistency guarantee (especially for Google Drive: a
  // `files.list` + `alt=media` GET right after a `putFile` PATCH), so trusting
  // the bytes already in hand avoids a spurious "reverts to the old content"
  // flash. `undefined` (the default) means "no known bytes — read for real",
  // which is what a genuine first-connect/refresh needs.
  const hydrate = useCallback(
    async (p: StorageProvider, knownWorkbook?: ArrayBuffer | null): Promise<void> => {
      const [wb, info] = await Promise.all([
        knownWorkbook !== undefined ? Promise.resolve(knownWorkbook) : p.readWorkbook(),
        p.info(),
      ]);
      setWorkbook(wb);
      setInfo(info);
      if (info.hasCredentials) {
        try {
          setCredentials(await p.readCredentials());
        } catch {
          setCredentials(null);
        }
      } else {
        setCredentials(null);
      }
      try {
        setKnowledgeCount((await p.listKnowledge()).length);
      } catch {
        setKnowledgeCount(null);
      }
    },
    [],
  );

  // Adopt a provider: create any missing files, hydrate, THEN publish it to
  // context. FolderGate treats `provider !== null` as "ready to render the
  // full app" — hydrating first means workbook/info/credentials/knowledgeCount
  // are already the real values by the time that switch happens, so FolderApp
  // never renders a transient empty/fresh state that then flips to the real
  // content a moment later. Do not reorder this.
  const adopt = useCallback(
    async (p: StorageProvider): Promise<void> => {
      await p.ensureFiles();
      await hydrate(p);
      setProvider(p);
    },
    [hydrate],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const p = providerRef.current;
    if (!p) return;
    await runLoading(async () => {
      try {
        await hydrate(p);
      } catch (err) {
        setError(messageFrom(err));
      }
    });
  }, [hydrate, runLoading]);

  const chooseFolder = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await runLoading(async () => {
        const folder = await pickFolder();
        await adopt(folder);
      });
    } catch (err) {
      // AbortError = the user cancelled the picker; not a real error.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(messageFrom(err));
    } finally {
      setBusy(false);
    }
  }, [adopt, runLoading]);

  // Switching is the same flow as choosing — the picker replaces the active
  // folder and reloads that folder's data.
  const switchFolder = chooseFolder;

  const reconnect = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        await runLoading(async () => {
          const folder = await reconnectFolder(id);
          if (!folder) {
            setError(
              "Couldn't reconnect to that folder. Choose it again to grant access.",
            );
            return;
          }
          await adopt(folder);
        });
      } catch (err) {
        setError(messageFrom(err));
      } finally {
        setBusy(false);
      }
    },
    [adopt, runLoading],
  );

  // Every Drive entry point shares this: a DriveScopeError means we got a token
  // but not full access, which the UI should treat as "tap again to grant
  // access" rather than a generic failure — see driveAuth.ts's popup-discipline
  // notes on why that must be a fresh tap, not an automatic retry here.
  const handleDriveError = useCallback((err: unknown): void => {
    setDriveNeedsConsent(err instanceof DriveScopeError);
    setError(messageFrom(err));
  }, []);

  // Default Drive path: find-or-create ContentForge at the root of My Drive.
  const chooseDrive = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNote(null);
    setDriveNeedsConsent(false);
    try {
      await runLoading(async () => {
        await adopt(await connectDrive());
      });
    } catch (err) {
      handleDriveError(err);
    } finally {
      setBusy(false);
    }
  }, [adopt, handleDriveError, runLoading]);

  // Secondary Drive path: choose a specific folder with the Google Picker.
  const chooseDriveFolder = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNote(null);
    setDriveNeedsConsent(false);
    try {
      await runLoading(async () => {
        const drive = await pickDriveFolder();
        // null = the user closed the picker without choosing.
        if (!drive) return;
        await adopt(drive);
      });
    } catch (err) {
      handleDriveError(err);
    } finally {
      setBusy(false);
    }
  }, [adopt, handleDriveError, runLoading]);

  const reconnectDriveById = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true);
      setError(null);
      setNote(null);
      setDriveNeedsConsent(false);
      try {
        await runLoading(async () => {
          const drive = await reconnectDrive(id);
          if (!drive) {
            setError(
              "Couldn't reconnect to that Drive folder. Connect Google Drive again.",
            );
            return;
          }
          await adopt(drive);
        });
      } catch (err) {
        handleDriveError(err);
      } finally {
        setBusy(false);
      }
    },
    [adopt, handleDriveError, runLoading],
  );

  const useUpload = useCallback(
    async (wb?: ArrayBuffer, credsText?: string): Promise<void> => {
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        await runLoading(async () => {
          const upload = new UploadDownloadStorage();
          upload.setUploaded(wb, credsText);
          await adopt(upload);
        });
      } catch (err) {
        setError(messageFrom(err));
      } finally {
        setBusy(false);
      }
    },
    [adopt, runLoading],
  );

  const generateToday = useCallback(
    async (targetDate?: string): Promise<void> => {
    const p = providerRef.current;
    if (!p) {
      setError("Choose a folder first, then generate.");
      return;
    }
    // Which day this run targets: a past date when regenerating, else today.
    const runDate = targetDate ?? todayString();
    const weekdayKey = targetDate
      ? WEEKDAY_KEYS[new Date(`${targetDate}T12:00:00`).getDay()]
      : todayWeekdayKey();
    setGenerating(true);
    setError(null);
    setNote(null);
    try {
      await runLoading(async () => {
      const [bytes, creds] = await Promise.all([
        p.readWorkbook(),
        p.readCredentials(),
      ]);
      const workbookBase64 = bytes ? arrayBufferToBase64(bytes) : "";

      // Resolve the target day's weekday plan from weekly-plan.json.
      const planText = await p.readText("weekly-plan.json");
      if (!planText) {
        throw new Error(
          "weekly-plan.json is missing. Reload your folder to recreate it.",
        );
      }
      const plans = JSON.parse(planText) as Record<string, WeekdayPlan>;
      const plan = plans[weekdayKey];
      if (!plan) {
        throw new Error(
          `No plan for ${weekdayKey} in weekly-plan.json. Add one and try again.`,
        );
      }

      // Expand the day's knowledge entries (each a file OR a folder, any depth)
      // into a concrete deduped file list. If no knowledgeFiles are configured for
      // the day, the knowledge folder is NOT touched at all — the agents generate
      // expert content purely from the day's keywords and tags (pre-knowledge
      // behavior), rather than grounding in the whole tree.
      const allFiles = await p.listKnowledge();
      const entries = plan.knowledgeFiles ?? [];
      const noKnowledgeConfigured = entries.length === 0;
      const matched = noKnowledgeConfigured
        ? []
        : Array.from(
            new Set(
              allFiles.filter((f) =>
                entries.some((e) => f === e || f.startsWith(`${e}/`)),
              ),
            ),
          );
      matched.sort((a, b) => extractPriority(a) - extractPriority(b));

      // Cache-first: read + hash each file; collect cached text, queue the rest.
      const textByPath = new Map<string, string>();
      const toExtract: { path: string; base64: string; key: string }[] = [];
      for (const relPath of matched) {
        const fileBytes = await p.readKnowledgeBytes(relPath);
        if (!fileBytes) continue;
        const key = await sha256Hex(fileBytes);
        const cached = await p.cacheGet(key);
        if (cached !== null) {
          textByPath.set(relPath, cached);
        } else {
          toExtract.push({ path: relPath, base64: arrayBufferToBase64(fileBytes), key });
        }
      }

      // Batch-extract up to the per-run cap; defer the rest to the next run.
      let extractNote = "";
      const batch = toExtract.slice(0, MAX_NEW_EXTRACT_PER_RUN);
      if (batch.length > 0) {
        try {
          const extractRes = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: batch.map((b) => ({ name: b.path, base64: b.base64 })),
              creds: { openaiApiKey: creds.openaiApiKey },
            }),
          });
          if (extractRes.ok) {
            const extractData = (await extractRes.json()) as {
              results: { name: string; text: string }[];
            };
            for (let i = 0; i < batch.length; i += 1) {
              const text = extractData.results[i]?.text ?? "";
              await p.cachePut(batch[i].key, text);
              textByPath.set(batch[i].path, text);
            }
          }
        } catch {
          /* extraction failure is non-fatal — proceed with whatever we have */
        }
      }
      if (toExtract.length > batch.length) {
        extractNote = `Processed ${batch.length} of ${toExtract.length} new knowledge files — run again to add the rest.`;
      }

      // Assemble grounding material in matched order, giving each file a fair
      // share so many files all contribute, total capped.
      const usableTexts = matched
        .map((relPath) => textByPath.get(relPath) ?? "")
        .filter((t) => t.trim().length > 0);
      const perFile =
        usableTexts.length > 0
          ? Math.max(400, Math.floor(MATERIAL_CHAR_CAP / usableTexts.length))
          : MATERIAL_CHAR_CAP;
      const material = usableTexts
        .map((t) => t.slice(0, perFile))
        .join("\n\n---\n\n")
        .slice(0, MATERIAL_CHAR_CAP);
      if (noKnowledgeConfigured) {
        extractNote = `No knowledge files set for ${todayWeekdayKey()} — generated from the day's keywords and tags.`;
      }

      // Full generation log, plus the last-10 slice sent to the server.
      const logText = await p.readText("generation-log.json");
      let fullLog: GenerationLogEntry[] = [];
      if (logText) {
        try {
          const parsed = JSON.parse(logText) as GenerationLogEntry[];
          if (Array.isArray(parsed)) fullLog = parsed;
        } catch {
          fullLog = [];
        }
      }
      const history = fullLog.slice(-10);

      const { voice, ...theme } = plan;

      // This visitor's own creative identity + run settings + prompts — read
      // fresh from their folder/Drive each run (never from the server) so
      // multiple visitors never share a brand, pillar set, or model config.
      // A missing/corrupt file is passed through as undefined; the server
      // validators fall back to brand-neutral defaults rather than throwing.
      const readJson = async (filename: string): Promise<unknown> => {
        const text = await p.readText(filename);
        if (!text) return undefined;
        try {
          return JSON.parse(text);
        } catch {
          return undefined;
        }
      };
      const [domain, config, agentPrompts] = await Promise.all([
        readJson(CONTENT_DOMAIN_FILENAME),
        readJson(CONFIG_FILENAME),
        readJson(PROMPTS_FILENAME),
      ]);

      // /api/generate now runs exactly ONE pipeline step per call (topic, OR
      // one platform, OR images) so no single request risks a serverless
      // timeout or leaves the UI frozen on one spinner for minutes — see
      // app/api/generate/route.ts. Loop calls here, feeding each response's
      // workbook back in, until the row reports "Done" (or an error/platform
      // failure that needs a manual retry).
      const totalPlatforms = countEnabledPlatforms(domain);
      const totalStepsEstimate = totalPlatforms + 2; // topic + platforms + images
      // Generous headroom: a platform can fail and be retried a couple of
      // times before this gives up and surfaces an error instead of looping
      // forever against a broken API key.
      const maxGenerateCalls = totalPlatforms * 3 + 4;

      let currentWorkbookBase64 = workbookBase64;
      let nextWorkbook: ArrayBuffer | null = null;
      let data: GenerateResponse | null = null;
      setGenerateProgressLabel("Starting…");
      setGenerateProgressPct(5);

      for (let stepIndex = 0; stepIndex < maxGenerateCalls; stepIndex += 1) {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creds,
            workbookBase64: currentWorkbookBase64,
            theme,
            voice,
            material,
            history,
            domain,
            config,
            agentPrompts,
            // Always send the BROWSER's local date so the server agrees on "today".
            // On Vercel the server clock is UTC; without this the row is created
            // under the UTC date and the local-date UI shows "No content for today".
            date: runDate,
          }),
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string; note?: string };
            detail = body.error ?? body.note ?? detail;
          } catch {
            /* non-JSON error body — keep the status code */
          }
          throw new Error(detail);
        }
        data = (await res.json()) as GenerateResponse;
        if (data.workbookBase64) {
          currentWorkbookBase64 = data.workbookBase64;
          nextWorkbook = base64ToArrayBuffer(data.workbookBase64);
          // Persist after every step (not just at the end) so progress already
          // made survives a closed tab or a later failed step.
          await p.writeWorkbook(nextWorkbook);
        }
        for (const image of data.images) {
          await p.writeImage(image.name, image.base64);
        }

        const lastLogLine = (data.agentLog ?? "")
          .trim()
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .pop();
        setGenerateProgressLabel(lastLogLine || data.note || "Generating…");
        setGenerateProgressPct(
          Math.min(95, Math.round(((stepIndex + 1) / totalStepsEstimate) * 100)),
        );

        if (data.status === "Done" || data.status === "Error") break;
        // A platform failed this step — don't keep auto-retrying indefinitely;
        // surface it and let the user tap Generate again.
        if (data.note && /platform\(s\) failed/.test(data.note)) break;
      }
      if (!data) {
        throw new Error("Generation didn't return a result.");
      }
      if (data.status === "Done") setGenerateProgressPct(100);

      // Append today's row to generation-log.json so future runs don't repeat it.
      if (nextWorkbook) {
        try {
          const rows = await parseWorkbook(nextWorkbook);
          const todayRow = rows.find((r) => r.date === runDate);
          if (todayRow) {
            // Replace any prior log entry for this date (regeneration) so the
            // history isn't double-counted, then append the fresh one.
            const priorLog = fullLog.filter((e) => e.date !== runDate);
            const entry: GenerationLogEntry = {
              date: runDate,
              topic: todayRow.topic,
              pillar: todayRow.pillar,
              structure: todayRow.postStructure,
              hookArchetype: "",
              hook: firstLine(todayRow.linkedin),
              closer: lastLine(todayRow.linkedin),
            };
            const updatedLog = [...priorLog, entry];
            await p.writeText(
              "generation-log.json",
              JSON.stringify(updatedLog, null, 2),
            );
          }
        } catch {
          /* logging is best-effort — don't fail the run over it */
        }
      }

      setNote(
        [extractNote, data.note]
          .filter((s) => s && s.trim().length > 0)
          .join(" "),
      );
      if (data.errorMessage) setError(data.errorMessage);
      // Pass the bytes we just wrote directly — avoids a read-immediately-
      // after-write re-fetch (see hydrate's doc comment).
      await hydrate(p, nextWorkbook ?? undefined);
      });
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setGenerating(false);
      setGenerateProgressLabel(null);
      setGenerateProgressPct(0);
    }
  }, [hydrate, runLoading]);

  // Delete a day's row + its images from the folder, then regenerate fresh
  // content for that date (today or any past day). The generation-log entry for
  // the date is replaced inside generateToday so history isn't double-counted.
  const regenerate = useCallback(
    async (date: string): Promise<void> => {
      const p = providerRef.current;
      if (!p) {
        setError("Choose a folder first, then regenerate.");
        return;
      }
      setGenerating(true);
      setError(null);
      setNote(null);
      try {
        await runLoading(async () => {
          const bytes = await p.readWorkbook();
          if (bytes) {
            const rows = await parseWorkbook(bytes);
            const row = rows.find((r) => r.date === date);
            if (row) {
              const refs = [
                row.imageMedium,
                row.imageLinkedin,
                ...parseImagePaths(row.imageInstagram),
              ]
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              const next = await deleteRowFromWorkbook(bytes, date);
              await p.writeWorkbook(next);
              for (const ref of refs) {
                await p.deleteImage(imageBasename(ref));
              }
            }
          }
        });
      } catch (err) {
        setError(messageFrom(err));
        setGenerating(false);
        return;
      }
      // generateToday manages the `generating` flag through completion (and
      // its own runLoading wrap — nesting is safe, see LoadingProvider).
      await generateToday(date);
    },
    [generateToday, runLoading],
  );

  // Persist a single calendar row's edits back into the workbook in the folder.
  // Mutates the workbook bytes in the browser (no server round-trip), then
  // re-hydrates so the parsed rows reflect the save.
  const saveRow = useCallback(
    async (date: string, updates: Partial<ContentRow>): Promise<void> => {
      const p = providerRef.current;
      if (!p) throw new Error("Choose a folder first, then save.");
      await runLoading(async () => {
        const bytes = await p.readWorkbook();
        if (!bytes) throw new Error("No workbook found to update.");
        const next = await applyRowUpdates(bytes, date, updates);
        await p.writeWorkbook(next);
        // Pass the bytes we just wrote directly — see hydrate's doc comment.
        await hydrate(p, next);
      });
    },
    [hydrate, runLoading],
  );

  // Publish a platform's content to that platform. Folder mode is stateless
  // server-side, so we send the content/key/image and write the resulting
  // publish status back into the workbook ourselves. Dev.to creates a draft
  // ("in-review"); Instagram posts live ("published"). The lifecycle state is
  // taken from the server response so each platform lands in the right column.
  const publishDraft = useCallback(
    async (
      date: string,
      platform: Platform,
    ): Promise<{ url: string; note?: string; state: PublishState }> => {
      const p = providerRef.current;
      if (!p) throw new Error("Choose a folder first, then publish.");
      return runLoading(async () => {
      const creds = await p.readCredentials();
      const bytes = await p.readWorkbook();
      if (!bytes) throw new Error("No workbook found.");
      const rows = await parseWorkbook(bytes);
      const row = rows.find((r) => r.date === date);
      if (!row) throw new Error(`No row for ${date}.`);

      // Resolve a stored image ref to its base64 bytes, or undefined if absent.
      const resolveImageBase64 = async (
        ref: string,
      ): Promise<string | undefined> => {
        const trimmed = ref.trim();
        if (!trimmed) return undefined;
        const objUrl = await p.imageObjectUrl(imageBasename(trimmed));
        if (!objUrl) return undefined;
        try {
          const buf = await (await fetch(objUrl)).arrayBuffer();
          return arrayBufferToBase64(buf);
        } finally {
          if (objUrl.startsWith("blob:")) URL.revokeObjectURL(objUrl);
        }
      };

      // Build the platform-specific request body.
      let requestBody: Record<string, unknown>;
      if (platform === "instagram") {
        if (!creds.instagramAccessToken.trim()) {
          throw new Error(
            "Add INSTAGRAM_ACCESS_TOKEN to credentials.env, then reload the folder.",
          );
        }
        // Send every carousel slide, in order — the server posts >1 as a
        // carousel. Slides that can't be resolved are dropped, not fatal.
        const igRefs = parseImagePaths(row.imageInstagram);
        const resolved = await Promise.all(igRefs.map(resolveImageBase64));
        const imageBase64List = resolved.filter(
          (b): b is string => typeof b === "string",
        );
        if (imageBase64List.length === 0) {
          throw new Error("No Instagram image found for this day to publish.");
        }
        requestBody = {
          date,
          platform,
          instagramAccessToken: creds.instagramAccessToken,
          instagramUserId: creds.instagramUserId,
          caption: row.instagram,
          imageBase64List,
        };
      } else if (platform === "linkedin") {
        if (!creds.linkedinAccessToken.trim()) {
          throw new Error(
            "Add LINKEDIN_ACCESS_TOKEN to credentials.env, then reload the folder.",
          );
        }
        requestBody = {
          date,
          platform,
          linkedinAccessToken: creds.linkedinAccessToken,
          linkedinUserId: creds.linkedinUserId,
          text: row.linkedin,
          hashtags: row.linkedinHashtags,
          imageBase64: await resolveImageBase64(row.imageLinkedin),
        };
      } else if (platform === "medium") {
        if (!creds.mediumToken.trim()) {
          throw new Error(
            "Add MEDIUM_INTEGRATION_TOKEN to credentials.env, then reload the folder.",
          );
        }
        requestBody = {
          date,
          platform,
          mediumToken: creds.mediumToken,
          title: row.mediumTitle || row.topic,
          markdown: row.medium,
          imageBase64: await resolveImageBase64(row.imageMedium),
        };
      } else {
        if (!creds.devtoApiKey.trim()) {
          throw new Error("Add DEVTO_API_KEY to credentials.env, then reload the folder.");
        }
        requestBody = {
          date,
          platform,
          devtoApiKey: creds.devtoApiKey,
          markdown: row.devto,
          imageBase64: await resolveImageBase64(row.imageMedium),
        };
      }

      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = (await res.json()) as {
        url?: string;
        note?: string;
        state?: PublishState;
        error?: string;
      };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Publishing failed.");
      const state: PublishState = data.state ?? "in-review";

      // Persist the publish status into the workbook (folder mode writes client-side).
      const field = PLATFORM_PUBLISH_FIELD[platform];
      const updates = {
        [field]: serializePublishStatus({
          state,
          url: data.url,
          at: new Date().toISOString(),
        }),
      } as Partial<ContentRow>;
      const next = await applyRowUpdates(bytes, date, updates);
      await p.writeWorkbook(next);
      // Pass the bytes we just wrote directly — see hydrate's doc comment.
      await hydrate(p, next);
      return { url: data.url, note: data.note, state };
      });
    },
    [hydrate, runLoading],
  );

  const value = useMemo<StorageContextValue>(
    () => ({
      provider,
      workbook,
      credentials,
      info,
      busy,
      error,
      driveNeedsConsent,
      note,
      generating,
      generateProgressLabel,
      generateProgressPct,
      folderApiSupported,
      driveConfigured,
      drivePickerConfigured,
      driveCredsSource,
      driveCreds,
      knowledgeCount,
      chooseFolder,
      switchFolder,
      reconnect,
      chooseDrive,
      chooseDriveFolder,
      reconnectDrive: reconnectDriveById,
      saveDriveCreds,
      clearDriveCreds,
      useUpload,
      refresh,
      generateToday,
      saveRow,
      regenerate,
      publishDraft,
    }),
    [
      provider,
      workbook,
      credentials,
      info,
      busy,
      error,
      driveNeedsConsent,
      note,
      generating,
      generateProgressLabel,
      generateProgressPct,
      folderApiSupported,
      driveConfigured,
      drivePickerConfigured,
      driveCredsSource,
      driveCreds,
      knowledgeCount,
      chooseFolder,
      switchFolder,
      reconnect,
      chooseDrive,
      chooseDriveFolder,
      reconnectDriveById,
      saveDriveCreds,
      clearDriveCreds,
      useUpload,
      refresh,
      generateToday,
      saveRow,
      regenerate,
      publishDraft,
    ],
  );

  return (
    <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
  );
}
