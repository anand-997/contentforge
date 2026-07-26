// components/ErrorBanner.tsx
// Shared error banner with a co-located retry button, used by both the
// local-mode dashboard (app/page.tsx) and folder/Drive mode (FolderApp.tsx)
// so every error state — pipeline failure, dropped connection, etc. — always
// surfaces an actual button next to the message instead of instructional
// text with no attached action.

export function ErrorBanner({
  message,
  onRetry,
  disabled = false,
}: {
  message: string;
  onRetry: () => void;
  disabled?: boolean;
}): JSX.Element {
  // Strip the noisy "Pipeline failed: Error:" prefix for a cleaner read.
  const clean = message
    .replace(/^Pipeline failed:\s*/i, "")
    .replace(/^Error:\s*/i, "");
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-status-error/40 bg-status-error/10 p-4 sm:flex-row sm:items-center sm:justify-between animate-fade-up"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="mt-0.5 text-status-error">
          ⚠
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            The pipeline stopped with an error
          </p>
          <p className="mt-0.5 break-words text-sm text-subtext">{clean}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        aria-disabled={disabled}
        className="focus-ring shrink-0 self-start rounded-lg border border-teal/50 bg-teal/10 px-4 py-2 text-sm font-semibold text-teal transition-colors hover:bg-teal/20 disabled:opacity-50 disabled:pointer-events-none sm:self-auto"
      >
        ▶ Run again
      </button>
    </div>
  );
}
