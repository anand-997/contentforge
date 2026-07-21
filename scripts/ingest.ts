// scripts/ingest.ts
// Build (or incrementally refresh) the learnings knowledge index.
//   npm run ingest          incremental (skips unchanged files)
//   npm run ingest -- --force   full rebuild
//
// Extraction is local/code + OCR; only unreadable images may use a vision call
// (needs OPENAI_API_KEY). The corpus is never sent to the LLM wholesale.

import fs from "fs";
import path from "path";
import { readConfig } from "../lib/configManager";
import { buildIndex } from "../lib/knowledge/index";

// Load .env so OCR vision fallback (OpenAI) has its key during CLI runs.
try {
  const raw = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  /* no .env — fine, OCR still works without vision */
}

async function main(): Promise<void> {
  const cfg = readConfig().knowledge;
  const force = process.argv.includes("--force");
  console.log(`Ingesting "${cfg.folder}" (force=${force}, ocrImages=${cfg.ocrImages}, vision=${cfg.visionFallback})...`);

  const summary = await buildIndex(cfg, {
    force,
    onProgress: (done, total, file) => {
      if (done % 5 === 0 || done === total) {
        const line = `[${done}/${total}] ${file}`.slice(0, 100).padEnd(100);
        process.stdout.write(`\r${line}`);
      }
    },
  });

  console.log("\n\nDone:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("\nIngestion failed:", err);
  process.exit(1);
});
