// lib/client/driveAuth.ts
// Browser-side Google Drive connection: loads Google Identity Services (GIS) and
// the Google Picker from Google's CDN, runs a client-side OAuth flow for the
// `drive.file` scope, lets the user pick a Drive folder, and hands back a
// DriveStorage bound to that folder. Recent Drive folders are remembered in
// IndexedDB so a returning user reconnects in one click (silent token refresh).
//
// No server secret is involved — the OAuth client id + Picker API key are public
// and protected by the authorized-origins allowlist, mirroring how folder mode
// keeps all secrets out of the server. Each user supplies their own from the
// in-app setup form; a deployment may set NEXT_PUBLIC_GOOGLE_* as a default.
//
// Popup discipline: acquireInteractive() opens at most one consent popup per
// call and never retries itself — see its doc comment. If the grant still
// isn't enough it throws DriveScopeError, and the caller (StorageContext) asks
// the UI to show a "Grant Drive access" button instead of auto-retrying, so any
// follow-up popup is always tied to a fresh user tap (required by Safari/iOS).

import type { RecentFolder } from "@/lib/client/contract";
import { DriveStorage } from "@/lib/client/driveStorage";
import { readDriveCredentials } from "@/lib/client/driveCredentials";

// Full Drive scope: the app can read and write every file in the user's Drive,
// including files added by desktop sync or the Drive web UI. This is what lets
// ContentForge use a folder the user populated outside the app (its whole point
// — the same folder, reachable from any device). `drive` is a *restricted*
// scope: fine for the developer + test users in Testing mode; a public verified
// launch would need Google's CASA assessment. To narrow back to least-privilege
// (app-created files only, no verification), set this to
// "https://www.googleapis.com/auth/drive.file" — but then files synced/uploaded
// outside the app are invisible and must come in via "Import from local folder".
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

/** The folder ContentForge creates at the root of My Drive to hold everything. */
export const APP_FOLDER_NAME = "ContentForge";

// Credentials come from the user's browser (or the deployment's env vars as a
// fallback) — see lib/client/driveCredentials.ts. Read at call time, never
// cached, so saving new credentials takes effect immediately.
function clientId(): string {
  return readDriveCredentials().clientId;
}

function apiKey(): string {
  return readDriveCredentials().apiKey;
}

/** The numeric Cloud project number, derived from the OAuth client id prefix. */
function appId(): string {
  return clientId().split("-")[0] ?? "";
}

/**
 * Drive needs only the OAuth Client ID: `connectDrive()` find-or-creates the
 * ContentForge folder through the Drive REST API and never opens the Picker.
 */
export function isDriveConfigured(): boolean {
  return clientId() !== "";
}

/** The Picker API key is only needed to choose a folder other than the default. */
export function isDrivePickerConfigured(): boolean {
  return clientId() !== "" && apiKey() !== "";
}

/**
 * Drop every cached auth artefact. MUST be called whenever the credentials
 * change: `initTokenClient()` captures the client id at construction, so without
 * this a changed Client ID would silently keep using the old one.
 */
export function resetDriveAuth(): void {
  tokenClient = null;
  accessToken = null;
  expiresAt = 0;
  pending = null;
  silentRefresh = null;
  grantedScope = "";
}

// ---- script loading -------------------------------------------------------

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Google Drive is only available in the browser"));
  }
  const existing = loaded.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = (): void => resolve();
    script.onerror = (): void => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
  loaded.set(src, promise);
  return promise;
}

async function ensurePicker(): Promise<void> {
  await loadScript(GAPI_SRC);
  await new Promise<void>((resolve) => {
    gapi.load("picker", () => resolve());
  });
}

/**
 * Start fetching the Google Identity Services script ahead of any click, so a
 * later `requestAccessToken()` call finds it already loaded and can run
 * synchronously inside the triggering tap's call stack. Without this, the
 * first tap in a session awaits a real network fetch before the popup call —
 * on iOS Safari/Chrome that gap is enough for the browser to no longer treat
 * the popup as a direct result of the user's gesture, and it gets blocked
 * (`popup_failed_to_open`). Desktop is more lenient about the gap, which is
 * why this only shows up on mobile. Safe to call multiple times/eagerly:
 * `loadScript()` memoizes by src. Fire-and-forget — a failed preload isn't
 * fatal, `ensureTokenClient()` still retries the load on the actual click.
 */
export function preloadGis(): void {
  if (typeof window === "undefined") return;
  void loadScript(GIS_SRC).catch(() => {
    /* ignore — ensureTokenClient() will retry when the user actually clicks */
  });
}

// ---- token client ---------------------------------------------------------

let tokenClient: GoogleTokenClient | null = null;
let accessToken: string | null = null;
let expiresAt = 0;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
let silentRefresh: Promise<string> | null = null;
// What Google actually granted, space-separated. A silent request can return a
// PREVIOUSLY granted, narrower scope (e.g. drive.file from before this app asked
// for full drive) — so the requested scope is not proof of what we hold.
let grantedScope = "";

/** True when Google granted the scope the app actually needs. */
function scopeSatisfied(): boolean {
  // Whole-entry match: a substring test would wrongly accept ".../drive.file"
  // as satisfying ".../drive".
  return grantedScope.split(/\s+/).includes(DRIVE_SCOPE);
}

/** True when the current grant covers all of the user's Drive, not just app files. */
export function hasFullDriveGrant(): boolean {
  return scopeSatisfied();
}

/**
 * Thrown when Google returned a token but it doesn't cover the full Drive
 * scope. Distinct from a hard failure (popup closed, network error, etc.) so
 * the UI can offer a dedicated "Grant Drive access" retry — a fresh tap, which
 * is the reliable way to get another consent popup through on Safari.
 */
export class DriveScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveScopeError";
  }
}

const LIMITED_GRANT_MESSAGE =
  "Google didn't grant full Drive access, so ContentForge can't see files you added " +
  'outside the app yet. Tap "Grant Drive access" and make sure to approve Drive access ' +
  "on Google's screen. If this keeps happening, add the scope " +
  "https://www.googleapis.com/auth/drive under APIs & Services → OAuth consent screen " +
  "→ Data access.";

// Every hard token-request failure (popup closed, popup blocked, the user
// declining, or Google rejecting the request outright) is prefixed with this
// so the UI can reliably tell "this error came from the Drive OAuth popup"
// apart from unrelated errors (local folder picker, generation, etc.) without
// new state to keep in sync — see isGoogleAuthError().
const GOOGLE_AUTH_ERROR_PREFIX = "Google sign-in error:";

/**
 * Google's raw error code/description, prefixed so it's always visible without
 * dev tools.
 *
 * IMPORTANT LIMITATION: when a Client ID doesn't match any real OAuth client,
 * Google shows its own hosted error page ("invalid_client") DIRECTLY INSIDE the
 * popup — that page's content is never delivered to this callback. GIS only
 * exposes generic popup lifecycle codes here (e.g. "popup_closed" once the user
 * closes that error page, "popup_failed_to_open" if it's blocked). So this
 * function cannot report "invalid_client" specifically — don't add matching
 * for it, it will never fire. Instead the message below always names the
 * Client ID as a likely cause, since that IS the most common reason a popup
 * fails outright without ever reaching a scope/consent decision.
 */
function googleErrorMessage(code: string, description?: string): string {
  const detail = description && description !== code ? `${description} (${code})` : code;
  return (
    `${GOOGLE_AUTH_ERROR_PREFIX} ${detail}. If this keeps happening, re-check your Client ID ` +
    "in Google Drive setup — a mistyped or corrupted value (common when pasting on a phone) " +
    "is the most common cause."
  );
}

/** True when an error string came from the Drive OAuth popup, so the UI can
 *  offer a way back into Google Drive setup without needing separate state. */
export function isGoogleAuthError(message: string | null): boolean {
  return message !== null && message.startsWith(GOOGLE_AUTH_ERROR_PREFIX);
}

async function ensureTokenClient(): Promise<GoogleTokenClient> {
  await loadScript(GIS_SRC);
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId(),
    scope: DRIVE_SCOPE,
    callback: (response: GoogleTokenResponse): void => {
      const settle = pending;
      pending = null;
      if (response.error) {
        settle?.reject(new Error(googleErrorMessage(response.error, response.error_description)));
        return;
      }
      accessToken = response.access_token;
      expiresAt = Date.now() + response.expires_in * 1000;
      grantedScope = response.scope ?? "";
      settle?.resolve(response.access_token);
    },
    error_callback: (err: { type: string; message?: string }): void => {
      const settle = pending;
      pending = null;
      settle?.reject(new Error(googleErrorMessage(err.type, err.message)));
    },
  });
  return tokenClient;
}

function requestToken(prompt?: "" | "consent"): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    void ensureTokenClient()
      .then((client) => {
        pending = { resolve, reject };
        client.requestAccessToken(prompt === undefined ? {} : { prompt });
      })
      .catch(reject);
  });
}

/** Cached token if still valid, else a silent (no-UI) refresh. Throws if the
 *  session can't refresh silently — the caller should prompt a reconnect. */
async function getTokenSilent(forceRefresh = false): Promise<string> {
  if (!forceRefresh && accessToken !== null && Date.now() < expiresAt - 60_000) {
    return accessToken;
  }
  if (!silentRefresh) {
    silentRefresh = requestToken("").finally(() => {
      silentRefresh = null;
    });
  }
  return silentRefresh;
}

/**
 * Get a token good enough to actually use: try silently first, then at most
 * ONE interactive consent popup. Callers MUST invoke this directly from a user
 * tap/click handler and must NOT retry it themselves after it throws — see
 * DriveScopeError below.
 *
 * Two things this guards against:
 *
 * 1. A silent request can succeed while returning an OLD, NARROWER grant
 *    (Google reuses whatever the user previously approved) — without checking
 *    `scopeSatisfied()` we'd carry on with e.g. a drive.file-only token, see
 *    none of the user's synced files, and show an empty dashboard with no
 *    explanation.
 * 2. Chaining a SECOND popup request (silent → default-prompt → consent, as
 *    this used to do) after the first one has already resolved/rejected is
 *    unreliable on Safari/iOS: each additional `requestAccessToken()` call
 *    happens further from the original tap, and Safari's user-activation
 *    window is much stricter than Chrome's. A popup opened outside that
 *    window can be silently blocked or rejected by Google with a generic
 *    "Authorization Error" page. The silent attempt below never opens a
 *    popup, so it's safe to try regardless; everything past it is capped at
 *    one single popup call.
 */
async function acquireInteractive(): Promise<string> {
  if (accessToken !== null && Date.now() < expiresAt - 60_000 && scopeSatisfied()) {
    return accessToken;
  }
  try {
    const token = await requestToken("");
    if (scopeSatisfied()) return token;
  } catch {
    /* no valid silent session — fall through to the one interactive attempt */
  }
  // The only popup this function will ever open. If it still doesn't cover the
  // scope, DON'T call requestToken again here — surface DriveScopeError so the
  // UI can offer a "Grant Drive access" button, which is a fresh tap and
  // therefore reliably allowed to open its own popup.
  const token = await requestToken("consent");
  if (!scopeSatisfied()) {
    throw new DriveScopeError(LIMITED_GRANT_MESSAGE);
  }
  return token;
}

// ---- app folder (find-or-create ContentForge at My Drive root) ------------

/** Escape a value for use inside a Drive `q` string literal (single-quoted). */
function escapeQ(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFetch(url: string, init?: RequestInit): Promise<Response> {
  const withAuth = (token: string): RequestInit => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers };
  };
  const token = await getTokenSilent();
  let res = await fetch(url, withAuth(token));
  if (res.status === 401) {
    res = await fetch(url, withAuth(await getTokenSilent(true)));
  }
  return res;
}

interface DriveFolder {
  id: string;
  name: string;
}

/** True when a folder directly contains a content_calendar.xlsx. */
async function folderHasWorkbook(folderId: string): Promise<boolean> {
  const params = new URLSearchParams({
    q: `'${escapeQ(folderId)}' in parents and name='content_calendar.xlsx' and trashed=false`,
    fields: "files(id)",
    pageSize: "1",
    spaces: "drive",
  });
  const res = await driveFetch(`${DRIVE_FILES_URL}?${params.toString()}`);
  if (!res.ok) return false;
  const data = (await res.json()) as { files?: { id: string }[] };
  return (data.files?.length ?? 0) > 0;
}

/**
 * Find-or-create the app's folder at the root of My Drive. Under the full `drive`
 * scope the lookup can return several same-named folders (e.g. the user's synced
 * one plus an empty duplicate a past drive.file run created). Prefer the folder
 * that actually holds a content_calendar.xlsx so we bind to the populated one;
 * fall back to the oldest, and create a fresh folder only when none exist.
 */
async function findOrCreateAppFolder(name: string): Promise<DriveFolder> {
  const params = new URLSearchParams({
    q: `'root' in parents and name='${escapeQ(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: "files(id, name)",
    orderBy: "createdTime",
    pageSize: "10",
    spaces: "drive",
  });
  const res = await driveFetch(`${DRIVE_FILES_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Couldn't look up your ${name} folder in Drive (${res.status})`);
  }
  const data = (await res.json()) as { files?: DriveFolder[] };
  const candidates = data.files ?? [];
  if (candidates.length > 0) {
    // Prefer a candidate that already has the workbook (the real, populated one).
    for (const folder of candidates) {
      if (await folderHasWorkbook(folder.id)) return folder;
    }
    // None populated yet — oldest (createdTime order) is the canonical one.
    return candidates[0];
  }

  const created = await driveFetch(`${DRIVE_FILES_URL}?fields=id,name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: ["root"] }),
  });
  if (!created.ok) {
    throw new Error(`Couldn't create the ${name} folder in Drive (${created.status})`);
  }
  return (await created.json()) as DriveFolder;
}

// ---- folder picker --------------------------------------------------------

interface PickedFolder {
  id: string;
  name: string;
}

async function openFolderPicker(token: string): Promise<PickedFolder | null> {
  await ensurePicker();
  return new Promise<PickedFolder | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME)
      .setOwnedByMe(true);
    const builder = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey())
      .setTitle("Select a folder for ContentForge")
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs[0];
          if (doc) {
            resolve({ id: doc.id, name: doc.name });
          } else {
            resolve(null);
          }
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      });
    const id = appId();
    if (id) builder.setAppId(id);
    builder.build().setVisible(true);
  });
}

// ---- IndexedDB persistence of recent Drive folders ------------------------
// A dedicated DB, separate from the folder-handle store in lib/client/storage.ts,
// so adding Drive can't touch the existing folder-mode persistence.

const DB_NAME = "contentforge-drive";
const STORE_NAME = "drives";

interface StoredDrive {
  id: string; // the Drive folder id
  name: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function getAllDrives(db: IDBDatabase): Promise<StoredDrive[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = (): void => resolve(request.result as StoredDrive[]);
    request.onerror = (): void => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

function getDriveById(db: IDBDatabase, id: string): Promise<StoredDrive | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = (): void => resolve((request.result as StoredDrive | undefined) ?? null);
    request.onerror = (): void => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

function putDrive(db: IDBDatabase, record: StoredDrive): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
}

function deleteDrive(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
}

async function rememberDrive(id: string, name: string): Promise<void> {
  const db = await openDb();
  try {
    await putDrive(db, { id, name });
  } finally {
    db.close();
  }
}

export async function listRecentDrives(): Promise<RecentFolder[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  try {
    return (await getAllDrives(db)).map((d) => ({ id: d.id, name: d.name }));
  } finally {
    db.close();
  }
}

export async function forgetDrive(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await deleteDrive(db, id);
  } finally {
    db.close();
  }
}

// ---- public entry points --------------------------------------------------

/**
 * Connect Google Drive: consent, then find-or-create `ContentForge` at the root
 * of My Drive and seed the full structure inside it. No picker — reconnecting
 * (or connecting from another device) reuses the same folder.
 */
export async function connectDrive(): Promise<DriveStorage> {
  if (!isDriveConfigured()) {
    throw new Error("Add your Google Client ID in Google Drive setup first.");
  }
  await acquireInteractive();
  const folder = await findOrCreateAppFolder(APP_FOLDER_NAME);
  const provider = new DriveStorage({
    rootFolderId: folder.id,
    folderName: folder.name,
    getToken: getTokenSilent,
  });
  await provider.ensureFiles();
  await rememberDrive(folder.id, folder.name);
  return provider;
}

/**
 * Secondary path: choose a specific Drive folder with the Google Picker instead
 * of the default `ContentForge` folder. Returns null if the user cancels.
 *
 * Note: with the `drive.file` scope the app cannot see files that already exist
 * in a folder it did not create, so a hand-populated folder will look empty.
 */
export async function pickDriveFolder(): Promise<DriveStorage | null> {
  if (!isDrivePickerConfigured()) {
    throw new Error(
      "Choosing a folder needs a Google Picker API key. Add one in Google Drive setup.",
    );
  }
  const token = await acquireInteractive();
  const picked = await openFolderPicker(token);
  if (!picked) return null;
  const provider = new DriveStorage({
    rootFolderId: picked.id,
    folderName: picked.name,
    getToken: getTokenSilent,
  });
  await provider.ensureFiles();
  await rememberDrive(picked.id, picked.name);
  return provider;
}

/** Reconnect to a previously used Drive folder (no picker). Returns null if the
 *  folder is no longer remembered. */
export async function reconnectDrive(id: string): Promise<DriveStorage | null> {
  if (!isDriveConfigured()) {
    throw new Error("Add your Google Client ID in Google Drive setup first.");
  }
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  let record: StoredDrive | null;
  try {
    record = await getDriveById(db, id);
  } finally {
    db.close();
  }
  if (record === null) return null;

  // Establish a token up front (silent if the grant is still live, else consent).
  await acquireInteractive();
  const provider = new DriveStorage({
    rootFolderId: record.id,
    folderName: record.name,
    getToken: getTokenSilent,
  });
  await provider.ensureFiles();
  await rememberDrive(record.id, record.name);
  return provider;
}
