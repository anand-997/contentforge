import path from "node:path";
import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { DATA_DIR } from "@/lib/dataDir";

export const dynamic = "force-dynamic";

const FILE_NAME = "content_calendar.xlsx";

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

export async function GET(): Promise<Response> {
  const filePath = path.join(DATA_DIR, FILE_NAME);

  try {
    const data = await readFile(filePath);
    // Copy into a fresh ArrayBuffer-backed view so the body is a valid BodyInit.
    const body = new Uint8Array(data);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${FILE_NAME}"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    if (isMissingFileError(err)) {
      logger.warn(`GET /api/download — ${FILE_NAME} not found`);
      return NextResponse.json(
        { error: "Calendar file not found" },
        { status: 404 },
      );
    }

    logger.error("GET /api/download failed", err);
    return NextResponse.json(
      { error: "Failed to download calendar" },
      { status: 500 },
    );
  }
}
