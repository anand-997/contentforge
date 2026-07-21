// lib/client/importLocal.ts
// Copies an existing local ContentForge folder (e.g. social-media-config/) into
// the active storage provider — in practice, up to Google Drive.
//
// This exists because of the `drive.file` OAuth scope: the app can only see
// files it created itself, so files dragged into Drive through the web UI stay
// invisible. Importing through the app means the app creates them, which makes
// them visible from then on, on every device.
//
// Browser-only (File System Access API) — call from an event handler.

import type { StorageProvider } from "@/lib/client/contract";
import { CACHE_DIRNAME, KNOWLEDGE_DIRNAME } from "@/lib/client/storageNames";

export interface ImportProgress {
  /** Files copied so far. */
  done: number;
  /** Total files queued for copying. */
  total: number;
  /** Path currently being copied, relative to the source folder root. */
  current: string;
}

export interface ImportResult {
  copied: number;
  skipped: number;
  failed: number;
  /** Relative paths that failed, with the reason — surfaced to the user. */
  errors: { path: string; message: string }[];
  /** Name of the source folder that was imported. */
  sourceName: string;
}

// The project's ambient FileSystemDirectoryHandle declaration omits the async
// iterator surface; declare just the `entries()` shape we need (mirrors the
// identical helper in lib/client/storage.ts).
interface DirectoryEntryIterable {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
}

/** Extraction caches are derived data — regenerated on demand, never worth copying. */
function isSkippablePath(relPath: string): boolean {
  const parts = relPath.split("/");
  return parts[0] === KNOWLEDGE_DIRNAME && parts[1] === CACHE_DIRNAME;
}

/** Collect every file under a directory handle as POSIX-relative paths. */
async function collectFiles(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: { path: string; handle: FileSystemFileHandle }[],
): Promise<void> {
  const iterable = dir as unknown as DirectoryEntryIterable;
  for await (const [name, handle] of iterable.entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await collectFiles(handle, rel, out);
    } else {
      out.push({ path: rel, handle });
    }
  }
}

/** True when this browser can open a local folder to import from. */
export function isImportSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/**
 * Prompt for a local folder and copy its whole contents into `target`,
 * overwriting same-named files. Returns null if the user cancels the picker.
 */
export async function importLocalFolder(
  target: StorageProvider,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult | null> {
  if (!isImportSupported()) {
    throw new Error("This browser can't open a local folder. Use Chrome or Edge on desktop.");
  }

  let source: FileSystemDirectoryHandle;
  try {
    source = await window.showDirectoryPicker({ mode: "read" });
  } catch (err) {
    // AbortError = the user cancelled the picker; not a real error.
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }

  const files: { path: string; handle: FileSystemFileHandle }[] = [];
  await collectFiles(source, "", files);

  const result: ImportResult = {
    copied: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    sourceName: source.name,
  };

  const queued = files.filter((f) => {
    if (isSkippablePath(f.path)) {
      result.skipped += 1;
      return false;
    }
    return true;
  });

  for (let i = 0; i < queued.length; i += 1) {
    const { path, handle } = queued[i];
    onProgress?.({ done: i, total: queued.length, current: path });
    try {
      const file = await handle.getFile();
      await target.writeBytes(path, await file.arrayBuffer());
      result.copied += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        path,
        message: err instanceof Error ? err.message : "Copy failed",
      });
    }
  }
  onProgress?.({ done: queued.length, total: queued.length, current: "" });

  return result;
}
