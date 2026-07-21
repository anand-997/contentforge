// lib/similarity.ts
// Lightweight text-overlap helpers for Agent 2's anti-repetition self-check.
// No external deps, no `any`. Used to catch a hook or closer that is too close
// to one already published in the last few posts.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  const n = normalize(text);
  return n.length === 0 ? [] : n.split(" ");
}

// Word n-grams (shingles). n=2 (bigrams) is a good default for short lines.
function shingles(text: string, n: number): Set<string> {
  const words = tokens(text);
  const set = new Set<string>();
  if (words.length < n) {
    // Fall back to single words so very short lines still compare.
    for (const w of words) {
      set.add(w);
    }
    return set;
  }
  for (let i = 0; i + n <= words.length; i += 1) {
    set.add(words.slice(i, i + n).join(" "));
  }
  return set;
}

// Jaccard overlap of word n-grams, 0 (disjoint) .. 1 (identical).
export function ngramSimilarity(a: string, b: string, n = 2): number {
  const sa = shingles(a, n);
  const sb = shingles(b, n);
  if (sa.size === 0 || sb.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const g of sa) {
    if (sb.has(g)) {
      intersection += 1;
    }
  }
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Highest similarity of `text` against any of `priors`. 0 when priors is empty.
export function maxSimilarity(text: string, priors: string[], n = 2): number {
  let max = 0;
  for (const prior of priors) {
    const score = ngramSimilarity(text, prior, n);
    if (score > max) {
      max = score;
    }
  }
  return max;
}

// First non-empty line of a post body — used as the "hook".
export function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    if (line.trim().length > 0) {
      return line.trim();
    }
  }
  return "";
}

// Last non-empty line of a post body — used as the "closer".
export function lastLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim().length > 0) {
      return lines[i].trim();
    }
  }
  return "";
}
