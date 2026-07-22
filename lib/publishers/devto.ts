// lib/publishers/devto.ts
// Creates a Dev.to *draft* (published:false) from a row's `devto` markdown via the
// Forem articles API. The column usually carries YAML frontmatter (title, tags,
// series, cover_image…) which Dev.to parses itself; we only normalize the
// published flag and inject the hosted cover image. No `any` anywhere.

export interface DevtoDraftResult {
  url: string;
  id: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// A Dev.to YAML frontmatter block is an opening `---` line, one or more
// `key: value` lines, then a closing `---` line. Returns the frontmatter and the
// remaining body when present, otherwise null.
function splitFrontmatter(
  md: string,
): { frontmatter: string; body: string } | null {
  // Normalize CRLF so line matching is stable regardless of source.
  const normalized = md.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  // Find the closing fence after the opening one.
  const closeIdx = normalized.indexOf("\n---", 3);
  if (closeIdx === -1) return null;
  // The closing fence runs to the end of its line.
  const afterClose = normalized.indexOf("\n", closeIdx + 1);
  const frontmatterEnd = afterClose === -1 ? normalized.length : afterClose;
  const frontmatter = normalized.slice(0, frontmatterEnd);
  const body = afterClose === -1 ? "" : normalized.slice(afterClose);
  return { frontmatter, body };
}

/**
 * Set (or replace) a single `key: value` line inside a YAML frontmatter block.
 * Pure and testable — operates only on the frontmatter string (between the two
 * `---` fences) so the surrounding body is never touched.
 */
export function setFrontmatterField(
  frontmatter: string,
  key: string,
  value: string,
): string {
  const lines = frontmatter.split("\n");
  // lines[0] is the opening `---`; the closing `---` is the last fence line.
  const keyPattern = new RegExp(`^\\s*${key}\\s*:`);
  let replaced = false;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Only consider real key lines (skip the opening/closing fences).
    if (!replaced && i > 0 && line.trim() !== "---" && keyPattern.test(line)) {
      out.push(`${key}: ${value}`);
      replaced = true;
    } else {
      out.push(line);
    }
  }
  if (replaced) return out.join("\n");
  // Not present: insert just after the opening fence so it lands inside the block.
  out.splice(1, 0, `${key}: ${value}`);
  return out.join("\n");
}

/**
 * Remove a `key: value` line from a YAML frontmatter block entirely (as
 * opposed to setFrontmatterField, which sets/replaces it). Used to drop the
 * generator's placeholder `cover_image: /api/images/...` — a relative path
 * that's only ever resolvable on this app's own server — when no real,
 * publicly-fetchable image URL is available. Dev.to's API rejects a relative
 * cover_image outright ("Main image is not a valid URL"), so leaving the
 * placeholder in place is worse than omitting the field.
 */
export function removeFrontmatterField(frontmatter: string, key: string): string {
  const lines = frontmatter.split("\n");
  const keyPattern = new RegExp(`^\\s*${key}\\s*:`);
  const out = lines.filter(
    (line, i) => !(i > 0 && line.trim() !== "---" && keyPattern.test(line)),
  );
  return out.join("\n");
}

interface DevtoArticleBody {
  article: {
    body_markdown: string;
    title?: string;
    published?: boolean;
    main_image?: string;
    tags?: string[];
  };
}

/**
 * Publish a Dev.to draft. When the markdown carries frontmatter we force
 * `published: false` and inject the cover image, then send the whole document so
 * Dev.to derives title/tags/series itself. Without frontmatter we build a
 * minimal article payload from `fallbackTitle`.
 */
export async function publishDevtoDraft(opts: {
  apiKey: string;
  markdown: string;
  coverImageUrl: string;
  fallbackTitle: string;
}): Promise<DevtoDraftResult> {
  const { apiKey, markdown, coverImageUrl, fallbackTitle } = opts;

  let payload: DevtoArticleBody;
  const split = splitFrontmatter(markdown);
  if (split) {
    let frontmatter = setFrontmatterField(split.frontmatter, "published", "false");
    // Always resolve cover_image one way or the other: a real hosted URL, or
    // remove the field. Never leave the generator's relative placeholder path
    // in place — Dev.to rejects anything that isn't an absolute URL.
    frontmatter = coverImageUrl
      ? setFrontmatterField(frontmatter, "cover_image", coverImageUrl)
      : removeFrontmatterField(frontmatter, "cover_image");
    payload = { article: { body_markdown: `${frontmatter}${split.body}` } };
  } else {
    payload = {
      article: {
        title: fallbackTitle,
        body_markdown: markdown,
        published: false,
        ...(coverImageUrl ? { main_image: coverImageUrl } : {}),
        tags: ["testing", "automation", "qa", "ai"],
      },
    };
  }

  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/vnd.forem.api-v1+json",
    },
    body: JSON.stringify(payload),
  });

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      isRecord(json) && typeof json.error === "string"
        ? json.error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }

  if (!isRecord(json) || typeof json.id !== "number" || typeof json.url !== "string") {
    throw new Error("Dev.to returned an unexpected response shape.");
  }

  return { url: json.url, id: json.id };
}
