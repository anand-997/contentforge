// lib/client/driveStorage.ts
// A StorageProvider backed by Google Drive. The user's data lives in a
// `ContentForge` folder at the root of My Drive (found-or-created in
// lib/client/driveAuth.ts); this class maps ContentForge's path-based file model
// onto Drive's id/parent model and talks to the Drive REST API directly from the
// browser with a short-lived OAuth access token. With the full `drive` scope it
// reads/writes files added by desktop sync or the web UI too, so a folder the
// user populated outside the app just works. It is the cross-device sibling of
// FolderStorage — same files, same StorageProvider surface, different store.
//
// IMPORTANT: this module may be imported during SSR. All browser-only APIs
// (window, URL, fetch, atob) are referenced *inside* methods and guarded.

import type {
  Credentials,
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
  CACHE_DIRNAME,
  GENERATION_LOG_FILENAME,
  KNOWLEDGE_DIRNAME,
  KNOWLEDGE_README_FILENAME,
  WEEKLY_PLAN_FILENAME,
  CONTENT_DOMAIN_FILENAME,
  CONFIG_FILENAME,
  PROMPTS_FILENAME,
} from "@/lib/client/storageNames";
import { knowledgeFolderNames } from "@/lib/client/knowledgeFolders";

// Returns a usable OAuth access token. Pass `forceRefresh` after a 401 to get a
// freshly minted token (silent refresh) rather than the cached one.
export type DriveTokenProvider = (forceRefresh?: boolean) => Promise<string>;

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
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

function mimeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".env") || lower.endsWith(".txt")) return "text/plain";
  return inferImageMime(name);
}

// Escape a value for use inside a Drive `q` string literal (single-quoted).
function escapeQ(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ---- DriveStorage ---------------------------------------------------------

export class DriveStorage implements StorageProvider {
  readonly mode = "drive" as const;

  readonly folderName: string;

  private readonly rootId: string;

  private readonly getToken: DriveTokenProvider;

  // Memoized directory path ("knowledge/.cache") → Drive folder id.
  private readonly dirIdCache = new Map<string, string>();

  constructor(args: { rootFolderId: string; folderName: string; getToken: DriveTokenProvider }) {
    this.rootId = args.rootFolderId;
    this.folderName = args.folderName;
    this.getToken = args.getToken;
    this.dirIdCache.set("", this.rootId);
  }

  // ---- authenticated fetch (silent-refresh on 401) ----

  private async authedFetch(url: string, init?: RequestInit): Promise<Response> {
    const withAuth = (token: string): RequestInit => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return { ...init, headers };
    };
    const token = await this.getToken();
    let res = await fetch(url, withAuth(token));
    if (res.status === 401) {
      const fresh = await this.getToken(true);
      res = await fetch(url, withAuth(fresh));
    }
    return res;
  }

  // ---- low-level Drive operations ----

  private async listChildren(parentId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${escapeQ(parentId)}' in parents and trashed=false`,
        fields: "nextPageToken, files(id, name, mimeType)",
        pageSize: "1000",
        spaces: "drive",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await this.authedFetch(`${DRIVE_FILES_URL}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Drive list failed (${res.status})`);
      }
      const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
      if (data.files) out.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  // Drive allows same-name siblings, so a name can resolve to several entries
  // (earlier buggy runs could leave a duplicate images//knowledge/). Always take
  // the OLDEST match so every session converges on the same folder instead of
  // splitting writes across duplicates.
  private async findChild(
    parentId: string,
    name: string,
    kind: "file" | "folder",
  ): Promise<DriveFile | null> {
    const isFolderQ =
      kind === "folder"
        ? `mimeType='${FOLDER_MIME}'`
        : `mimeType!='${FOLDER_MIME}'`;
    const params = new URLSearchParams({
      q: `'${escapeQ(parentId)}' in parents and name='${escapeQ(name)}' and ${isFolderQ} and trashed=false`,
      fields: "files(id, name, mimeType)",
      orderBy: "createdTime",
      pageSize: "10",
      spaces: "drive",
    });
    const res = await this.authedFetch(`${DRIVE_FILES_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Drive lookup failed (${res.status})`);
    }
    const data = (await res.json()) as { files?: DriveFile[] };
    if (!data.files || data.files.length === 0) return null;
    if (data.files.length > 1 && typeof console !== "undefined") {
      console.warn(
        `[ContentForge] ${data.files.length} Drive entries named "${name}" — using the oldest.`,
      );
    }
    return data.files[0];
  }

  private async createFolder(parentId: string, name: string): Promise<string> {
    const res = await this.authedFetch(`${DRIVE_FILES_URL}?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!res.ok) {
      throw new Error(`Drive folder create failed (${res.status})`);
    }
    return ((await res.json()) as { id: string }).id;
  }

  // Resolve a "/"-separated directory path under the root to a folder id,
  // creating intermediate folders when `create` is true. Memoized.
  private async getDirId(segments: string[], create: boolean): Promise<string | null> {
    const cleaned = segments.filter((s) => s.length > 0);
    let path = "";
    let parentId = this.rootId;
    for (const segment of cleaned) {
      path = path ? `${path}/${segment}` : segment;
      const cached = this.dirIdCache.get(path);
      if (cached !== undefined) {
        parentId = cached;
        continue;
      }
      const existing = await this.findChild(parentId, segment, "folder");
      if (existing) {
        parentId = existing.id;
      } else if (create) {
        parentId = await this.createFolder(parentId, segment);
      } else {
        return null;
      }
      this.dirIdCache.set(path, parentId);
    }
    return parentId;
  }

  private async createFileMetadata(
    parentId: string,
    name: string,
    mimeType: string,
  ): Promise<string> {
    const res = await this.authedFetch(`${DRIVE_FILES_URL}?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType, parents: [parentId] }),
    });
    if (!res.ok) {
      throw new Error(`Drive file create failed (${res.status})`);
    }
    return ((await res.json()) as { id: string }).id;
  }

  private async uploadMedia(
    fileId: string,
    data: BodyInit,
    mimeType: string,
  ): Promise<void> {
    const res = await this.authedFetch(
      `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`,
      { method: "PATCH", headers: { "Content-Type": mimeType }, body: data },
    );
    if (!res.ok) {
      throw new Error(`Drive upload failed (${res.status})`);
    }
  }

  // Create-or-update a file by name inside a directory id, with the given bytes.
  private async putFile(
    dirId: string,
    name: string,
    data: BodyInit,
    mimeType: string,
  ): Promise<void> {
    const existing = await this.findChild(dirId, name, "file");
    const fileId = existing
      ? existing.id
      : await this.createFileMetadata(dirId, name, mimeType);
    await this.uploadMedia(fileId, data, mimeType);
  }

  private async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const res = await this.authedFetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`);
    if (!res.ok) {
      throw new Error(`Drive download failed (${res.status})`);
    }
    return res.arrayBuffer();
  }

  private async deleteFileById(fileId: string): Promise<void> {
    const res = await this.authedFetch(`${DRIVE_FILES_URL}/${fileId}`, {
      method: "DELETE",
    });
    // 404 = already gone; treat as success.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Drive delete failed (${res.status})`);
    }
  }

  /** Split "knowledge/.cache/x.txt" into [dirSegments, fileName]. */
  private splitPath(relPath: string): { dirs: string[]; file: string } {
    const parts = relPath.split(/[\\/]/).filter((p) => p.length > 0);
    const file = parts.pop() ?? relPath;
    return { dirs: parts, file };
  }

  // ---- StorageProvider surface ----

  async ensureFiles(): Promise<void> {
    const rootChildren = await this.listChildren(this.rootId);
    // Match on name AND kind — a folder named "weekly-plan.json" must not be
    // mistaken for the file (Drive happily allows both to coexist).
    const has = (name: string): boolean =>
      rootChildren.some((f) => f.name === name && f.mimeType !== FOLDER_MIME);

    let template: TemplateResponse | null = null;
    const getTemplate = async (): Promise<TemplateResponse> => {
      if (template === null) template = await fetchTemplate();
      return template;
    };

    if (!has(CREDENTIALS_FILENAME)) {
      await this.putFile(this.rootId, CREDENTIALS_FILENAME, CREDENTIALS_TEMPLATE, "text/plain");
    }
    if (!has(WORKBOOK_FILENAME)) {
      const t = await getTemplate();
      await this.putFile(
        this.rootId,
        WORKBOOK_FILENAME,
        base64ToArrayBuffer(t.workbookBase64),
        mimeForName(WORKBOOK_FILENAME),
      );
    }
    if (!has(WEEKLY_PLAN_FILENAME)) {
      const t = await getTemplate();
      await this.putFile(this.rootId, WEEKLY_PLAN_FILENAME, t.weeklyPlanJson, "application/json");
    }
    if (!has(GENERATION_LOG_FILENAME)) {
      const t = await getTemplate();
      await this.putFile(
        this.rootId,
        GENERATION_LOG_FILENAME,
        t.generationLogJson,
        "application/json",
      );
    }
    // Brand-neutral by default — a new visitor defines their own niche via the
    // onboarding wizard/Settings rather than inheriting server state.
    if (!has(CONTENT_DOMAIN_FILENAME)) {
      const t = await getTemplate();
      await this.putFile(
        this.rootId,
        CONTENT_DOMAIN_FILENAME,
        t.contentDomainJson,
        "application/json",
      );
    }
    if (!has(CONFIG_FILENAME)) {
      const t = await getTemplate();
      await this.putFile(this.rootId, CONFIG_FILENAME, t.configJson, "application/json");
    }
    if (!has(PROMPTS_FILENAME)) {
      const t = await getTemplate();
      await this.putFile(this.rootId, PROMPTS_FILENAME, t.agentPromptsJson, "application/json");
    }

    // Ensure images/ exists.
    await this.getDirId([IMAGES_DIRNAME], true);

    // Ensure knowledge/ + knowledge/.cache/ with a README inside knowledge/.
    const knowledgeId = await this.getDirId([KNOWLEDGE_DIRNAME], true);
    await this.getDirId([KNOWLEDGE_DIRNAME, CACHE_DIRNAME], true);
    if (knowledgeId) {
      const readme = await this.findChild(knowledgeId, KNOWLEDGE_README_FILENAME, "file");
      if (!readme) {
        const t = await getTemplate();
        await this.putFile(
          knowledgeId,
          KNOWLEDGE_README_FILENAME,
          t.knowledgeReadme,
          "text/markdown",
        );
      }

      // Create the knowledge/ subfolders the weekly plan references, so its
      // `knowledgeFiles` entries aren't dangling. getDirId is find-or-create, so
      // reconnecting reuses the existing folders instead of duplicating them.
      const planText = await this.readText(WEEKLY_PLAN_FILENAME);
      if (planText) {
        for (const name of knowledgeFolderNames(planText)) {
          await this.getDirId([KNOWLEDGE_DIRNAME, name], true);
        }
      }
    }
  }

  async readWorkbook(): Promise<ArrayBuffer | null> {
    const file = await this.findChild(this.rootId, WORKBOOK_FILENAME, "file");
    if (!file) return null;
    return this.downloadFile(file.id);
  }

  async writeWorkbook(buffer: ArrayBuffer): Promise<void> {
    await this.putFile(this.rootId, WORKBOOK_FILENAME, buffer, mimeForName(WORKBOOK_FILENAME));
  }

  async readCredentials(): Promise<Credentials> {
    const file = await this.findChild(this.rootId, CREDENTIALS_FILENAME, "file");
    if (!file) return parseCredentials("");
    const bytes = await this.downloadFile(file.id);
    return parseCredentials(new TextDecoder().decode(bytes));
  }

  async writeImage(name: string, base64: string): Promise<void> {
    const dirId = await this.getDirId([IMAGES_DIRNAME], true);
    if (!dirId) throw new Error("Unable to open images directory");
    await this.putFile(dirId, name, base64ToArrayBuffer(base64), inferImageMime(name));
  }

  async imageObjectUrl(name: string): Promise<string | null> {
    if (typeof window === "undefined") return null;
    const dirId = await this.getDirId([IMAGES_DIRNAME], false);
    if (!dirId) return null;
    const file = await this.findChild(dirId, name, "file");
    if (!file) return null;
    const bytes = await this.downloadFile(file.id);
    return URL.createObjectURL(new Blob([bytes], { type: inferImageMime(name) }));
  }

  async deleteImage(name: string): Promise<void> {
    const dirId = await this.getDirId([IMAGES_DIRNAME], false);
    if (!dirId) return;
    const file = await this.findChild(dirId, name, "file");
    if (file) await this.deleteFileById(file.id);
  }

  async info(): Promise<StorageInfo> {
    const rootChildren = await this.listChildren(this.rootId);
    const hasWorkbook = rootChildren.some((f) => f.name === WORKBOOK_FILENAME);
    const hasCredentials = rootChildren.some((f) => f.name === CREDENTIALS_FILENAME);
    const creds = await this.readCredentials();
    return {
      mode: this.mode,
      folderName: this.folderName,
      hasWorkbook,
      hasCredentials,
      credentialsFilled: creds.deepseekApiKey.trim() !== "",
    };
  }

  async readText(relPath: string): Promise<string | null> {
    const { dirs, file } = this.splitPath(relPath);
    const dirId = await this.getDirId(dirs, false);
    if (dirId === null) return null;
    const found = await this.findChild(dirId, file, "file");
    if (!found) return null;
    const bytes = await this.downloadFile(found.id);
    return new TextDecoder().decode(bytes);
  }

  async writeText(relPath: string, contents: string): Promise<void> {
    const { dirs, file } = this.splitPath(relPath);
    const dirId = await this.getDirId(dirs, true);
    if (dirId === null) throw new Error(`Unable to open directory for ${relPath}`);
    await this.putFile(dirId, file, contents, mimeForName(file));
  }

  async writeBytes(relPath: string, data: ArrayBuffer): Promise<void> {
    const { dirs, file } = this.splitPath(relPath);
    const dirId = await this.getDirId(dirs, true);
    if (dirId === null) throw new Error(`Unable to open directory for ${relPath}`);
    await this.putFile(dirId, file, data, mimeForName(file));
  }

  // Recursively collect every file under knowledge/ as POSIX-relative paths.
  // Skips dotfiles / dot-dirs (covers .cache) and the root README.md.
  private async walkKnowledge(dirId: string, prefix: string, out: string[]): Promise<void> {
    const children = await this.listChildren(dirId);
    for (const child of children) {
      if (child.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.mimeType === FOLDER_MIME) {
        await this.walkKnowledge(child.id, rel, out);
      } else if (rel !== KNOWLEDGE_README_FILENAME) {
        out.push(rel);
      }
    }
  }

  async listKnowledge(): Promise<string[]> {
    const dirId = await this.getDirId([KNOWLEDGE_DIRNAME], false);
    if (dirId === null) return [];
    const out: string[] = [];
    await this.walkKnowledge(dirId, "", out);
    return out;
  }

  async readKnowledgeBytes(relPath: string): Promise<ArrayBuffer | null> {
    const { dirs, file } = this.splitPath(relPath);
    const dirId = await this.getDirId([KNOWLEDGE_DIRNAME, ...dirs], false);
    if (dirId === null) return null;
    const found = await this.findChild(dirId, file, "file");
    if (!found) return null;
    return this.downloadFile(found.id);
  }

  async cacheGet(key: string): Promise<string | null> {
    return this.readText(`${KNOWLEDGE_DIRNAME}/${CACHE_DIRNAME}/${key}.txt`);
  }

  async cachePut(key: string, text: string): Promise<void> {
    await this.writeText(`${KNOWLEDGE_DIRNAME}/${CACHE_DIRNAME}/${key}.txt`, text);
  }
}
