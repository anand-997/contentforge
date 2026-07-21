"use client";

import { useId, useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

export interface InfoTooltipProps {
  /** Help text shown on hover, focus, or tap. */
  text: string;
  /** Optional accessible label for the trigger. Defaults to "More info". */
  label?: string;
  /** Tooltip placement relative to the icon. */
  side?: "top" | "bottom" | "right";
  className?: string;
}

const GAP_PX = 8; // matches the old mb-2/mt-2/ml-2 (0.5rem) spacing

interface Position {
  top: number;
  left: number;
  transform: string;
}

function computePosition(
  rect: DOMRect,
  side: NonNullable<InfoTooltipProps["side"]>,
): Position {
  switch (side) {
    case "top":
      return {
        top: rect.top - GAP_PX,
        left: rect.left + rect.width / 2,
        transform: "translate(-50%, -100%)",
      };
    case "right":
      return {
        top: rect.top + rect.height / 2,
        left: rect.right + GAP_PX,
        transform: "translateY(-50%)",
      };
    case "bottom":
    default:
      return {
        top: rect.bottom + GAP_PX,
        left: rect.left + rect.width / 2,
        transform: "translateX(-50%)",
      };
  }
}

/**
 * Accessible "i" info popover.
 * - Desktop: shows on hover and keyboard focus.
 * - Mobile: shows on tap (toggles), closes on outside tap / Escape.
 *
 * The popover itself is portaled to document.body and positioned in fixed
 * coordinates computed from the trigger's bounding rect, rather than being a
 * CSS-relative absolutely-positioned child. A plain `position: absolute`
 * popover gets clipped whenever the trigger sits inside a container with
 * `overflow-x-auto`/`overflow-y-auto` (e.g. the dashboard's scrollable tab
 * bar) — CSS forces the *other* overflow axis to behave as `auto` too the
 * moment either axis is non-`visible`, so the popover has nowhere to escape
 * to. Portaling sidesteps that the same way the app's modals are portaled
 * (see components/ContentDomainEditor.tsx).
 */
export function InfoTooltip({
  text,
  label = "More info",
  side = "top",
  className = "",
}: InfoTooltipProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  // Measure the trigger and place the portaled popover before paint.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }
    setPosition(computePosition(triggerRef.current.getBoundingClientRect(), side));
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    // A fixed-position popover doesn't track the trigger while scrolling —
    // closing on scroll avoids it drifting away from what it's annotating.
    function onScroll(): void {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/*
        Rendered as a focusable span (not a <button>) so the tooltip can be
        nested inside other buttons (status cards, checklist steps) without
        producing invalid <button> in <button> HTML / hydration errors.
      */}
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="focus-ring flex h-4 w-4 cursor-help select-none items-center justify-center rounded-full border border-subtext/50 text-[0.6rem] font-bold leading-none text-subtext transition-colors hover:border-teal hover:text-teal"
      >
        i
      </span>
      {open &&
        position &&
        createPortal(
          <span
            role="tooltip"
            id={id}
            style={{ position: "fixed", top: position.top, left: position.left, transform: position.transform }}
            className="pointer-events-none z-50 w-56 rounded-lg border border-hairline bg-ink-900/95 px-3 py-2 text-xs font-normal leading-relaxed text-white/85 shadow-panel backdrop-blur animate-fade-up"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
