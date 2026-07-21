import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import { excelManager } from "@/lib/excelManager";
import { logger } from "@/lib/logger";
import { DATA_DIR } from "@/lib/dataDir";
import { serializePublishStatus } from "@/lib/publishStatus";
import { publishDevtoDraft } from "@/lib/publishers/devto";
import {
  publishInstagramCarousel,
  publishInstagramPost,
} from "@/lib/publishers/instagram";
import { parseImagePaths } from "@/lib/imagePaths";
import { publishMediumDraft } from "@/lib/publishers/medium";
import { publishLinkedinPost } from "@/lib/publishers/linkedin";
import { uploadPublicImage } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A handful of Blob uploads plus the platform API calls. The Instagram carousel
// path creates and polls its slide containers concurrently, so the worst case is
// roughly two container waits (~60s ceiling) rather than one per slide.
export const maxDuration = 60;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * POST /api/publish — push a calendar row's content to a social platform. Two
 * platforms are supported; both run in two modes:
 *  - folder mode: the browser posts the content/key/image directly; nothing is
 *    read from or written back to the server filesystem.
 *  - local/server mode: the content is omitted, so the server reads the row,
 *    optionally hosts the generated image, and records the result back into the
 *    platform's publish-status column.
 *
 *  - "devto":     creates a *draft* (published:false) → state "in-review".
 *  - "instagram": publishes a LIVE feed post (Instagram has no draft) → state
 *                 "published". At least one image is mandatory; multiple slides
 *                 are posted as a carousel.
 *
 * The API key, access token, and image bytes are never logged.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const date = typeof body.date === "string" ? body.date.trim() : "";
    if (!date) {
      return NextResponse.json({ error: "Missing 'date'." }, { status: 400 });
    }

    const platform = typeof body.platform === "string" ? body.platform : "";
    if (
      platform !== "devto" &&
      platform !== "instagram" &&
      platform !== "medium" &&
      platform !== "linkedin"
    ) {
      return NextResponse.json(
        {
          error:
            "Only the 'devto', 'medium', 'instagram', and 'linkedin' platforms are supported.",
        },
        { status: 400 },
      );
    }

    if (platform === "instagram") {
      return await publishInstagram(date, body);
    }
    if (platform === "medium") {
      return await publishMedium(date, body);
    }
    if (platform === "linkedin") {
      return await publishLinkedin(date, body);
    }

    // ---- Dev.to draft -------------------------------------------------------
    // Folder mode supplies markdown directly; otherwise the server resolves it
    // from the workbook and persists the result afterward.
    const serverResolved = typeof body.markdown !== "string";

    // The row is needed in server mode for markdown + fallback title + image.
    const row = serverResolved ? await excelManager.getRowForDate(date) : null;

    const markdown =
      typeof body.markdown === "string" ? body.markdown : (row?.devto ?? "");
    if (!markdown.trim()) {
      return NextResponse.json(
        { error: `No Dev.to content for ${date}.` },
        { status: 400 },
      );
    }

    const apiKey =
      (typeof body.devtoApiKey === "string" ? body.devtoApiKey.trim() : "") ||
      process.env.DEVTO_API_KEY ||
      "";
    if (!apiKey) {
      return NextResponse.json(
        { error: "Dev.to API key missing. Add DEVTO_API_KEY." },
        { status: 400 },
      );
    }

    // Only used by the publisher when the markdown has no frontmatter title.
    const fallbackTitle = serverResolved
      ? row?.mediumTitle || row?.topic || ""
      : "";

    // Resolve cover image bytes: explicit base64 wins; in server mode fall back
    // to the day's generated medium PNG if it exists on disk.
    let bytes: Buffer | null = null;
    if (typeof body.imageBase64 === "string") {
      bytes = Buffer.from(body.imageBase64, "base64");
    } else if (serverResolved) {
      const imgPath = path.join(
        DATA_DIR,
        "images",
        `${date}-medium.png`,
      );
      try {
        bytes = await fs.readFile(imgPath);
      } catch {
        // No local cover image — proceed without one.
      }
    }

    let coverImageUrl = "";
    let note: string | undefined;
    if (bytes) {
      try {
        coverImageUrl = await uploadPublicImage(`${date}-medium.png`, bytes);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        note = "Draft created without a cover image (" + message + ").";
      }
    } else if (serverResolved) {
      note = "No cover image found.";
    }

    const { url } = await publishDevtoDraft({
      apiKey,
      markdown,
      coverImageUrl,
      fallbackTitle,
    });

    if (serverResolved) {
      await excelManager.updateRow(date, {
        devtoPublishStatus: serializePublishStatus({
          state: "in-review",
          url,
          at: new Date().toISOString(),
        }),
        lastUpdated: new Date().toISOString(),
      });
    }

    return NextResponse.json({ state: "in-review", url, note }, { status: 200 });
  } catch (err) {
    // Log the error only — never the apiKey or imageBase64.
    logger.error("POST /api/publish failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Publish failed" },
      { status: 500 },
    );
  }
}

/**
 * Save a Medium *draft* (image + article). Mirrors the Dev.to draft flow: the
 * card PNG is hosted on Vercel Blob and embedded as the feature image, and the
 * row lands in the "in-review" state. In server mode the markdown/title/token
 * come from the workbook + env + disk; in folder mode the browser supplies them.
 */
async function publishMedium(
  date: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  // Folder mode supplies markdown directly; otherwise resolve from the row.
  const serverResolved = typeof body.markdown !== "string";
  const row = serverResolved ? await excelManager.getRowForDate(date) : null;

  const markdown =
    typeof body.markdown === "string" ? body.markdown : (row?.medium ?? "");
  if (!markdown.trim()) {
    return NextResponse.json(
      { error: `No Medium content for ${date}.` },
      { status: 400 },
    );
  }

  const title =
    (typeof body.title === "string" ? body.title : "") ||
    row?.mediumTitle ||
    row?.topic ||
    "";

  const token =
    (typeof body.mediumToken === "string" ? body.mediumToken.trim() : "") ||
    process.env.MEDIUM_INTEGRATION_TOKEN ||
    "";
  if (!token) {
    return NextResponse.json(
      { error: "Medium integration token missing. Add MEDIUM_INTEGRATION_TOKEN." },
      { status: 400 },
    );
  }

  // Resolve cover image bytes: explicit base64 wins; in server mode fall back to
  // the day's generated medium PNG. The cover is optional for Medium.
  let bytes: Buffer | null = null;
  if (typeof body.imageBase64 === "string") {
    bytes = Buffer.from(body.imageBase64, "base64");
  } else if (serverResolved) {
    const imgPath = path.join(
      DATA_DIR,
      "images",
      `${date}-medium.png`,
    );
    try {
      bytes = await fs.readFile(imgPath);
    } catch {
      // No local cover image — proceed without one.
    }
  }

  let coverImageUrl = "";
  let note: string | undefined;
  if (bytes) {
    try {
      coverImageUrl = await uploadPublicImage(`${date}-medium.png`, bytes);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      note = "Draft created without a cover image (" + message + ").";
    }
  } else if (serverResolved) {
    note = "No cover image found.";
  }

  const { url } = await publishMediumDraft({
    token,
    title,
    markdown,
    coverImageUrl,
  });

  if (serverResolved) {
    await excelManager.updateRow(date, {
      mediumPublishStatus: serializePublishStatus({
        state: "in-review",
        url,
        at: new Date().toISOString(),
      }),
      lastUpdated: new Date().toISOString(),
    });
  }

  return NextResponse.json({ state: "in-review", url, note }, { status: 200 });
}

/**
 * Post LIVE to LinkedIn (card image + body, hashtags as the first comment).
 * LinkedIn has no usable draft for member posts, so this publishes immediately.
 * The image is uploaded directly to LinkedIn (not Blob); it is optional (a
 * text-only post is valid). In server mode text/hashtags/token come from the
 * workbook + env + disk; in folder mode the browser supplies them.
 */
async function publishLinkedin(
  date: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  // Folder mode supplies the text directly; otherwise resolve from the row.
  const serverResolved = typeof body.text !== "string";
  const row = serverResolved ? await excelManager.getRowForDate(date) : null;

  const text =
    typeof body.text === "string" ? body.text : (row?.linkedin ?? "");
  if (!text.trim()) {
    return NextResponse.json(
      { error: `No LinkedIn content for ${date}.` },
      { status: 400 },
    );
  }

  const hashtags =
    typeof body.hashtags === "string"
      ? body.hashtags
      : (row?.linkedinHashtags ?? "");

  const accessToken =
    (typeof body.linkedinAccessToken === "string"
      ? body.linkedinAccessToken.trim()
      : "") ||
    process.env.LINKEDIN_ACCESS_TOKEN ||
    "";
  if (!accessToken) {
    return NextResponse.json(
      { error: "LinkedIn access token missing. Add LINKEDIN_ACCESS_TOKEN." },
      { status: 400 },
    );
  }
  const memberSub =
    (typeof body.linkedinUserId === "string" ? body.linkedinUserId.trim() : "") ||
    process.env.LINKEDIN_USER_ID ||
    "";

  // Resolve image bytes — explicit base64 wins; in server mode fall back to the
  // day's LinkedIn card. Optional (a text-only post is allowed).
  let bytes: Buffer | null = null;
  if (typeof body.imageBase64 === "string") {
    bytes = Buffer.from(body.imageBase64, "base64");
  } else if (serverResolved) {
    const imgPath = path.join(
      DATA_DIR,
      "images",
      `${date}-linkedin.png`,
    );
    try {
      bytes = await fs.readFile(imgPath);
    } catch {
      // No local image — post text-only.
    }
  }

  const { url } = await publishLinkedinPost({
    accessToken,
    memberSub,
    imageBytes: bytes,
    text,
    hashtags,
  });

  if (serverResolved) {
    await excelManager.updateRow(date, {
      linkedinPublishStatus: serializePublishStatus({
        state: "published",
        url,
        at: new Date().toISOString(),
      }),
      lastUpdated: new Date().toISOString(),
    });
  }

  return NextResponse.json({ state: "published", url }, { status: 200 });
}

/**
 * Publish a LIVE Instagram feed post (images + caption) — a carousel when the day
 * has more than one slide, a single-image post otherwise. Instagram requires a
 * public image URL, so every slide PNG is hosted on Vercel Blob first. In server
 * mode the caption/token/images come from the workbook + env + disk and the
 * result is written into instagramPublishStatus; in folder mode the browser
 * supplies them and persists the column itself.
 */
async function publishInstagram(
  date: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  // Folder mode supplies the caption directly; otherwise resolve from the row.
  const serverResolved = typeof body.caption !== "string";
  const row = serverResolved ? await excelManager.getRowForDate(date) : null;

  const caption =
    typeof body.caption === "string" ? body.caption : (row?.instagram ?? "");
  if (!caption.trim()) {
    return NextResponse.json(
      { error: `No Instagram caption for ${date}.` },
      { status: 400 },
    );
  }

  const accessToken =
    (typeof body.instagramAccessToken === "string"
      ? body.instagramAccessToken.trim()
      : "") ||
    process.env.INSTAGRAM_ACCESS_TOKEN ||
    "";
  const igUserId =
    (typeof body.instagramUserId === "string" ? body.instagramUserId.trim() : "") ||
    process.env.INSTAGRAM_USER_ID ||
    "";
  // The access token is mandatory. The numeric account id is optional for
  // Instagram-Login tokens (the publisher resolves it from the token); it is
  // required for Facebook tokens, which the publisher enforces with a clear error.
  if (!accessToken) {
    return NextResponse.json(
      { error: "Instagram credentials missing. Add INSTAGRAM_ACCESS_TOKEN." },
      { status: 400 },
    );
  }

  // Resolve the slide bytes, in slide order. Folder mode posts them as base64
  // (imageBase64List for a carousel; the legacy scalar imageBase64 still works);
  // server mode reads the row's imageInstagram column off disk. Instagram cannot
  // post without at least one image.
  let slides: Buffer[] = [];
  if (Array.isArray(body.imageBase64List)) {
    slides = body.imageBase64List
      .filter((b): b is string => typeof b === "string" && b.length > 0)
      .map((b) => Buffer.from(b, "base64"));
  } else if (typeof body.imageBase64 === "string") {
    slides = [Buffer.from(body.imageBase64, "base64")];
  } else if (serverResolved) {
    const imagesDir = path.join(DATA_DIR, "images");
    // The column holds a JSON array for carousels and a bare path for single
    // images; parseImagePaths normalises both. Fall back to the legacy
    // `${date}-ig-1.png` guess for older rows that never populated it.
    const refs = parseImagePaths(row?.imageInstagram ?? "");
    const names =
      refs.length > 0 ? refs.map((r) => path.basename(r)) : [`${date}-ig-1.png`];
    for (const name of names) {
      try {
        slides.push(await fs.readFile(path.join(imagesDir, name)));
      } catch {
        // Skip a missing slide rather than failing the whole post.
        logger.warn(`Instagram slide not found on disk, skipping: ${name}`);
      }
    }
  }
  if (slides.length === 0) {
    return NextResponse.json(
      { error: "An Instagram image is required to publish, but none was found." },
      { status: 400 },
    );
  }

  // Instagram fetches each image by URL, so host every slide on Blob first.
  // uploadPublicImage sets addRandomSuffix, so repeated names never collide.
  let imageUrls: string[];
  try {
    imageUrls = await Promise.all(
      slides.map((b, i) => uploadPublicImage(`${date}-ig-${i + 1}.png`, b)),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Couldn't host the Instagram image: ${message}` },
      { status: 400 },
    );
  }

  const { url, note } =
    imageUrls.length > 1
      ? await publishInstagramCarousel({
          accessToken,
          igUserId,
          imageUrls,
          caption,
        })
      : await publishInstagramPost({
          accessToken,
          igUserId,
          imageUrl: imageUrls[0],
          caption,
        });

  if (serverResolved) {
    await excelManager.updateRow(date, {
      instagramPublishStatus: serializePublishStatus({
        state: "published",
        url,
        at: new Date().toISOString(),
      }),
      lastUpdated: new Date().toISOString(),
    });
  }

  return NextResponse.json({ state: "published", url, note }, { status: 200 });
}
