// lib/client/driveCredentials.ts
// The user's own Google OAuth Client ID (+ optional Picker API key), kept in
// localStorage.
//
// Why the browser and not the user's folder: these credentials are what gets the
// app INTO Drive, so they must be readable before any StorageProvider exists.
//
// Both values are public by design — the Client ID ships in browser code for any
// client-side OAuth app, and the Picker key is restricted by API + HTTP referrer.
// Neither grants access on its own: the OAuth client only works from origins the
// user allow-lists. localStorage is therefore an appropriate home for them.
//
// Deployment-wide env vars still work as a fallback default, so deployments that
// already set NEXT_PUBLIC_GOOGLE_* keep working with no change.

const STORAGE_KEY = "contentforge.google";

export interface DriveCredentials {
  clientId: string;
  apiKey: string;
}

/** Where the credentials currently in effect came from. */
export type DriveCredentialsSource = "user" | "env" | "none";

const EMPTY: DriveCredentials = { clientId: "", apiKey: "" };

function envCredentials(): DriveCredentials {
  return {
    clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
    apiKey: process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "",
  };
}

/** Credentials the user saved in this browser, or null if none/unreadable. */
function storedCredentials(): DriveCredentials | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return null;
  }
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can throw in private mode / when blocked by policy.
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DriveCredentials>;
    const clientId = typeof parsed.clientId === "string" ? parsed.clientId.trim() : "";
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
    return clientId === "" && apiKey === "" ? null : { clientId, apiKey };
  } catch {
    return null;
  }
}

/**
 * The credentials in effect: what the user saved in this browser, else the
 * deployment's env vars, else empty.
 */
export function readDriveCredentials(): DriveCredentials {
  const stored = storedCredentials();
  if (stored && stored.clientId !== "") return stored;
  const env = envCredentials();
  if (env.clientId !== "") return env;
  // A stored API key with no client id is still worth surfacing back to the form.
  return stored ?? EMPTY;
}

export function driveCredentialsSource(): DriveCredentialsSource {
  const stored = storedCredentials();
  if (stored && stored.clientId !== "") return "user";
  if (envCredentials().clientId !== "") return "env";
  return "none";
}

/** True when this browser has its own saved credentials (vs the env default). */
export function hasUserDriveCredentials(): boolean {
  return storedCredentials() !== null;
}

// Zero-width / invisible Unicode that mobile copy-paste can silently carry
// along: zero-width space/non-joiner/joiner, left/right-to-left marks, word
// joiner, invisible math operators, BOM / zero-width no-break space, soft
// hyphen, non-breaking space. A Google Client ID or API key never
// legitimately contains any of these, so stripping them is always safe.
// Written with \u code-point escapes ONLY (plain ASCII in the source file) so
// the exact characters matched are verifiable by reading the hex values —
// never by trusting an invisible glyph survived being typed/transmitted
// correctly, which is the exact class of bug this function exists to fix.
const INVISIBLE_CHARS = /[​-‏⁠-⁤﻿­ ]/g;

/** Strip invisible Unicode and (for the Client ID) any internal whitespace — a
 *  real Client ID never contains spaces, so finding one is unambiguous evidence
 *  of corrupted mobile input, not a legitimate value. Returns the sanitized
 *  value plus whether anything was actually removed, so the caller can warn. */
export function sanitizeCredentialValue(
  value: string,
  { stripInternalWhitespace = false }: { stripInternalWhitespace?: boolean } = {},
): { value: string; changed: boolean } {
  const trimmed = value.trim();
  let next = trimmed.replace(INVISIBLE_CHARS, "");
  if (stripInternalWhitespace) {
    next = next.replace(/\s+/g, "");
  }
  return { value: next, changed: next !== trimmed };
}

export function saveDriveCredentials(creds: DriveCredentials): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  const clean: DriveCredentials = {
    clientId: sanitizeCredentialValue(creds.clientId, { stripInternalWhitespace: true }).value,
    apiKey: sanitizeCredentialValue(creds.apiKey).value,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    throw new Error(
      "Couldn't save to browser storage. Check that site data isn't blocked for this site.",
    );
  }
}

/** Forget this browser's credentials, falling back to the deployment default. */
export function clearDriveCredentials(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing we can do — treated as already cleared */
  }
}
