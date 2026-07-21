// app/api/images/[filename]/route.ts
// Serves local-mode generated images. Images live under DATA_DIR/images (see
// lib/dataDir.ts), outside the Next.js public/ directory — moved there so app
// code and user-generated content stay separate — so they can no longer be
// served as static files and need this route instead.

import path from "node:path";
import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { DATA_DIR } from "@/lib/dataDir";

export const dynamic = "force-dynamic";

const IMAGES_DIR = path.join(DATA_DIR, "images");

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

interface NodeError {
  code?: string;
}

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeError).code === "ENOENT"
  );
}

export async function GET(
  _req: Request,
  { params }: { params: { filename: string } },
): Promise<Response> {
  // path.basename strips any directory traversal segments — only a bare
  // filename inside IMAGES_DIR is ever readable through this route.
  const filename = path.basename(params.filename);
  const ext = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext];

  if (!contentType) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }

  try {
    const data = await readFile(path.join(IMAGES_DIR, filename));
    const body = new Uint8Array(data);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    if (isMissingFileError(err)) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    logger.error(`GET /api/images/${filename} failed`, err);
    return NextResponse.json({ error: "Failed to load image" }, { status: 500 });
  }
}
