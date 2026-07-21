// lib/client/storage.ts
// Client-side storage providers. Each user keeps their data in their own local
// folder (FolderStorage, backed by the File System Access API) or, for browsers
// without that API, in memory with manual upload/download (UploadDownloadStorage).
//
// IMPORTANT: this module may be imported during SSR. All browser-only APIs
// (window, indexedDB, document, URL, crypto, fetch) are referenced *inside*
// functions and guarded — never at module top level.

import type {
  Credentials,
  RecentFolder,
  StorageInfo,
  StorageProvider,
  TemplateResponse,
} from "@/lib/client/contract";
import { parseCredentials } from "@/lib/client/credentials";
import {
  CREDENTIALS_FILENAME,
  CREDENTIALS_TEMPLATE,
  IMAGES_DIRNAME,
  WORKBOOK_FILENAME,
} from "@/lib/credentialsTemplate";
import {
  WEEKLY_PLAN_FILENAME,
  GENERATION_LOG_FILENAME,
  KNOWLEDGE_DIRNAME,
  KNOWLEDGE_README_FILENAME,
  CACHE_DIRNAME,
  CONTENT_DOMAIN_FILENAME,
  CONFIG_FILENAME,
  PROMPTS_FILENAME,
} from "@/lib/client/storageNames";
import { knowledgeFolderNames } from "@/lib/client/knowledgeFolders";

// The project's ambient FileSystemDirectoryHandle declaration (types/fsaccess.d.ts)
// omits the async-iterator surface. Declare just the `entries()` shape we need so
// directory listing stays typed (no `any`).
interface DirectoryEntryIterable {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
}

// ---- shared helpers -------------------------------------------------------

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}

async function fetchTemplate(): Promise<TemplateResponse> {
  const res = await fetch("/api/template", { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch template (${res.status})`);
  }
  return (await res.json()) as TemplateResponse;
}

function inferImageMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

// ---- FolderStorage --------------------------------------------------------

export class FolderStorage implements StorageProvider {
  readonly mode = "folder" as const;

  private readonly handle: FileSystemDirectoryHandle;

  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle;
  }

  get folderName(): string {
    return this.handle.name;
  }

  private async getImagesDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await this.handle.getDirectoryHandle(IMAGES_DIRNAME, { create });
    } catch {
      return null;
    }
  }

  private async fileExists(name: string): Promise<boolean> {
    try {
      await this.handle.getFileHandle(name, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  private async writeFileBytes(name: string, data: BufferSource | string): Promise<void> {
    const fileHandle = await this.handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  /** Resolve a directory handle by walking `/`-separated segments. */
  private async getDir(
    segments: string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    let dir: FileSystemDirectoryHandle = this.handle;
    for (const segment of segments) {
      try {
        dir = await dir.getDirectoryHandle(segment, { create });
      } catch {
        return null;
      }
    }
    return dir;
  }

  /** Split "knowledge/.cache/x.txt" into [dirSegments, fileName]. */
  private splitPath(relPath: string): { dirs: string[]; file: string } {
    const parts = relPath.split(/[\\/]/).filter((p) => p.length > 0);
    const file = parts.pop() ?? relPath;
    return { dirs: parts, file };
  }

  async ensureFiles(): Promise<void> {
    const hasCreds = await this.fileExists(CREDENTIALS_FILENAME);
    const hasWorkbook = await this.fileExists(WORKBOOK_FILENAME);
    const hasWeeklyPlan = await this.fileExists(WEEKLY_PLAN_FILENAME);
    const hasGenerationLog = await this.fileExists(GENERATION_LOG_FILENAME);
    const hasContentDomain = await this.fileExists(CONTENT_DOMAIN_FILENAME);
    const hasConfig = await this.fileExists(CONFIG_FILENAME);
    const hasPrompts = await this.fileExists(PROMPTS_FILENAME);

    let template: TemplateResponse | null = null;
    const getTemplate = async (): Promise<TemplateResponse> => {
      if (template === null) {
        template = await fetchTemplate();
      }
      return template;
    };

    if (!hasCreds) {
      await this.writeFileBytes(CREDENTIALS_FILENAME, CREDENTIALS_TEMPLATE);
    }
    if (!hasWorkbook) {
      const t = await getTemplate();
      await this.writeFileBytes(WORKBOOK_FILENAME, base64ToArrayBuffer(t.workbookBase64));
    }
    if (!hasWeeklyPlan) {
      const t = await getTemplate();
      await this.writeFileBytes(WEEKLY_PLAN_FILENAME, t.weeklyPlanJson);
    }
    if (!hasGenerationLog) {
      const t = await getTemplate();
      await this.writeFileBytes(GENERATION_LOG_FILENAME, t.generationLogJson);
    }
    // Brand-neutral by default — a new visitor defines their own niche via the
    // onboarding wizard/Settings rather than inheriting whatever this deployer
    // last used. Never seeded from server state.
    if (!hasContentDomain) {
      const t = await getTemplate();
      await this.writeFileBytes(CONTENT_DOMAIN_FILENAME, t.contentDomainJson);
    }
    if (!hasConfig) {
      const t = await getTemplate();
      await this.writeFileBytes(CONFIG_FILENAME, t.configJson);
    }
    if (!hasPrompts) {
      const t = await getTemplate();
      await this.writeFileBytes(PROMPTS_FILENAME, t.agentPromptsJson);
    }

    // Ensure the images/ subdirectory exists.
    await this.getImagesDir(true);

    // Ensure knowledge/ + knowledge/.cache/ exist, with a README in knowledge/.
    const knowledgeDir = await this.getDir([KNOWLEDGE_DIRNAME], true);
    if (knowledgeDir) {
      await this.getDir([KNOWLEDGE_DIRNAME, CACHE_DIRNAME], true);
      let hasReadme = true;
      try {
        await knowledgeDir.getFileHandle(KNOWLEDGE_README_FILENAME, { create: false });
      } catch {
        hasReadme = false;
      }
      if (!hasReadme) {
        const t = await getTemplate();
        const readmeHandle = await knowledgeDir.getFileHandle(KNOWLEDGE_README_FILENAME, {
          create: true,
        });
        const writable = await readmeHandle.createWritable();
        await writable.write(t.knowledgeReadme);
        await writable.close();
      }

      // Create the knowledge/ subfolders the weekly plan actually references, so
      // its `knowledgeFiles` entries aren't dangling. Only ever creates missing
      // directories — existing folders and files are left untouched.
      const planText = await this.readText(WEEKLY_PLAN_FILENAME);
      if (planText) {
        for (const name of knowledgeFolderNames(planText)) {
          await this.getDir([KNOWLEDGE_DIRNAME, name], true);
        }
      }
    }
  }

  async readWorkbook(): Promise<ArrayBuffer | null> {
    try {
      const fileHandle = await this.handle.getFileHandle(WORKBOOK_FILENAME, { create: false });
      const file = await fileHandle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  async writeWorkbook(buffer: ArrayBuffer): Promise<void> {
    await this.writeFileBytes(WORKBOOK_FILENAME, buffer);
  }

  async readCredentials(): Promise<Credentials> {
    try {
      const fileHandle = await this.handle.getFileHandle(CREDENTIALS_FILENAME, { create: false });
      const file = await fileHandle.getFile();
      return parseCredentials(await file.text());
    } catch {
      return parseCredentials("");
    }
  }

  async writeImage(name: string, base64: string): Promise<void> {
    const imagesDir = await this.getImagesDir(true);
    if (!imagesDir) {
      throw new Error("Unable to open images directory");
    }
    const fileHandle = await imagesDir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(base64ToArrayBuffer(base64));
    await writable.close();
  }

  async imageObjectUrl(name: string): Promise<string | null> {
    if (typeof window === "undefined") {
      return null;
    }
    const imagesDir = await this.getImagesDir(false);
    if (!imagesDir) {
      return null;
    }
    try {
      const fileHandle = await imagesDir.getFileHandle(name, { create: false });
      const file = await fileHandle.getFile();
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }

  async deleteImage(name: string): Promise<void> {
    const imagesDir = await this.getImagesDir(false);
    if (!imagesDir) return;
    try {
      await imagesDir.removeEntry(name);
    } catch {
      /* already gone — nothing to do */
    }
  }

  async info(): Promise<StorageInfo> {
    const hasWorkbook = await this.fileExists(WORKBOOK_FILENAME);
    const hasCredentials = await this.fileExists(CREDENTIALS_FILENAME);
    const creds = await this.readCredentials();
    return {
      mode: this.mode,
      folderName: this.handle.name,
      hasWorkbook,
      hasCredentials,
      credentialsFilled: creds.deepseekApiKey.trim() !== "",
    };
  }

  async readText(relPath: string): Promise<string | null> {
    const { dirs, file } = this.splitPath(relPath);
    const dir = dirs.length === 0 ? this.handle : await this.getDir(dirs, false);
    if (!dir) {
      return null;
    }
    try {
      const fileHandle = await dir.getFileHandle(file, { create: false });
      const f = await fileHandle.getFile();
      return await f.text();
    } catch {
      return null;
    }
  }

  async writeText(relPath: string, contents: string): Promise<void> {
    const { dirs, file } = this.splitPath(relPath);
    const dir = dirs.length === 0 ? this.handle : await this.getDir(dirs, true);
    if (!dir) {
      throw new Error(`Unable to open directory for ${relPath}`);
    }
    const fileHandle = await dir.getFileHandle(file, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close();
  }

  async writeBytes(relPath: string, data: ArrayBuffer): Promise<void> {
    const { dirs, file } = this.splitPath(relPath);
    const dir = dirs.length === 0 ? this.handle : await this.getDir(dirs, true);
    if (!dir) {
      throw new Error(`Unable to open directory for ${relPath}`);
    }
    const fileHandle = await dir.getFileHandle(file, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  // Recursively collect every file under a directory as POSIX-relative paths.
  // Descends into all subfolders (folders within folders too). Skips dotfiles /
  // dot-dirs (covers .cache) and the root README.md; nothing else is skipped.
  private async walkKnowledge(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    out: string[],
  ): Promise<void> {
    const iterable = dir as unknown as DirectoryEntryIterable;
    for await (const [name, handle] of iterable.entries()) {
      if (name.startsWith(".")) continue; // .cache + any dotfile/dot-dir
      const rel = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        await this.walkKnowledge(handle, rel, out);
      } else if (rel !== KNOWLEDGE_README_FILENAME) {
        out.push(rel);
      }
    }
  }

  async listKnowledge(): Promise<string[]> {
    const dir = await this.getDir([KNOWLEDGE_DIRNAME], false);
    if (!dir) {
      return [];
    }
    const out: string[] = [];
    await this.walkKnowledge(dir, "", out);
    return out;
  }

  async readKnowledgeBytes(relPath: string): Promise<ArrayBuffer | null> {
    const { dirs, file } = this.splitPath(relPath);
    const base = await this.getDir([KNOWLEDGE_DIRNAME, ...dirs], false);
    if (!base) {
      return null;
    }
    try {
      const fileHandle = await base.getFileHandle(file, { create: false });
      const f = await fileHandle.getFile();
      return await f.arrayBuffer();
    } catch {
      return null;
    }
  }

  async cacheGet(key: string): Promise<string | null> {
    return this.readText(`${KNOWLEDGE_DIRNAME}/${CACHE_DIRNAME}/${key}.txt`);
  }

  async cachePut(key: string, text: string): Promise<void> {
    await this.writeText(`${KNOWLEDGE_DIRNAME}/${CACHE_DIRNAME}/${key}.txt`, text);
  }

  /** Pick a different folder and return a fresh provider (caller swaps). */
  async switchFolder(): Promise<FolderStorage> {
    return pickFolder();
  }
}

// ---- UploadDownloadStorage ------------------------------------------------

export class UploadDownloadStorage implements StorageProvider {
  readonly mode = "upload" as const;

  private workbook: ArrayBuffer | null = null;

  private credentials: Credentials = parseCredentials("");

  private readonly images = new Map<string, ArrayBuffer>();

  // Relative-path → text for weekly-plan.json, generation-log.json and any
  // knowledge/.cache/<key>.txt entries.
  private readonly texts = new Map<string, string>();

  // knowledge filename → raw bytes.
  private readonly knowledge = new Map<string, ArrayBuffer>();

  /** Seed the in-memory store from uploaded files. */
  setUploaded(workbook?: ArrayBuffer, credsText?: string): void {
    if (workbook !== undefined) {
      this.workbook = workbook;
    }
    if (credsText !== undefined) {
      this.credentials = parseCredentials(credsText);
    }
  }

  async ensureFiles(): Promise<void> {
    const needsWorkbook = this.workbook === null;
    const needsWeeklyPlan = !this.texts.has(WEEKLY_PLAN_FILENAME);
    const needsGenerationLog = !this.texts.has(GENERATION_LOG_FILENAME);
    const needsContentDomain = !this.texts.has(CONTENT_DOMAIN_FILENAME);
    const needsConfig = !this.texts.has(CONFIG_FILENAME);
    const needsPrompts = !this.texts.has(PROMPTS_FILENAME);

    if (
      needsWorkbook ||
      needsWeeklyPlan ||
      needsGenerationLog ||
      needsContentDomain ||
      needsConfig ||
      needsPrompts
    ) {
      const template = await fetchTemplate();
      if (needsWorkbook) {
        this.workbook = base64ToArrayBuffer(template.workbookBase64);
        // Only seed credentials from the template if none were uploaded.
        if (this.credentials.deepseekApiKey === "" && this.credentials.openaiApiKey === "") {
          this.credentials = parseCredentials(CREDENTIALS_TEMPLATE);
        }
      }
      if (needsWeeklyPlan) {
        this.texts.set(WEEKLY_PLAN_FILENAME, template.weeklyPlanJson);
      }
      if (needsGenerationLog) {
        this.texts.set(GENERATION_LOG_FILENAME, template.generationLogJson);
      }
      // Brand-neutral — a new visitor defines their own niche via onboarding.
      if (needsContentDomain) {
        this.texts.set(CONTENT_DOMAIN_FILENAME, template.contentDomainJson);
      }
      if (needsConfig) {
        this.texts.set(CONFIG_FILENAME, template.configJson);
      }
      if (needsPrompts) {
        this.texts.set(PROMPTS_FILENAME, template.agentPromptsJson);
      }
    }
  }

  async readWorkbook(): Promise<ArrayBuffer | null> {
    return this.workbook;
  }

  async writeWorkbook(buffer: ArrayBuffer): Promise<void> {
    this.workbook = buffer;
  }

  async readCredentials(): Promise<Credentials> {
    return { ...this.credentials };
  }

  async writeImage(name: string, base64: string): Promise<void> {
    this.images.set(name, base64ToArrayBuffer(base64));
  }

  async deleteImage(name: string): Promise<void> {
    this.images.delete(name);
  }

  async imageObjectUrl(name: string): Promise<string | null> {
    if (typeof window === "undefined") {
      return null;
    }
    const bytes = this.images.get(name);
    if (bytes === undefined) {
      return null;
    }
    const blob = new Blob([bytes], { type: inferImageMime(name) });
    return URL.createObjectURL(blob);
  }

  async info(): Promise<StorageInfo> {
    return {
      mode: this.mode,
      folderName: null,
      hasWorkbook: this.workbook !== null,
      hasCredentials: true,
      credentialsFilled: this.credentials.deepseekApiKey.trim() !== "",
    };
  }

  async readText(relPath: string): Promise<string | null> {
    return this.texts.get(relPath) ?? null;
  }

  async writeText(relPath: string, contents: string): Promise<void> {
    this.texts.set(relPath, contents);
  }

  // Route raw bytes into the same in-memory buckets the rest of this provider
  // uses, so downloadAll() still emits everything that was written.
  async writeBytes(relPath: string, data: ArrayBuffer): Promise<void> {
    const parts = relPath.split(/[\\/]/).filter((p) => p.length > 0);
    const name = parts[parts.length - 1] ?? relPath;
    if (parts.length === 1 && name === WORKBOOK_FILENAME) {
      this.workbook = data;
      return;
    }
    if (parts[0] === IMAGES_DIRNAME) {
      this.images.set(name, data);
      return;
    }
    if (parts[0] === KNOWLEDGE_DIRNAME) {
      this.knowledge.set(parts.slice(1).join("/"), data);
      return;
    }
    // Anything else (credentials.env, *.json) is text-shaped in this provider.
    this.texts.set(relPath, new TextDecoder().decode(data));
  }

  async listKnowledge(): Promise<string[]> {
    return Array.from(this.knowledge.keys());
  }

  async readKnowledgeBytes(name: string): Promise<ArrayBuffer | null> {
    return this.knowledge.get(name) ?? null;
  }

  async cacheGet(key: string): Promise<string | null> {
    return this.texts.get(`${KNOWLEDGE_DIRNAME}/${CACHE_DIRNAME}/${key}.txt`) ?? null;
  }

  async cachePut(key: string, text: string): Promise<void> {
    this.texts.set(`${KNOWLEDGE_DIRNAME}/${CACHE_DIRNAME}/${key}.txt`, text);
  }

  /** Trigger browser downloads of the workbook and all stored images. */
  async downloadAll(): Promise<void> {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const urls: string[] = [];
    const triggerDownload = (blob: Blob, filename: string): void => {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    };

    if (this.workbook !== null) {
      triggerDownload(
        new Blob([this.workbook], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        WORKBOOK_FILENAME,
      );
    }
    const weeklyPlan = this.texts.get(WEEKLY_PLAN_FILENAME);
    if (weeklyPlan !== undefined) {
      triggerDownload(
        new Blob([weeklyPlan], { type: "application/json" }),
        WEEKLY_PLAN_FILENAME,
      );
    }
    const generationLog = this.texts.get(GENERATION_LOG_FILENAME);
    if (generationLog !== undefined) {
      triggerDownload(
        new Blob([generationLog], { type: "application/json" }),
        GENERATION_LOG_FILENAME,
      );
    }
    for (const filename of [CONTENT_DOMAIN_FILENAME, CONFIG_FILENAME, PROMPTS_FILENAME]) {
      const text = this.texts.get(filename);
      if (text !== undefined) {
        triggerDownload(new Blob([text], { type: "application/json" }), filename);
      }
    }
    for (const [name, bytes] of this.knowledge) {
      triggerDownload(new Blob([bytes], { type: inferImageMime(name) }), name);
    }
    for (const [name, bytes] of this.images) {
      triggerDownload(new Blob([bytes], { type: inferImageMime(name) }), name);
    }

    // Revoke object URLs after the downloads have had a chance to start.
    if (urls.length > 0) {
      setTimeout(() => {
        for (const url of urls) {
          URL.revokeObjectURL(url);
        }
      }, 60_000);
    }
  }
}

// ---- IndexedDB persistence of folder handles ------------------------------

const DB_NAME = "contentforge";
const STORE_NAME = "folders";

interface StoredFolder {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
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

function getAllFolders(db: IDBDatabase): Promise<StoredFolder[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = (): void => resolve(request.result as StoredFolder[]);
    request.onerror = (): void => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

function putFolder(db: IDBDatabase, record: StoredFolder): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
}

function getFolderById(db: IDBDatabase, id: string): Promise<StoredFolder | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = (): void => resolve((request.result as StoredFolder | undefined) ?? null);
    request.onerror = (): void => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

function makeId(name: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: stable-ish hash of the name.
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return `folder-${Math.abs(hash)}`;
}

async function rememberFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    const existing = await getAllFolders(db);
    // De-dupe by name: reuse the existing id and refresh the handle.
    const match = existing.find((f) => f.name === handle.name);
    const id = match?.id ?? makeId(handle.name);
    await putFolder(db, { id, name: handle.name, handle });
  } finally {
    db.close();
  }
}

// ---- module-level provider functions --------------------------------------

export function isFolderApiSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickFolder(): Promise<FolderStorage> {
  if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
    throw new Error("The File System Access API is not supported in this browser");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const provider = new FolderStorage(handle);
  await provider.ensureFiles();
  await rememberFolder(handle);
  return provider;
}

export async function listRecentFolders(): Promise<RecentFolder[]> {
  if (typeof indexedDB === "undefined") {
    return [];
  }
  const db = await openDb();
  try {
    const folders = await getAllFolders(db);
    return folders.map((f) => ({ id: f.id, name: f.name }));
  } finally {
    db.close();
  }
}

export async function reconnectFolder(id: string): Promise<FolderStorage | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  const db = await openDb();
  let record: StoredFolder | null;
  try {
    record = await getFolderById(db, id);
  } finally {
    db.close();
  }
  if (record === null) {
    return null;
  }

  const { handle } = record;
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  let state = await handle.queryPermission(descriptor);
  if (state !== "granted") {
    state = await handle.requestPermission(descriptor);
  }
  if (state !== "granted") {
    return null;
  }

  const provider = new FolderStorage(handle);
  await provider.ensureFiles();
  return provider;
}
