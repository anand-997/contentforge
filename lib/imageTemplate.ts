// lib/imageTemplate.ts
// Deterministic branded content-card renderer. Replaces AI text-card generation
// so the headline is the post's ACTUAL hook line (not the SEO title), the brand
// colors/layout are exact, and the result is crisp and legible at thumbnail size.
//
// Pipeline: satori (HTML-like tree -> SVG with the text shaped into vector paths)
// -> @resvg/resvg-js (SVG -> PNG). Fonts are the bundled @fontsource woff files,
// so nothing is downloaded and no native font scanning is needed at raster time.

import path from "path";
import fs from "fs/promises";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { BrandConfig } from "@/lib/types";

// satori accepts a React node; we build the equivalent plain object tree so this
// stays a .ts file with no JSX. This matches satori's accepted virtual-DOM shape.
type Node = {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: Node[] | string;
  };
};

interface LoadedFont {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700 | 800;
  style: "normal";
}

let fontCache: LoadedFont[] | null = null;

function fontFile(pkg: string, file: string): string {
  return path.join(process.cwd(), "node_modules", pkg, "files", file);
}

async function loadFonts(): Promise<LoadedFont[]> {
  if (fontCache) {
    return fontCache;
  }
  const specs: Array<{ pkg: string; file: string; name: string; weight: LoadedFont["weight"] }> = [
    { pkg: "@fontsource/inter", file: "inter-latin-400-normal.woff", name: "Inter", weight: 400 },
    { pkg: "@fontsource/inter", file: "inter-latin-600-normal.woff", name: "Inter", weight: 600 },
    { pkg: "@fontsource/inter", file: "inter-latin-800-normal.woff", name: "Inter", weight: 800 },
    { pkg: "@fontsource/jetbrains-mono", file: "jetbrains-mono-latin-700-normal.woff", name: "JetBrains Mono", weight: 700 },
  ];
  const loaded: LoadedFont[] = [];
  for (const s of specs) {
    const data = await fs.readFile(fontFile(s.pkg, s.file));
    loaded.push({ name: s.name, data, weight: s.weight, style: "normal" });
  }
  fontCache = loaded;
  return loaded;
}

export interface CardSpec {
  kicker: string; // e.g. "YOUR BRAND | PILLAR NAME"
  headline: string; // the post's hook line, short
  subline: string; // supporting line (the topic), optional
  footerLeft: string; // small mono tag, e.g. pillar name
  handle: string; // e.g. "@yourbrand"
  width: number;
  height: number;
  colors: BrandConfig["imageColors"];
}

// Pick a headline size that fills the card without overflowing, scaled to width.
// Slightly bolder fill than before for a higher-contrast, "creator" look.
function headlineSize(text: string, width: number): number {
  const scale = width / 1200;
  const len = text.length;
  const base = len <= 22 ? 88 : len <= 36 ? 72 : len <= 52 ? 58 : 50;
  return Math.round(base * scale);
}

// Generalized auto-sizer for carousel headings: scale a base size down as the
// text gets longer, normalized to width. Deterministic and bounded.
function fitHeadingSize(content: string, width: number, baseAt1080: number): number {
  const scale = width / 1080;
  const len = content.length;
  const factor = len <= 18 ? 1 : len <= 30 ? 0.84 : len <= 48 ? 0.7 : len <= 70 ? 0.58 : 0.48;
  return Math.round(baseAt1080 * factor * scale);
}

function text(
  content: string,
  style: Record<string, string | number>,
): Node {
  return { type: "div", props: { style: { display: "flex", ...style }, children: content } };
}

export async function renderCard(spec: CardSpec): Promise<Buffer> {
  const { width, height, colors } = spec;
  const scale = width / 1200;
  const pad = Math.round(width * 0.075);

  const children: Node[] = [
    text(spec.kicker, {
      fontFamily: "JetBrains Mono",
      fontSize: Math.round(24 * scale),
      fontWeight: 700,
      color: colors.accent,
      letterSpacing: 2,
    }),
  ];

  const middleChildren: Node[] = [
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          width: Math.round(84 * scale),
          height: Math.round(8 * scale),
          backgroundColor: colors.accent,
          marginBottom: Math.round(30 * scale),
        },
      },
    },
    text(spec.headline, {
      fontFamily: "Inter",
      fontSize: headlineSize(spec.headline, width),
      fontWeight: 800,
      color: colors.text,
      lineHeight: 1.04,
      letterSpacing: -1,
      maxWidth: width - pad * 2,
    }),
  ];
  if (spec.subline.trim().length > 0) {
    middleChildren.push(
      text(spec.subline, {
        fontFamily: "Inter",
        fontSize: Math.round(30 * scale),
        fontWeight: 400,
        color: colors.subtext,
        lineHeight: 1.3,
        marginTop: Math.round(22 * scale),
        maxWidth: width - pad * 2,
      }),
    );
  }

  children.push({
    type: "div",
    props: { style: { display: "flex", flexDirection: "column" }, children: middleChildren },
  });

  children.push({
    type: "div",
    props: {
      style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
      children: [
        text(spec.footerLeft, {
          fontFamily: "JetBrains Mono",
          fontSize: Math.round(20 * scale),
          fontWeight: 700,
          color: colors.subtext,
        }),
        text(spec.handle, {
          fontFamily: "JetBrains Mono",
          fontSize: Math.round(20 * scale),
          fontWeight: 700,
          color: colors.accent,
        }),
      ],
    },
  });

  const root: Node = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        height,
        padding: pad,
        backgroundColor: colors.background,
        fontFamily: "Inter",
      },
      children,
    },
  };

  const fonts = await loadFonts();
  const svg = await satori(root as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

// Turn a post's first line into a short, bold card headline. Prefers a complete
// short first sentence; otherwise truncates to ~7 words with an ellipsis (which
// also adds curiosity). Keeps a question mark since it reads as a hook.
export function deriveHeadline(hookLine: string, fallback: string): string {
  let h = hookLine.trim();
  if (h.length === 0) {
    h = fallback.trim();
  }
  // Drop surrounding quotes.
  h = h.replace(/^["'`]+|["'`]+$/g, "").trim();

  // If the line is several sentences, consider just the first one.
  const firstSentence = h.split(/(?<=[.!?])\s+/)[0]?.trim() ?? h;
  const useFirstSentence =
    firstSentence.length > 0 &&
    firstSentence.split(/\s+/).length <= 9 &&
    firstSentence.length <= 58;
  if (useFirstSentence) {
    h = firstSentence;
  }

  const words = h.split(/\s+/);
  let truncated = false;
  if (words.length > 8) {
    h = words.slice(0, 7).join(" ");
    truncated = true;
  }

  // Trim trailing punctuation, but keep a final question mark.
  const endsWithQuestion = /\?$/.test(h);
  h = h.replace(/[.,;:!?]+$/g, "").trim();
  if (h.length > 56) {
    h = h.slice(0, 53).trimEnd();
    truncated = true;
  }

  if (endsWithQuestion) {
    h = h + "?";
  } else if (truncated) {
    h = h + "…";
  }
  return h.length > 0 ? h : fallback;
}

// Collapse runs of whitespace and strip wrapping quotes/backticks. Pure.
function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^["'`]+|["'`]+$/g, "").trim();
}

// Trim to maxChars on a word boundary. Preserves a trailing "?"; otherwise adds
// an ellipsis when the text was actually shortened. Deterministic and pure.
function truncateOnWordBoundary(value: string, maxChars: number): string {
  const cleaned = cleanText(value);
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  const endsWithQuestion = /\?$/.test(cleaned);
  const slice = cleaned.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  let out = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  out = out.replace(/[.,;:!?]+$/g, "").trim();
  if (out.length === 0) {
    return "";
  }
  return endsWithQuestion ? `${out}?` : `${out}…`;
}

// Distil a short "insight" clause from a line: the first sentence/clause, bounded.
function deriveInsight(source: string): string {
  const cleaned = cleanText(source);
  if (cleaned.length === 0) {
    return "";
  }
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() ?? cleaned;
  return truncateOnWordBoundary(firstSentence, 110);
}

// Build the headline + subline for a branded card directly from the brief.
// headline = the topic (cleaned/trimmed on a word boundary); subline depends on
// sublineSource. Deterministic, pure, never throws.
export function deriveCardText(opts: {
  topic: string;
  facts: string[]; // brief.canonicalFacts (may be empty)
  linkedinFirstLine: string; // firstLine(row.linkedin) fallback
  sublineSource: "fact" | "topic" | "insight";
  headlineMaxChars: number;
}): { headline: string; subline: string } {
  const topic = cleanText(opts.topic);
  const headline =
    topic.length > 0
      ? truncateOnWordBoundary(topic, opts.headlineMaxChars)
      : deriveHeadline(opts.linkedinFirstLine, topic);

  let subline = "";
  if (opts.sublineSource === "fact") {
    const fact = (opts.facts.find((f) => f.trim().length > 0) ?? "").trim();
    subline = fact.length > 0 ? fact : deriveInsight(opts.linkedinFirstLine);
  } else if (opts.sublineSource === "topic") {
    // Avoid duplicating the headline when it already is the topic.
    subline = headline === topic ? "" : topic;
  } else {
    subline = deriveInsight(opts.linkedinFirstLine);
  }

  return { headline, subline: truncateOnWordBoundary(subline, 110) };
}

// ---------------------------------------------------------------------------
// Multi-slide Instagram carousel
// ---------------------------------------------------------------------------

export interface CarouselSlideSpec {
  kind: "cover" | "point" | "cta";
  index: number; // 1-based position
  total: number; // total slide count
  kicker: string; // e.g. "YOUR BRAND | PILLAR NAME"
  heading: string; // slide heading (bold)
  body: string; // supporting text; may be ""
  handle: string; // e.g. "@yourbrand"
  colors: BrandConfig["imageColors"];
  width?: number; // default 1080
  height?: number; // default 1080
}

// Render one carousel slide as a PNG buffer. Reuses loadFonts() and the same
// satori + Resvg(width) rasterization as renderCard. Deterministic; never throws
// for normal inputs.
export async function renderCarouselSlide(spec: CarouselSlideSpec): Promise<Buffer> {
  const width = spec.width ?? 1080;
  const height = spec.height ?? 1080;
  const colors = spec.colors;
  const scale = width / 1080;
  const pad = Math.round(width * 0.075);
  const contentWidth = width - pad * 2;

  // Top bar: kicker (left, mono accent) + slide indicator (right, mono accent).
  const topBar: Node = {
    type: "div",
    props: {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
      },
      children: [
        text(spec.kicker, {
          fontFamily: "JetBrains Mono",
          fontSize: Math.round(22 * scale),
          fontWeight: 700,
          color: colors.accent,
          letterSpacing: 2,
          maxWidth: Math.round(contentWidth * 0.78),
          lineHeight: 1.2,
        }),
        text(`${spec.index}/${spec.total}`, {
          fontFamily: "JetBrains Mono",
          fontSize: Math.round(22 * scale),
          fontWeight: 700,
          color: colors.accent,
          letterSpacing: 1,
        }),
      ],
    },
  };

  // Bottom bar: small @handle.
  const bottomBar: Node = {
    type: "div",
    props: {
      style: { display: "flex", justifyContent: "flex-start", alignItems: "center" },
      children: [
        text(spec.handle, {
          fontFamily: "JetBrains Mono",
          fontSize: Math.round(20 * scale),
          fontWeight: 700,
          color: colors.subtext,
        }),
      ],
    },
  };

  const heading = cleanText(spec.heading);
  const body = cleanText(spec.body);

  const middleChildren: Node[] = [];

  if (spec.kind === "cover") {
    // Accent bar motif (from renderCard) above a dominant headline.
    middleChildren.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          width: Math.round(110 * scale),
          height: Math.round(10 * scale),
          backgroundColor: colors.accent,
          marginBottom: Math.round(34 * scale),
        },
      },
    });
    middleChildren.push(
      text(heading, {
        fontFamily: "Inter",
        fontSize: fitHeadingSize(heading, width, 132),
        fontWeight: 800,
        color: colors.text,
        lineHeight: 1.02,
        letterSpacing: -2,
        maxWidth: contentWidth,
      }),
    );
    if (body.length > 0) {
      middleChildren.push(
        text(body, {
          fontFamily: "Inter",
          fontSize: Math.round(30 * scale),
          fontWeight: 400,
          color: colors.subtext,
          lineHeight: 1.32,
          marginTop: Math.round(30 * scale),
          maxWidth: contentWidth,
        }),
      );
    }
  } else if (spec.kind === "cta") {
    // Closing slide: accent bar + accent-colored heading so it reads distinct.
    middleChildren.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          width: Math.round(160 * scale),
          height: Math.round(14 * scale),
          backgroundColor: colors.accent,
          marginBottom: Math.round(34 * scale),
        },
      },
    });
    middleChildren.push(
      text(heading, {
        fontFamily: "Inter",
        fontSize: fitHeadingSize(heading, width, 104),
        fontWeight: 800,
        color: colors.accent,
        lineHeight: 1.05,
        letterSpacing: -1,
        maxWidth: contentWidth,
      }),
    );
    if (body.length > 0) {
      middleChildren.push(
        text(body, {
          fontFamily: "Inter",
          fontSize: Math.round(34 * scale),
          fontWeight: 400,
          color: colors.text,
          lineHeight: 1.32,
          marginTop: Math.round(30 * scale),
          maxWidth: contentWidth,
        }),
      );
    }
  } else {
    // point: oversized accent slide number, then heading, then body.
    // Cover is slide 1, so a "point" number reads as index-1 (01, 02, ...).
    const pointNumber = String(Math.max(1, spec.index - 1)).padStart(2, "0");
    middleChildren.push(
      text(pointNumber, {
        fontFamily: "JetBrains Mono",
        fontSize: Math.round(150 * scale),
        fontWeight: 700,
        color: colors.accent,
        lineHeight: 1,
        letterSpacing: -2,
        marginBottom: Math.round(18 * scale),
      }),
    );
    if (heading.length > 0) {
      middleChildren.push(
        text(heading, {
          fontFamily: "Inter",
          fontSize: fitHeadingSize(heading, width, 76),
          fontWeight: 800,
          color: colors.text,
          lineHeight: 1.06,
          letterSpacing: -1,
          maxWidth: contentWidth,
        }),
      );
    }
    if (body.length > 0) {
      middleChildren.push(
        text(body, {
          fontFamily: "Inter",
          fontSize: Math.round(36 * scale),
          fontWeight: 400,
          color: colors.subtext,
          lineHeight: 1.34,
          marginTop: Math.round(26 * scale),
          maxWidth: contentWidth,
        }),
      );
    }
  }

  const middle: Node = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      },
      children: middleChildren,
    },
  };

  const root: Node = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        height,
        padding: pad,
        backgroundColor: colors.background,
        fontFamily: "Inter",
      },
      children: [topBar, middle, bottomBar],
    },
  };

  const fonts = await loadFonts();
  const svg = await satori(root as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

// A short label/title for a point slide derived from its body: the first few
// words, title-cased lightly by keeping the source casing. Bounded and pure.
function derivePointLabel(body: string): string {
  const cleaned = cleanText(body);
  if (cleaned.length === 0) {
    return "";
  }
  const words = cleaned.replace(/[.,;:!?]+$/g, "").split(/\s+/);
  const label = words.slice(0, 4).join(" ");
  return truncateOnWordBoundary(label, 34);
}

// Split an Instagram caption into meaningful candidate lines for point slides.
// Drops empty lines, hashtag-only lines, and obvious hook/CTA lines. Pure.
function splitCaptionLines(instagramBody: string): string[] {
  const raw = instagramBody.split(/\r?\n/);
  const out: string[] = [];
  for (const lineRaw of raw) {
    const line = cleanText(lineRaw);
    if (line.length === 0) {
      continue;
    }
    // Hashtag-only / mostly-hashtag lines.
    const words = line.split(/\s+/);
    const hashWords = words.filter((w) => w.startsWith("#")).length;
    if (hashWords > 0 && hashWords >= words.length - 1) {
      continue;
    }
    // Strip leading list markers / bullets.
    const stripped = line.replace(/^[-*•\d.)\]\s]+/, "").trim();
    if (stripped.length < 8) {
      continue;
    }
    // Skip lines that read as a follow/CTA prompt (kept for the CTA slide).
    if (/\b(follow|comment|share|dm|link in bio|tag a)\b/i.test(stripped)) {
      continue;
    }
    out.push(stripped);
  }
  return out;
}

// Deterministically derive 4-6 carousel slides ({heading, body}) from a brief.
// Pure; never throws. Never emits the banned phrase "Save this" and never
// fabricates specifics.
export function deriveCarouselSlides(opts: {
  topic: string;
  facts: string[]; // brief.canonicalFacts (may be empty)
  instagramBody: string; // row.instagram caption text (may be empty)
  handle: string;
}): Array<{ heading: string; body: string }> {
  const topic = cleanText(opts.topic);
  const coverHeading =
    topic.length > 0 ? truncateOnWordBoundary(topic, 70) : "A quick breakdown";
  const coverBody = deriveInsight(opts.instagramBody);

  const slides: Array<{ heading: string; body: string }> = [
    { heading: coverHeading, body: coverBody },
  ];

  // Gather candidate point bodies: caption lines first, then facts, then synth.
  const captionLines = splitCaptionLines(opts.instagramBody);
  const factLines = opts.facts.map((f) => cleanText(f)).filter((f) => f.length >= 8);

  let pointBodies: string[] = captionLines.length > 0 ? captionLines : factLines;

  // De-duplicate against the cover body to avoid repeating the hook.
  const coverInsight = cleanText(coverBody);
  pointBodies = pointBodies.filter((b) => cleanText(b) !== coverInsight);

  if (pointBodies.length === 0) {
    // Synthesize honest, generic points from the topic — no fabricated specifics.
    const subject = topic.length > 0 ? topic : "this topic";
    pointBodies = [
      `Here is the core idea behind ${subject} and why it matters in practice.`,
      `How to actually apply ${subject} in your day-to-day work.`,
    ];
  }

  // Take 2-4 middle point slides.
  const maxPoints = 4;
  const chosen = pointBodies.slice(0, maxPoints);
  for (const rawBody of chosen) {
    const body = truncateOnWordBoundary(rawBody, 140);
    if (body.length === 0) {
      continue;
    }
    const label = derivePointLabel(rawBody);
    // The deterministic label is just the body's opening words, so showing both
    // would repeat the same text. When the label is a prefix of the body, render
    // the sentence once as the heading (no subtext) — one statement per slide.
    const labelIsPrefix =
      label.length > 0 &&
      cleanText(body).toLowerCase().startsWith(label.toLowerCase());
    if (labelIsPrefix) {
      slides.push({ heading: truncateOnWordBoundary(rawBody, 96), body: "" });
    } else {
      slides.push({ heading: label.length > 0 ? label : "The point", body });
    }
  }

  // Guarantee at least 2 point slides (so total >= 4 with cover + cta).
  while (slides.length < 3) {
    const n = slides.length; // 1-based-ish counter for variety
    const subject = topic.length > 0 ? topic : "this topic";
    slides.push({
      heading: n === 1 ? "The idea" : "In practice",
      body:
        n === 1
          ? `What ${subject} really means day to day.`
          : `Where ${subject} fits into your workflow.`,
    });
  }

  // CTA slide (honest, generic; never the banned "Save this").
  slides.push({
    heading: "Follow for more",
    body: "Which part would you try first? Drop a comment and follow for more breakdowns like this.",
  });

  // Cap at 6 total: cover + up to 4 points + cta. Trim points if needed.
  if (slides.length > 6) {
    const cover = slides[0];
    const cta = slides[slides.length - 1];
    const points = slides.slice(1, slides.length - 1).slice(0, 4);
    return [cover, ...points, cta];
  }

  return slides;
}
