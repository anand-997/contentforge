"use client";

// components/LoadingProvider.tsx
// A top-level "some async operation is pending, somewhere" indicator, additive
// to every existing per-action indicator (Spinner labels, disabled buttons,
// generating/busy text) — none of those are removed. Mirrors ToastProvider's
// pattern in components/ui.tsx: a context + counter state + a fixed overlay
// rendered as a sibling of `children`.

import { createContext, useCallback, useContext, useRef, useState } from "react";

export interface GlobalLoadingContextValue {
  pendingCount: number;
  isPending: boolean;
  /** Wrap any async action so it counts toward the global indicator while in
   * flight. Nesting-safe (increments/decrements are paired via try/finally),
   * and rethrows so callers' own try/catch still sees errors. */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}

// Named `useGlobalLoading`, not `useBusy` — StorageContextValue already
// exposes a differently-scoped `busy` boolean, and several components
// destructure it from useStorage(); a same-named hook here would invite
// accidental shadowing.
const GlobalLoadingContext = createContext<GlobalLoadingContextValue | null>(null);

export function useGlobalLoading(): GlobalLoadingContextValue {
  const ctx = useContext(GlobalLoadingContext);
  if (!ctx) {
    // No-op fallback so components never crash outside the provider.
    return { pendingCount: 0, isPending: false, run: (fn) => fn() };
  }
  return ctx;
}

// Operations that resolve almost instantly (a quick local read, a cache hit)
// shouldn't make the bar blip on/off — only show it once something has been
// pending for a moment. This matters most for local mode's periodic status
// poll/SSE handler, which would otherwise flicker the bar every few seconds
// during an active pipeline run.
const SHOW_DELAY_MS = 150;

export function LoadingProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [pendingCount, setPendingCount] = useState(0);
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setPendingCount((c) => c + 1);
    try {
      return await fn();
    } finally {
      setPendingCount((c) => Math.max(0, c - 1));
    }
  }, []);

  const isPending = pendingCount > 0;

  // Debounced visibility: start a timer the moment something becomes
  // pending; cancel it immediately if pendingCount drops back to 0 first.
  if (isPending && !visible && showTimer.current === null) {
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      setVisible(true);
    }, SHOW_DELAY_MS);
  } else if (!isPending) {
    if (showTimer.current !== null) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (visible) {
      // Deferred so it doesn't fire mid-render.
      queueMicrotask(() => setVisible(false));
    }
  }

  return (
    <GlobalLoadingContext.Provider value={{ pendingCount, isPending, run }}>
      {children}
      <div
        aria-hidden={!visible}
        className={`pointer-events-none fixed inset-x-0 top-0 z-[110] h-[3px] overflow-hidden bg-transparent transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="h-full w-1/3 animate-loading-bar bg-gradient-to-r from-transparent via-teal to-transparent" />
      </div>
    </GlobalLoadingContext.Provider>
  );
}
