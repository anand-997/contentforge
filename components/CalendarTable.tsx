"use client";

import { useMemo, useState } from "react";
import type { ContentRow } from "@/lib/types";
import { publishProgress, type Platform, type PublishState } from "@/lib/publishStatus";
import { StatusBadge } from "./statusBadge";
import { TopicDetailModal } from "./TopicDetailModal";
import { relativeTime, useNow, Skeleton } from "./ui";

export interface CalendarTableProps {
  rows: ContentRow[];
  loading: boolean;
  /** Persist a row diff (publish status, edits, notes). Read-only when omitted. */
  onSaveRow?: (date: string, updates: Partial<ContentRow>) => Promise<void>;
  /** Map a stored image ref to a displayable URL (folder mode → blob URL). */
  resolveImage?: (ref: string) => Promise<string | null>;
  /** Delete a day's row + images and regenerate fresh content. */
  onRegenerate?: (date: string) => void | Promise<void>;
  /** Delete a day's row + images only — no regeneration. */
  onDelete?: (date: string) => void | Promise<void>;
  /** Publish a platform's content to that platform (Dev.to draft / Instagram live). */
  onPublishDraft?: (
    date: string,
    platform: Platform,
  ) => Promise<{ url: string; note?: string; state: PublishState }>;
}

const PAGE_SIZE = 30;

export function CalendarTable({
  rows,
  loading,
  onSaveRow,
  resolveImage,
  onRegenerate,
  onDelete,
  onPublishDraft,
}: CalendarTableProps): JSX.Element {
  useNow(60000);
  const [page, setPage] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [rows, safePage],
  );

  // Derive the open row from the live list so it stays fresh after a save+reload.
  const selected = useMemo(
    () => rows.find((r) => r.date === selectedDate) ?? null,
    [rows, selectedDate],
  );

  if (loading) {
    return (
      <div className="panel space-y-2 p-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="panel px-6 py-12 text-center text-sm text-subtext">
        No history yet. Run the pipeline to populate the calendar.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Desktop table */}
      <div className="panel hidden overflow-hidden md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-hairline text-[0.7rem] uppercase tracking-wider text-subtext">
              <Th>Date</Th>
              <Th>Topic</Th>
              <Th>Pillar</Th>
              <Th>Structure</Th>
              <Th>Status</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <DesktopRow
                key={row.date + row.topic}
                row={row}
                onOpen={() => setSelectedDate(row.date)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {pageRows.map((row) => (
          <MobileCard
            key={row.date + row.topic}
            row={row}
            onOpen={() => setSelectedDate(row.date)}
          />
        ))}
      </div>

      {pageCount > 1 && (
        <Pagination
          page={safePage}
          pageCount={pageCount}
          total={rows.length}
          onPage={setPage}
        />
      )}

      {selected && (
        <TopicDetailModal
          row={selected}
          onClose={() => setSelectedDate(null)}
          onSave={onSaveRow}
          resolveImage={resolveImage}
          onRegenerate={onRegenerate}
          onDelete={onDelete}
          onPublishDraft={onPublishDraft}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }): JSX.Element {
  return <th className="px-4 py-2.5 font-semibold">{children}</th>;
}

/** Compact "n/5 published" chip; hidden when nothing is published yet. */
function PublishProgressChip({ row }: { row: ContentRow }): JSX.Element | null {
  const { published, total } = publishProgress(row);
  if (published === 0) return null;
  const allDone = published === total;
  return (
    <span
      title={`${published} of ${total} platforms published`}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.62rem] font-medium ${
        allDone
          ? "border-status-done/40 bg-status-done/10 text-status-done"
          : "border-hairline bg-ink-600/40 text-subtext"
      }`}
    >
      ✓ {published}/{total}
    </span>
  );
}

function DesktopRow({
  row,
  onOpen,
}: {
  row: ContentRow;
  onOpen: () => void;
}): JSX.Element {
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-hairline/60 transition-colors last:border-0 hover:bg-ink-600/30"
    >
      <td className="px-4 py-2.5 font-mono text-xs text-subtext">{row.date}</td>
      <td className="max-w-xs px-4 py-2.5">
        <span className="line-clamp-1 font-medium text-white/90">{row.topic}</span>
      </td>
      <td className="px-4 py-2.5 text-xs capitalize text-subtext">
        {row.pillar.replace("-", " ")}
      </td>
      <td className="px-4 py-2.5 text-xs text-subtext">{row.postStructure}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <StatusBadge status={row.status} size="sm" />
          <PublishProgressChip row={row} />
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-subtext">
        {relativeTime(row.lastUpdated)}
      </td>
    </tr>
  );
}

function MobileCard({
  row,
  onOpen,
}: {
  row: ContentRow;
  onOpen: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="panel focus-ring w-full px-4 py-3 text-left"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-subtext">{row.date}</span>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={row.status} size="sm" />
          <PublishProgressChip row={row} />
        </div>
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium text-white/90">
        {row.topic}
      </p>
      <p className="mt-1 text-xs capitalize text-subtext">
        {row.pillar.replace("-", " ")} · {row.postStructure} ·{" "}
        {relativeTime(row.lastUpdated)}
      </p>
    </button>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (p: number) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-xs text-subtext">{total} entries</span>
      <div className="flex items-center gap-2">
        <PageBtn disabled={page === 0} onClick={() => onPage(page - 1)} label="Previous">
          ‹ Prev
        </PageBtn>
        <span className="font-mono text-xs text-subtext">
          {page + 1} / {pageCount}
        </span>
        <PageBtn
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
          label="Next"
        >
          Next ›
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="focus-ring min-h-[36px] rounded-lg border border-hairline bg-ink-600/60 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-teal/40 hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
