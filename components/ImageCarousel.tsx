"use client";

import { useState } from "react";
import { parseImagePaths } from "@/lib/imagePaths";
import { InfoTooltip } from "./InfoTooltip";

interface Slide {
  src: string;
  label: string;
}

export interface ImageCarouselProps {
  imageMedium: string;
  imageLinkedin: string;
  /**
   * Instagram carousel paths. Either a JSON-array string of slide paths
   * (cover + concept slides + CTA) or a legacy single path string. Parsed
   * via parseImagePaths so both shapes (and empty) render correctly.
   */
  imageInstagram: string;
  /**
   * Changes whenever the row is regenerated (e.g. row.lastUpdated). Used to
   * bust the browser cache for same-named image files so a regenerated card
   * replaces the old one instead of showing a stale image.
   */
  version?: string;
}

// Server-mode images are served from a stable path (/images/<date>-x.png), so the
// browser caches them; appending the version forces a refetch after regenerate.
// Blob URLs (folder mode) are already unique per resolve — leave them untouched.
function withVersion(src: string, version?: string): string {
  if (!version || src.startsWith("blob:") || src.startsWith("data:")) return src;
  return src.includes("?") ? src : `${src}?v=${encodeURIComponent(version)}`;
}

export function ImageCarousel({
  imageMedium,
  imageLinkedin,
  imageInstagram,
  version,
}: ImageCarouselProps): JSX.Element | null {
  const slides: Slide[] = [];
  if (imageMedium.trim())
    slides.push({ src: withVersion(imageMedium.trim(), version), label: "Medium cover (16:9)" });
  if (imageLinkedin.trim())
    slides.push({ src: withVersion(imageLinkedin.trim(), version), label: "LinkedIn (1200×627)" });
  const instagramPaths = parseImagePaths(imageInstagram);
  instagramPaths.forEach((src, i) =>
    slides.push({
      src: withVersion(src, version),
      label:
        instagramPaths.length > 1
          ? `Instagram ${i + 1}/${instagramPaths.length} (1080×1080)`
          : "Instagram (1080×1080)",
    }),
  );

  const [idx, setIdx] = useState(0);
  const [broken, setBroken] = useState<Record<number, boolean>>({});

  if (slides.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline bg-ink-700/40 px-4 py-8 text-center text-sm text-subtext">
        Images appear here once Agent 3 finishes the Imaging step.
      </div>
    );
  }

  const safeIdx = Math.min(idx, slides.length - 1);
  const current = slides[safeIdx];
  const go = (d: number): void =>
    setIdx((i) => (i + d + slides.length) % slides.length);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h4 className="text-sm font-semibold text-white">Generated images</h4>
        <InfoTooltip
          text="Branded image cards saved to public/images. The filename encodes the date and platform, e.g. 2026-06-14-medium.png."
          side="right"
        />
        <span className="ml-auto font-mono text-xs text-subtext">
          {safeIdx + 1} / {slides.length}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-hairline bg-ink-900">
        <div className="flex aspect-video items-center justify-center bg-ink-900">
          {broken[safeIdx] ? (
            <div className="px-4 text-center text-sm text-subtext">
              <p className="font-mono text-xs">{current.src}</p>
              <p className="mt-1 text-xs">Image not found on disk yet.</p>
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={current.src}
              src={current.src}
              alt={`${current.label} — branded content card`}
              className="max-h-[420px] w-full object-contain"
              onError={() => setBroken((b) => ({ ...b, [safeIdx]: true }))}
            />
          )}
        </div>

        {slides.length > 1 && (
          <>
            <CarouselArrow direction="prev" onClick={() => go(-1)} />
            <CarouselArrow direction="next" onClick={() => go(1)} />
          </>
        )}

        <div className="absolute bottom-2 left-2 rounded-md bg-ink-900/80 px-2 py-1 font-mono text-[0.68rem] text-teal backdrop-blur">
          {current.label}
        </div>
      </div>

      {slides.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Show ${s.label}`}
              aria-current={i === safeIdx}
              className={`h-2 rounded-full transition-all ${
                i === safeIdx ? "w-6 bg-teal" : "w-2 bg-subtext/40 hover:bg-subtext"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CarouselArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "Previous image" : "Next image"}
      className={`focus-ring absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-ink-800/80 text-white backdrop-blur transition-colors hover:border-teal hover:text-teal ${
        direction === "prev" ? "left-2" : "right-2"
      }`}
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}
