// lib/publishers/medium.ts
// Creates a Medium *draft* (publishStatus:"draft") from a row's Medium article via
// the Medium API. The article body has no H1 (the title is stored separately), so
// we prepend the title as an H1 and embed the hosted cover image at the top —
// Medium uses the first in-body image as the post's feature image. No `any`.
//
// NOTE: Medium deprecated its Integration Token API. This works only for accounts
// that already hold a valid integration token.

export interface MediumDraftResult {
  url: string;
  id: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Pull the Medium error message out of a non-2xx JSON body, if present. */
function mediumErrorMessage(json: unknown, status: number): string {
  if (
    isRecord(json) &&
    Array.isArray(json.errors) &&
    isRecord(json.errors[0]) &&
    typeof json.errors[0].message === "string"
  ) {
    return json.errors[0].message;
  }
  return `Medium API error (HTTP ${status}).`;
}

const MEDIUM_API = "https://api.medium.com/v1";

const DEFAULT_TAGS = ["testing", "automation", "qa", "software-testing", "career"];

/**
 * Publish a Medium draft. Resolves the author id from the token, assembles the
 * markdown (title H1 + optional cover image + body), and posts it with
 * `publishStatus: "draft"` so it lands in the user's Medium drafts.
 */
export async function publishMediumDraft(opts: {
  token: string;
  title: string;
  markdown: string;
  coverImageUrl: string;
  tags?: string[];
}): Promise<MediumDraftResult> {
  const { token, title, markdown, coverImageUrl } = opts;
  const tags = (opts.tags ?? DEFAULT_TAGS).slice(0, 5);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Charset": "utf-8",
  };

  // Step 1 — resolve the author id.
  const meRes = await fetch(`${MEDIUM_API}/me`, { headers });
  const meJson: unknown = await meRes.json().catch(() => null);
  if (!meRes.ok) {
    throw new Error(mediumErrorMessage(meJson, meRes.status));
  }
  if (
    !isRecord(meJson) ||
    !isRecord(meJson.data) ||
    typeof meJson.data.id !== "string"
  ) {
    throw new Error("Medium returned an unexpected /me response shape.");
  }
  const authorId = meJson.data.id;

  // Assemble the post markdown: title H1, optional cover image, then the body.
  const parts: string[] = [];
  if (title.trim()) parts.push(`# ${title.trim()}`);
  if (coverImageUrl) parts.push(`![${title.trim()}](${coverImageUrl})`);
  parts.push(markdown);
  const content = parts.join("\n\n");

  // Step 2 — create the draft.
  const postRes = await fetch(`${MEDIUM_API}/users/${authorId}/posts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title,
      contentFormat: "markdown",
      content,
      tags,
      publishStatus: "draft",
      notifyFollowers: false,
    }),
  });
  const postJson: unknown = await postRes.json().catch(() => null);
  if (!postRes.ok) {
    throw new Error(mediumErrorMessage(postJson, postRes.status));
  }
  if (
    !isRecord(postJson) ||
    !isRecord(postJson.data) ||
    typeof postJson.data.id !== "string" ||
    typeof postJson.data.url !== "string"
  ) {
    throw new Error("Medium returned an unexpected post response shape.");
  }

  return { url: postJson.data.url, id: postJson.data.id };
}
