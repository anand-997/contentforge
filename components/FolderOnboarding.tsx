"use client";

// components/FolderOnboarding.tsx
// First-run screen for the deployed "bring your own folder" mode. Explains the
// two files ContentForge keeps in the chosen folder, then lets the user pick a
// folder (Chrome/Edge) or fall back to upload/download (any browser/device).

import { useCallback, useEffect, useRef, useState } from "react";
import { useStorage } from "./StorageContext";
import { DriveSetup } from "./DriveSetup";
import { listRecentFolders } from "@/lib/client/storage";
import { isGoogleAuthError, listRecentDrives, preloadGis } from "@/lib/client/driveAuth";
import type { RecentFolder } from "@/lib/client/contract";

export function FolderOnboarding(): JSX.Element {
  const {
    chooseFolder,
    reconnect,
    chooseDrive,
    reconnectDrive,
    useUpload,
    busy,
    error,
    driveNeedsConsent,
    folderApiSupported,
    driveConfigured,
  } = useStorage();
  const [recent, setRecent] = useState<RecentFolder[]>([]);
  const [recentDrives, setRecentDrives] = useState<RecentFolder[]>([]);
  const [showDriveSetup, setShowDriveSetup] = useState(false);

  useEffect(() => {
    if (!folderApiSupported) return;
    void listRecentFolders().then(setRecent).catch(() => setRecent([]));
  }, [folderApiSupported]);

  useEffect(() => {
    if (!driveConfigured) return;
    void listRecentDrives().then(setRecentDrives).catch(() => setRecentDrives([]));
    // Warm the Google Identity Services script now, so the "Continue with
    // Drive" tap can call requestAccessToken() synchronously instead of
    // waiting on a fresh script fetch — the latter breaks the user-gesture
    // chain popups need on mobile Safari/Chrome.
    preloadGis();
  }, [driveConfigured]);

  // The most recently used Drive folder powers the "Continue with Drive" option.
  const lastDrive = recentDrives[0] ?? null;
  const otherDrives = recentDrives.slice(1);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-teal/40 bg-teal/10 font-mono text-base font-bold text-teal">
            QA
          </span>
          <div>
            <h1 className="text-lg font-bold text-white">ContentForge</h1>
            <p className="text-xs text-subtext">Your content. Your folder. Your keys.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-hairline bg-ink-800 p-6 shadow-xl">
          <h2 className="text-xl font-bold tracking-tight text-white">
            Choose a folder to work in
          </h2>
          <p className="mt-1.5 text-sm text-subtext">
            ContentForge keeps everything in a folder you pick on this device.
            Nothing is stored on our servers.
          </p>

          {/* Trust strip: what's stored here, in plain terms — not how to edit
              it. Editing now happens in Settings once a folder is connected. */}
          <ul className="mt-5 space-y-3">
            <FileRow
              icon="🔑"
              name="Your keys"
              desc="credentials.env holds your own API keys. Stays on this device — edit them anytime from Settings."
            />
            <FileRow
              icon="📅"
              name="Your content"
              desc="Posts, history, and generated images — written to content_calendar.xlsx and browsable right in the dashboard."
            />
            <FileRow
              icon="📁"
              name="Your notes"
              desc="Drop .pdf / .docx / .png source material into the knowledge/ folder to ground the day's content."
            />
          </ul>
          <p className="mt-3 px-0.5 text-xs text-subtext">
            Once you&apos;re connected, brand, voice, pillars, weekly plan, and model
            settings are all set up from <span className="text-white">Settings</span> —
            no file editing required.
          </p>

          {folderApiSupported ? (
            <>
              <button
                type="button"
                onClick={() => void chooseFolder()}
                disabled={busy}
                className="focus-ring mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-teal/50 bg-teal/15 px-4 py-3 text-sm font-semibold text-teal transition-colors hover:bg-teal/25 disabled:opacity-50"
              >
                {busy ? "Opening…" : "Choose folder"}
              </button>

              {recent.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-subtext">
                    Recent folders
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {recent.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => void reconnect(f.id)}
                        disabled={busy}
                        className="focus-ring flex w-full items-center justify-between rounded-lg border border-hairline bg-ink-700/40 px-3 py-2 text-left text-sm text-white transition-colors hover:border-teal/40 disabled:opacity-50"
                      >
                        <span className="truncate font-mono text-xs">{f.name}</span>
                        <span className="text-xs text-subtext">Reconnect</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <UploadFallback onUse={useUpload} busy={busy} />
          )}

          <div className="mt-5 border-t border-hairline pt-5">
            <p className="text-xs text-subtext">
              Want to reach your content from any device? We&apos;ll create (or reuse)
              a <span className="font-mono text-white">ContentForge</span> folder in
              your Google Drive with the same files and folders as above, and work
              from there.
            </p>

            {showDriveSetup ? (
              <div className="mt-4 rounded-xl border border-hairline bg-ink-700/30 p-4">
                <DriveSetup
                  onDone={() => setShowDriveSetup(false)}
                  onCancel={() => setShowDriveSetup(false)}
                />
              </div>
            ) : !driveConfigured ? (
              // No Google credentials yet — offer setup rather than a dead button.
              <button
                type="button"
                onClick={() => setShowDriveSetup(true)}
                className="focus-ring mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-ink-700/40 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-teal/40"
              >
                Set up Google Drive
              </button>
            ) : (
              <>
                {lastDrive && (
                  <button
                    type="button"
                    onClick={() => void reconnectDrive(lastDrive.id)}
                    disabled={busy}
                    className="focus-ring mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-teal/50 bg-teal/15 px-4 py-3 text-sm font-semibold text-teal transition-colors hover:bg-teal/25 disabled:opacity-50"
                  >
                    {busy ? "Opening…" : `Continue with Drive · ${lastDrive.name}`}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void chooseDrive()}
                  disabled={busy}
                  className="focus-ring mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-ink-700/40 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-teal/40 disabled:opacity-50"
                >
                  {busy ? "Opening…" : "Connect Google Drive"}
                </button>

                {otherDrives.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-subtext">
                      Other Drive folders
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {otherDrives.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => void reconnectDrive(f.id)}
                          disabled={busy}
                          className="focus-ring flex w-full items-center justify-between rounded-lg border border-hairline bg-ink-700/40 px-3 py-2 text-left text-sm text-white transition-colors hover:border-teal/40 disabled:opacity-50"
                        >
                          <span className="truncate font-mono text-xs">{f.name}</span>
                          <span className="text-xs text-subtext">Reconnect</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowDriveSetup(true)}
                  className="focus-ring mt-3 text-xs text-subtext underline hover:text-white"
                >
                  Change Google credentials
                </button>
              </>
            )}
          </div>

          {error && (
            <div className="mt-4">
              <p role="alert" className="text-sm text-status-error">
                {error}
              </p>
              {driveNeedsConsent && (
                <button
                  type="button"
                  onClick={() => void chooseDrive()}
                  disabled={busy}
                  className="focus-ring mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-status-imaging/60 bg-status-imaging/15 px-4 py-3 text-sm font-semibold text-status-imaging transition-colors hover:bg-status-imaging/25 disabled:opacity-50"
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
                  onClick={() => setShowDriveSetup(true)}
                  disabled={busy}
                  className="focus-ring mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-status-imaging/60 bg-status-imaging/15 px-4 py-3 text-sm font-semibold text-status-imaging transition-colors hover:bg-status-imaging/25 disabled:opacity-50"
                >
                  Check Google Drive setup
                </button>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-subtext">
          Folder selection needs Chrome or Edge on desktop. Other browsers use the
          upload/download fallback automatically. Google Drive works on any browser
          and device.
        </p>
      </div>
    </div>
  );
}

function FileRow({
  icon,
  name,
  desc,
}: {
  icon: string;
  name: string;
  desc: string;
}): JSX.Element {
  return (
    <li className="flex gap-3 rounded-xl border border-hairline bg-ink-700/30 p-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-teal/30 bg-teal/10 text-teal">
        <span aria-hidden="true" className="text-xs">{icon}</span>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{name}</p>
        <p className="mt-0.5 text-xs text-subtext">{desc}</p>
      </div>
    </li>
  );
}

function UploadFallback({
  onUse,
  busy,
}: {
  onUse: (workbook?: ArrayBuffer, credsText?: string) => Promise<void>;
  busy: boolean;
}): JSX.Element {
  const wbRef = useRef<HTMLInputElement>(null);
  const credRef = useRef<HTMLInputElement>(null);

  const start = useCallback(async () => {
    const wbFile = wbRef.current?.files?.[0];
    const credFile = credRef.current?.files?.[0];
    const workbook = wbFile ? await wbFile.arrayBuffer() : undefined;
    const credsText = credFile ? await credFile.text() : undefined;
    await onUse(workbook, credsText);
  }, [onUse]);

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg border border-status-imaging/30 bg-status-imaging/10 p-3 text-xs text-subtext">
        This browser can&apos;t open folders directly, so upload your files to start
        and download the updated ones when you&apos;re done. Works on any device.
      </div>
      <label className="block text-sm text-white">
        Existing content_calendar.xlsx (optional)
        <input
          ref={wbRef}
          type="file"
          accept=".xlsx"
          className="mt-1 block w-full text-xs text-subtext file:mr-3 file:rounded-md file:border file:border-hairline file:bg-ink-700 file:px-3 file:py-1.5 file:text-white"
        />
      </label>
      <label className="block text-sm text-white">
        Existing credentials.env (optional)
        <input
          ref={credRef}
          type="file"
          accept=".env,.txt"
          className="mt-1 block w-full text-xs text-subtext file:mr-3 file:rounded-md file:border file:border-hairline file:bg-ink-700 file:px-3 file:py-1.5 file:text-white"
        />
      </label>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="focus-ring flex w-full items-center justify-center rounded-xl border border-teal/50 bg-teal/15 px-4 py-3 text-sm font-semibold text-teal transition-colors hover:bg-teal/25 disabled:opacity-50"
      >
        {busy ? "Loading…" : "Start (upload or fresh)"}
      </button>
    </div>
  );
}
