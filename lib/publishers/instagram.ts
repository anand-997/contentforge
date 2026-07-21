// lib/publishers/instagram.ts
// Publishes a feed post to Instagram — either a single image
// (`publishInstagramPost`) or a multi-slide carousel (`publishInstagramCarousel`).
// Instagram has no draft concept — both are immediate, live publishes that create
// one or more media containers and then publish them. Every image must be a
// publicly reachable URL (we host the card PNGs on Vercel Blob first). No `any`.
//
// Two token flavors are supported, detected by prefix:
//  - "IG..."  → Instagram API *with Instagram Login*. Host graph.instagram.com,
//               no Facebook Page required. The numeric account id is resolved
//               from /me?fields=user_id when not supplied as a number.
//  - "EAA..." → Instagram Graph API *via Facebook Login*. Host graph.facebook.com,
//               requires the IG business account linked to a Facebook Page and a
//               numeric IG user id.

export interface InstagramPublishResult {
  /** The live post permalink (best-effort; falls back to instagram.com). */
  url: string;
  /** The published media id. */
  id: string;
  /** Set when something worth surfacing happened (e.g. slides were trimmed). */
  note?: string;
}

/** Instagram rejects carousels outside 2..10 items. */
const MAX_CAROUSEL_ITEMS = 10;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Pull the Graph API error message out of a non-2xx JSON body, if present. */
function graphErrorMessage(json: unknown, status: number): string {
  if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") {
    return json.error.message;
  }
  return `Instagram API error (HTTP ${status}).`;
}

/** Instagram-Login tokens start with "IG"; Facebook tokens with "EAA". */
function isInstagramLoginToken(token: string): boolean {
  return token.startsWith("IG");
}

const NUMERIC = /^[0-9]+$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a freshly-created media container until Instagram has finished fetching
 * the image (`status_code: FINISHED`). Publishing before then yields the
 * "Media ID is not available" error, so this gate is required. Throws on ERROR
 * / EXPIRED or if it never finishes within the budget.
 */
async function waitForContainerReady(
  base: string,
  creationId: string,
  accessToken: string,
): Promise<void> {
  // ~30s budget (15 × 2s) — well under the route's 60s maxDuration. A small
  // image on Blob is usually FINISHED within a few seconds.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await sleep(2000);
    const res = await fetch(
      `${base}/${creationId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
    );
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(graphErrorMessage(json, res.status));
    }
    const status =
      isRecord(json) && typeof json.status_code === "string"
        ? json.status_code
        : "";
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(
        `Instagram could not process the image (status: ${status}). ` +
          "Check that the image URL is public and a supported size/format.",
      );
    }
    // IN_PROGRESS (or unknown) → keep polling.
  }
  throw new Error(
    "Instagram is still processing the image after 30s. Please try publishing again.",
  );
}

/**
 * Resolve the numeric account id for an Instagram-Login token. The id the
 * content-publishing endpoints expect is the `user_id` field of /me.
 */
async function resolveInstagramUserId(
  base: string,
  accessToken: string,
): Promise<string> {
  const res = await fetch(
    `${base}/me?fields=user_id&access_token=${encodeURIComponent(accessToken)}`,
  );
  const json: unknown = await res.json().catch(() => null);
  if (res.ok && isRecord(json) && typeof json.user_id === "string") {
    return json.user_id;
  }
  // Some responses surface the account id as `id` instead of `user_id`.
  if (res.ok && isRecord(json) && typeof json.id === "string") {
    return json.id;
  }
  throw new Error(graphErrorMessage(json, res.status));
}

/**
 * Work out the Graph host and the numeric account id — identical for the
 * single-image and carousel flows, so both entry points start here.
 */
async function resolveGraphContext(
  accessToken: string,
  suppliedUserId: string,
  graphVersion?: string,
): Promise<{ base: string; igUserId: string }> {
  const v = graphVersion ?? process.env.IG_GRAPH_VERSION ?? "v21.0";
  const igLogin = isInstagramLoginToken(accessToken);
  const base = igLogin
    ? `https://graph.instagram.com/${v}`
    : `https://graph.facebook.com/${v}`;

  // Determine the numeric account id. A supplied numeric id always wins;
  // otherwise resolve it from the token (Instagram-Login only).
  let igUserId = suppliedUserId.trim();
  if (!NUMERIC.test(igUserId)) {
    if (igLogin) {
      igUserId = await resolveInstagramUserId(base, accessToken);
    } else {
      throw new Error(
        "INSTAGRAM_USER_ID must be your numeric Instagram account id (not your @username). " +
          "Find it via the Graph API Explorer, then update credentials.env.",
      );
    }
  }
  return { base, igUserId };
}

/**
 * POST /{ig-user-id}/media with an arbitrary payload and return the container id.
 * Used for single-image posts, carousel children, and the carousel parent alike.
 */
async function createMediaContainer(
  base: string,
  igUserId: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${base}/${igUserId}/media`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, access_token: accessToken }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok || !isRecord(json) || typeof json.id !== "string") {
    throw new Error(graphErrorMessage(json, res.status));
  }
  return json.id;
}

/** POST /{ig-user-id}/media_publish — takes the container live, returns media id. */
async function publishContainer(
  base: string,
  igUserId: string,
  accessToken: string,
  creationId: string,
): Promise<string> {
  const res = await fetch(`${base}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok || !isRecord(json) || typeof json.id !== "string") {
    throw new Error(graphErrorMessage(json, res.status));
  }
  return json.id;
}

/** Best-effort permalink lookup — never fails the publish; the post is already live. */
async function fetchPermalink(
  base: string,
  mediaId: string,
  accessToken: string,
): Promise<string> {
  try {
    const res = await fetch(
      `${base}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`,
    );
    const json: unknown = await res.json().catch(() => null);
    if (res.ok && isRecord(json) && typeof json.permalink === "string") {
      return json.permalink;
    }
  } catch {
    // Fall through to the generic URL.
  }
  return "https://www.instagram.com/";
}

/**
 * Publish `imageUrl` + `caption` as a live single-image Instagram feed post.
 *
 * Three API calls:
 *  1. POST /{ig-user-id}/media           → creation_id (a media container)
 *  2. POST /{ig-user-id}/media_publish   → media_id (goes live)
 *  3. GET  /{media-id}?fields=permalink  → the live URL (best-effort)
 *
 * Any non-2xx in steps 1–2 throws with the API `error.message`.
 */
export async function publishInstagramPost(opts: {
  accessToken: string;
  igUserId: string;
  imageUrl: string;
  caption: string;
  graphVersion?: string;
}): Promise<InstagramPublishResult> {
  const { accessToken, imageUrl, caption } = opts;
  const { base, igUserId } = await resolveGraphContext(
    accessToken,
    opts.igUserId,
    opts.graphVersion,
  );

  // Step 1 — create the media container.
  const creationId = await createMediaContainer(base, igUserId, accessToken, {
    image_url: imageUrl,
    caption,
  });

  // Between create and publish: wait until Instagram has fetched + processed the
  // image. Publishing too early returns "Media ID is not available".
  await waitForContainerReady(base, creationId, accessToken);

  // Step 2 — publish the container.
  const mediaId = await publishContainer(base, igUserId, accessToken, creationId);

  // Step 3 — resolve the permalink.
  return { url: await fetchPermalink(base, mediaId, accessToken), id: mediaId };
}

/**
 * Publish `imageUrls` + `caption` as a live multi-slide Instagram carousel, in
 * array order. This is the four-step carousel flow:
 *
 *  1. POST /{ig-user-id}/media × N       → child containers (is_carousel_item,
 *                                           NO caption — the caption is the
 *                                           parent's), created concurrently
 *  2. poll every child to FINISHED       → concurrently, so the wall-clock cost is
 *                                           one container's wait, not N of them
 *  3. POST /{ig-user-id}/media           → the CAROUSEL parent (children + caption)
 *  4. POST /{ig-user-id}/media_publish   → goes live
 *
 * Instagram requires 2..10 items: a single URL is delegated to
 * `publishInstagramPost`, and anything past the 10th slide is dropped with a note.
 */
export async function publishInstagramCarousel(opts: {
  accessToken: string;
  igUserId: string;
  imageUrls: string[];
  caption: string;
  graphVersion?: string;
}): Promise<InstagramPublishResult> {
  const { accessToken, caption } = opts;

  if (opts.imageUrls.length === 0) {
    throw new Error("An Instagram carousel needs at least one image.");
  }
  // A one-item carousel is invalid — publish it as a normal single-image post.
  if (opts.imageUrls.length === 1) {
    return publishInstagramPost({
      accessToken,
      igUserId: opts.igUserId,
      imageUrl: opts.imageUrls[0],
      caption,
      graphVersion: opts.graphVersion,
    });
  }

  const dropped = Math.max(0, opts.imageUrls.length - MAX_CAROUSEL_ITEMS);
  const imageUrls = opts.imageUrls.slice(0, MAX_CAROUSEL_ITEMS);

  const { base, igUserId } = await resolveGraphContext(
    accessToken,
    opts.igUserId,
    opts.graphVersion,
  );

  // Step 1 — create every child container. Promise.all preserves input order,
  // which is the slide order the reader swipes through.
  const childIds = await Promise.all(
    imageUrls.map((image_url) =>
      createMediaContainer(base, igUserId, accessToken, {
        image_url,
        is_carousel_item: true,
      }),
    ),
  );

  // Step 2 — wait for Instagram to fetch + process each slide, concurrently.
  await Promise.all(
    childIds.map((id) => waitForContainerReady(base, id, accessToken)),
  );

  // Step 3 — create the carousel parent. The caption lives here, not on children.
  const parentId = await createMediaContainer(base, igUserId, accessToken, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
  });
  await waitForContainerReady(base, parentId, accessToken);

  // Step 4 — publish the parent.
  const mediaId = await publishContainer(base, igUserId, accessToken, parentId);

  return {
    url: await fetchPermalink(base, mediaId, accessToken),
    id: mediaId,
    note:
      dropped > 0
        ? `Instagram allows at most ${MAX_CAROUSEL_ITEMS} slides — the last ${dropped} were not posted.`
        : undefined,
  };
}
