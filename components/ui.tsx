"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/* Relative time helper                                                */
/* ------------------------------------------------------------------ */

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 0) return "just now";
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.round(mo / 12);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

/** Re-renders the consumer every `ms` so relative times stay fresh. */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/* ------------------------------------------------------------------ */
/* Toast system                                                        */
/* ------------------------------------------------------------------ */

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // No-op fallback so components never crash outside the provider.
    return { push: () => undefined };
  }
  return ctx;
}

export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}): JSX.Element {
  const accent: Record<ToastKind, string> = {
    success: "border-teal/50 text-teal",
    error: "border-status-error/50 text-status-error",
    info: "border-status-writing/50 text-status-writing",
  };
  const icon: Record<ToastKind, string> = {
    success: "✓",
    error: "!",
    info: "i",
  };
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-ink-700/95 px-4 py-3 text-sm shadow-panel backdrop-blur animate-fade-up ${accent[toast.kind]}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${accent[toast.kind]}`}
      >
        {icon[toast.kind]}
      </span>
      <p className="flex-1 text-white/90">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="focus-ring -mr-1 rounded text-subtext hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton block                                                      */
/* ------------------------------------------------------------------ */

export function Skeleton({ className = "" }: { className?: string }): JSX.Element {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Cron description helper (human-friendly)                            */
/* ------------------------------------------------------------------ */

/** Validates 5-field cron syntax client-side. Returns null if valid. */
export function validateCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return "Cron must have exactly 5 fields: minute hour day month weekday.";
  }
  const ranges: Array<[number, number]> = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    const [min, max] = ranges[i];
    if (!isValidCronField(field, min, max)) {
      return `Field ${i + 1} ("${field}") is not valid cron syntax.`;
    }
  }
  return null;
}

function isValidCronField(field: string, min: number, max: number): boolean {
  if (field === "*") return true;
  // Support comma lists of: *, n, n-m, */s, n-m/s
  return field.split(",").every((token) => {
    const stepMatch = token.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!stepMatch) return false;
    const [, base, step] = stepMatch;
    if (step !== undefined && Number(step) < 1) return false;
    if (base === "*") return true;
    const rangeMatch = base.match(/^(\d+)(?:-(\d+))?$/);
    if (!rangeMatch) return false;
    const start = Number(rangeMatch[1]);
    const end = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : start;
    return start >= min && end <= max && start <= end;
  });
}

/** Produces a plain-English gloss of common cron expressions. */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid schedule";
  const [m, h, dom, mon, dow] = parts;
  if (dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(m) && /^\d+$/.test(h)) {
    const hour = Number(h);
    const minute = Number(m);
    const ampm = hour < 12 ? "AM" : "PM";
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    const mm = minute.toString().padStart(2, "0");
    return `Every day at ${h12}:${mm} ${ampm}`;
  }
  return "Custom schedule";
}
