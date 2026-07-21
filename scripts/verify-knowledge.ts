// scripts/verify-knowledge.ts — verification only (no publishing, no config edits).
// 1) text-only index build (fast, free), 2) OCR one image, 3) OCR one scanned PDF.

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../lib/dataDir";
import { readConfig } from "../lib/configManager";
import { buildIndex, readIndex } from "../lib/knowledge/index";
import { extractFile } from "../lib/knowledge/extractors";

try {
  const raw = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const l of raw.split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* ignore */ }

function findFirst(dir: string, test: (f: string) => boolean): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith("~$") || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFirst(full, test);
      if (r) return r;
    } else if (test(full)) {
      return full;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const cfg = readConfig().knowledge;
  const root = path.join(DATA_DIR, cfg.folder);

  console.log("=== 1) TEXT-ONLY INDEX BUILD (no OCR/vision) ===");
  const summary = await buildIndex(
    { ...cfg, ocrImages: false, ocrScannedPdfs: false, visionFallback: false },
    { force: true },
  );
  console.log(JSON.stringify(summary, null, 2));
  const idx = await readIndex();
  console.log("\nSample entries with extracted text:");
  (idx?.entries ?? [])
    .filter((e) => e.charCount > 400 && e.type !== "image")
    .slice(0, 5)
    .forEach((e) =>
      console.log(`  - [${e.type}] ${e.title} | ${e.charCount} chars | kw: ${e.keywords.slice(0, 6).join(", ")}`),
    );

  console.log("\n=== 2) OCR SANITY: one image (Tesseract, no tokens) ===");
  const img = findFirst(root, (f) => /\.(png|jpe?g)$/i.test(f));
  if (img) {
    console.log("image:", path.relative(root, img));
    const r = await extractFile(img, { ...cfg, visionFallback: false });
    console.log(`ocrUsed=${r.ocrUsed} chars=${r.text.length}`);
    console.log("text sample:", JSON.stringify(r.text.replace(/\s+/g, " ").slice(0, 220)));
  } else {
    console.log("no image found");
  }

  console.log("\n=== 3) SCANNED-PDF SANITY: one scan (raster + OCR, 1 page) ===");
  const scan = findFirst(root, (f) => /scan.*\.pdf$/i.test(f));
  if (scan) {
    console.log("pdf:", path.relative(root, scan));
    const r = await extractFile(scan, { ...cfg, ocrScannedPdfs: true, visionFallback: false, maxOcrPages: 1 });
    console.log(`ocrUsed=${r.ocrUsed} scanned=${r.scanned} chars=${r.text.length}`);
    console.log("text sample:", JSON.stringify(r.text.replace(/\s+/g, " ").slice(0, 220)));
  } else {
    console.log("no scanned pdf found");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
