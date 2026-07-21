// lib/blob.ts
// Uploads a PNG to Vercel Blob so Dev.to (and other publishers) can reference a
// publicly hosted cover image. Token is read from the environment at call time.
// No `any` anywhere.

import { put } from "@vercel/blob";

/**
 * Upload `bytes` as a public PNG and return its hosted URL. A random suffix is
 * added so repeated uploads of the same logical name never collide.
 */
export async function uploadPublicImage(
  name: string,
  bytes: Buffer,
): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  }
  const blob = await put(name, bytes, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: true,
    token,
  });
  return blob.url;
}
