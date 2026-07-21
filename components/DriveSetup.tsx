"use client";

// components/DriveSetup.tsx
// Lets each user supply their own Google OAuth Client ID (and optionally a
// Picker API key) so they can use Google Drive without the deployment shipping
// shared credentials. Rendered inline on the onboarding screen when Drive isn't
// configured, and from Settings to change or remove saved credentials.
//
// The origin the user must allow-list is read from window.location.origin rather
// than hardcoded — it differs between localhost, previews and production, and
// getting it wrong is the most common setup failure ("origin mismatch").

import { useEffect, useState } from "react";
import { useStorage } from "./StorageContext";
import { sanitizeCredentialValue } from "@/lib/client/driveCredentials";

const CONSOLE_CREDENTIALS_URL = "https://console.cloud.google.com/apis/credentials";
const CONSOLE_LIBRARY_URL = "https://console.cloud.google.com/apis/library";

export function DriveSetup({
  onDone,
  onCancel,
}: {
  /** Called after credentials are saved or removed. */
  onDone?: () => void;
  /** Called when the user backs out without saving. */
  onCancel?: () => void;
}): JSX.Element {
  const { driveCreds, driveCredsSource, saveDriveCreds, clearDriveCreds } = useStorage();

  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sanitizedNotice, setSanitizedNotice] = useState(false);

  // Pre-fill from whatever is currently in effect.
  useEffect(() => {
    setClientId(driveCreds.clientId);
    setApiKey(driveCreds.apiKey);
  }, [driveCreds.clientId, driveCreds.apiKey]);

  // window is unavailable during SSR — read the origin after mount.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const looksWrong =
    clientId.trim() !== "" && !clientId.trim().endsWith(".apps.googleusercontent.com");

  const copyOrigin = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the address above and copy it manually.");
    }
  };

  const save = (): void => {
    setError(null);
    setSanitizedNotice(false);
    if (clientId.trim() === "") {
      setError("A Client ID is required.");
      return;
    }
    // A real Client ID never contains a space or invisible Unicode — either one
    // is unambiguous evidence of corrupted mobile copy-paste/typing, most often
    // seen on iOS. Detect it here (before it reaches Google as an invalid
    // client_id) so the user sees exactly what happened.
    const idResult = sanitizeCredentialValue(clientId, { stripInternalWhitespace: true });
    const keyResult = sanitizeCredentialValue(apiKey);
    const wasSanitized = idResult.changed || keyResult.changed;
    try {
      saveDriveCreds(clientId, apiKey);
      if (wasSanitized) {
        // Keep the form open so the user can see exactly what was removed and
        // review the corrected value below before continuing — closing
        // immediately would hide the very thing we're warning them about.
        setSanitizedNotice(true);
      } else {
        onDone?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your credentials.");
    }
  };

  const remove = (): void => {
    setError(null);
    clearDriveCreds();
    setClientId("");
    setApiKey("");
    onDone?.();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Connect your Google account</h3>
        <p className="mt-1 text-xs text-subtext">
          Google requires each person to use their own app credentials. This is a
          one-time setup, takes about 5 minutes, and stays in this browser.
        </p>
      </div>

      {/* The origin to allow-list — the #1 thing people get wrong. */}
      <div className="rounded-lg border border-teal/30 bg-teal/5 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-subtext">
          You&apos;ll need to authorize this exact address
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-ink-900/60 px-2 py-1 font-mono text-xs text-teal">
            {origin || "…"}
          </code>
          <button
            type="button"
            onClick={() => void copyOrigin()}
            className="focus-ring shrink-0 rounded-md border border-hairline px-2 py-1 text-xs text-white hover:border-teal/40"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <ol className="space-y-2 text-xs text-subtext">
        <Step n={1}>
          Open the{" "}
          <a
            href={CONSOLE_LIBRARY_URL}
            target="_blank"
            rel="noreferrer"
            className="text-teal underline"
          >
            Google Cloud console
          </a>{" "}
          and create a project (or pick one you already have).
        </Step>
        <Step n={2}>
          In <span className="text-white">APIs &amp; Services → Library</span>, enable{" "}
          <span className="text-white">Google Drive API</span>.
        </Step>
        <Step n={3}>
          In <span className="text-white">OAuth consent screen</span>, choose{" "}
          <span className="text-white">External</span>, fill in the app name and your
          email, add the scope{" "}
          <code className="font-mono text-white">.../auth/drive</code> (this lets the app
          use files you already keep in Drive — you may see an &quot;unverified app&quot;
          notice; that&apos;s your own app, click through it), then add your own Google
          address under <span className="text-white">Test users</span>.
        </Step>
        <Step n={4}>
          In{" "}
          <a
            href={CONSOLE_CREDENTIALS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-teal underline"
          >
            Credentials
          </a>{" "}
          → <span className="text-white">Create credentials → OAuth client ID</span> →
          type <span className="text-white">Web application</span>. Under{" "}
          <span className="text-white">Authorized JavaScript origins</span> add the
          address above. Copy the Client ID into the field below.
        </Step>
        <Step n={5}>
          <span className="text-white">Optional:</span> to be able to pick a Drive folder
          other than the default <code className="font-mono text-white">ContentForge</code>{" "}
          one, also enable <span className="text-white">Google Picker API</span> and create
          an <span className="text-white">API key</span> (restrict it to the Picker API).
        </Step>
      </ol>

      <div className="space-y-3">
        <label className="block text-xs text-white">
          Google OAuth Client ID <span className="text-status-error">*</span>
          <input
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setSanitizedNotice(false);
            }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="123456789-abc123.apps.googleusercontent.com"
            className="focus-ring mt-1 block w-full rounded-md border border-hairline bg-ink-700/50 px-2.5 py-2 font-mono text-xs text-white placeholder:text-subtext/60"
          />
        </label>
        {looksWrong && (
          <p className="text-xs text-status-imaging">
            That doesn&apos;t look like a Client ID — they normally end in{" "}
            <span className="font-mono">.apps.googleusercontent.com</span>. You can still
            save it.
          </p>
        )}

        <label className="block text-xs text-white">
          Picker API key <span className="text-subtext">(optional)</span>
          <input
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setSanitizedNotice(false);
            }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="AIza…"
            className="focus-ring mt-1 block w-full rounded-md border border-hairline bg-ink-700/50 px-2.5 py-2 font-mono text-xs text-white placeholder:text-subtext/60"
          />
          <span className="mt-1 block text-[11px] text-subtext">
            Only needed to choose a different Drive folder. Leave blank to use the
            default <span className="font-mono">ContentForge</span> folder.
          </span>
        </label>
      </div>

      {sanitizedNotice && (
        <div className="rounded-lg border border-status-imaging/40 bg-status-imaging/10 p-3">
          <p className="text-xs text-status-imaging">
            We removed unexpected spaces or hidden characters before saving — this is
            common when copy-pasting on a phone. Double-check the saved value below
            matches Google Cloud Console exactly, then continue.
          </p>
          <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-subtext">
            Currently saved Client ID
          </p>
          <p className="mt-1 break-all rounded bg-ink-900/60 px-2 py-1.5 font-mono text-xs text-white">
            {driveCreds.clientId || "(none)"}
          </p>
          <button
            type="button"
            onClick={() => {
              setSanitizedNotice(false);
              onDone?.();
            }}
            className="focus-ring mt-2 rounded-md border border-teal/40 bg-teal/10 px-3 py-1.5 text-xs font-semibold text-teal hover:bg-teal/20"
          >
            Looks right — continue
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          className="focus-ring flex-1 rounded-xl border border-teal/50 bg-teal/15 px-4 py-2.5 text-sm font-semibold text-teal transition-colors hover:bg-teal/25"
        >
          Save &amp; continue
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring rounded-xl border border-hairline px-4 py-2.5 text-sm text-subtext transition-colors hover:text-white"
          >
            Cancel
          </button>
        )}
      </div>

      {driveCredsSource !== "none" && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-subtext">
            Currently saved on this device — compare against Google Cloud Console
          </p>
          <p className="mt-1 break-all rounded bg-ink-900/60 px-2 py-1.5 font-mono text-xs text-subtext">
            {driveCreds.clientId || "(none)"}
          </p>
        </div>
      )}

      {driveCredsSource === "user" && (
        <button
          type="button"
          onClick={remove}
          className="focus-ring text-xs text-subtext underline hover:text-status-error"
        >
          Remove saved credentials from this browser
        </button>
      )}
      {driveCredsSource === "env" && (
        <p className="text-[11px] text-subtext">
          This site ships default Google credentials. Saving your own will override them
          in this browser.
        </p>
      )}

      <p className="text-[11px] text-subtext">
        Stored in this browser only, never sent to our servers. Both values are safe to
        expose in a browser — your OAuth client only works from the address you
        allow-listed above.
      </p>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }): JSX.Element {
  return (
    <li className="flex gap-2">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-hairline text-[10px] text-subtext">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
