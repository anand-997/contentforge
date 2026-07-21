"use client";

// components/FolderSwitcher.tsx
// Always-visible control to see the active folder and switch to another (for
// people running multiple accounts). In upload mode it offers a download of the
// current files instead.

import { useEffect, useState } from "react";
import { useStorage } from "./StorageContext";
import { UploadDownloadStorage, listRecentFolders } from "@/lib/client/storage";
import type { RecentFolder } from "@/lib/client/contract";

export function FolderSwitcher(): JSX.Element | null {
  const { info, provider, switchFolder, reconnect, busy } = useStorage();
  const [recent, setRecent] = useState<RecentFolder[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (info?.mode !== "folder") return;
    void listRecentFolders().then(setRecent).catch(() => setRecent([]));
  }, [info?.mode, info?.folderName]);

  if (!info) return null;

  if (info.mode === "upload") {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-hairline bg-ink-700/50 px-2.5 py-1 font-mono text-xs text-subtext">
          Upload mode
        </span>
        <button
          type="button"
          onClick={() => {
            if (provider instanceof UploadDownloadStorage) void provider.downloadAll();
          }}
          className="focus-ring rounded-md border border-teal/40 bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal hover:bg-teal/20"
        >
          Download files
        </button>
      </div>
    );
  }

  const others = recent.filter((f) => f.name !== info.folderName);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex items-center gap-2 rounded-md border border-hairline bg-ink-700/50 px-2.5 py-1 text-xs text-white hover:border-teal/40"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden="true" className="text-teal">▤</span>
        <span className="max-w-[10rem] truncate font-mono">{info.folderName}</span>
        <span aria-hidden="true" className="text-subtext">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-hairline bg-ink-800 p-1.5 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              void switchFolder();
            }}
            className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-teal hover:bg-teal/10 disabled:opacity-50"
          >
            + Switch / browse new folder
          </button>
          {others.length > 0 && (
            <>
              <p className="px-2.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-subtext">
                Recent
              </p>
              {others.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    void reconnect(f.id);
                  }}
                  className="focus-ring block w-full truncate rounded-md px-2.5 py-1.5 text-left font-mono text-xs text-white hover:bg-ink-700 disabled:opacity-50"
                >
                  {f.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
