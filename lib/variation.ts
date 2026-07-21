// lib/variation.ts
// Per-run entropy. The topic pipeline was deterministic: identical prompts +
// deterministic selectors meant re-running a day produced the SAME topic and
// content. These helpers inject fresh randomness every run — a random DeepSeek
// seed, a shuffled keyword subset, and a random "angle lens" — so each run
// explores a genuinely different take. Always on (no config gate).

/** A fresh random seed for a DeepSeek call (its OpenAI-compatible API honours it). */
export function makeRunSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Fisher–Yates shuffle into a new array (does not mutate the input). */
export function shuffle<T>(arr: ReadonlyArray<T>): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Uniformly random element, or undefined for an empty array. */
export function randomPick<T>(arr: ReadonlyArray<T>): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Angle lenses injected into the topic prompt so the same theme/keywords yield a
// different topic each run instead of collapsing to one phrasing.
export const ANGLE_LENSES: ReadonlyArray<string> = [
  "through a cost / ROI lens",
  "from a junior engineer's first week",
  "as a debugging post-mortem",
  "from the perspective of what hiring managers actually screen for",
  "as a contrarian take most teams get wrong",
  "through the lens of a common production-incident pattern",
  "as a 'what most teams would do differently' reflection",
  "from the perspective of the tool's limits, not its hype",
  "as a tradeoff nobody talks about",
  "through the eyes of whoever maintains it six months later",
];
