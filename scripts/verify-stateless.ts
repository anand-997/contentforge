// scripts/verify-stateless.ts
// Verifies the stateless (buffer) generation path: empty template workbook + keys
// in -> updated workbook + image buffers out, with NO writes to the repo
// filesystem. Also asserts the local context still wires to the singletons.
// Run: npx tsx scripts/verify-stateless.ts

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../lib/dataDir";
import { BufferExcelManager } from "../lib/excelBuffer";
import { createBufferContext, CollectedImageSink, createLocalContext } from "../lib/runContext";
import { excelManager } from "../lib/excelManager";
import { readConfig } from "../lib/configManager";
import { readDomainConfig } from "../lib/domainConfig";
import { readAgentPrompts } from "../lib/promptConfig";
import {
  agent1TopicGenerator,
  agent2ContentWriter,
  agent3ImageGenerator,
} from "../lib/agents";

try {
  const raw = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const l of raw.split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* ignore */ }

function snapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  const xlsx = path.join(DATA_DIR, "content_calendar.xlsx");
  if (fs.existsSync(xlsx)) out["content_calendar.xlsx"] = fs.statSync(xlsx).mtimeMs;
  const imgDir = path.join(DATA_DIR, "images");
  if (fs.existsSync(imgDir)) {
    for (const f of fs.readdirSync(imgDir)) {
      out[`images/${f}`] = fs.statSync(path.join(imgDir, f)).mtimeMs;
    }
  }
  return out;
}

async function main(): Promise<void> {
  // --- Regression: local context still points at the real singletons/env ---
  const local = createLocalContext();
  console.log("Local wiring OK:",
    local.excel === excelManager,
    "| deepseek key from env:", local.creds.deepseekApiKey === (process.env.DEEPSEEK_API_KEY ?? undefined));

  // --- Stateless run on an empty template workbook ---
  const before = snapshot();

  const config = readConfig();
  config.knowledge.enabled = false; // deployed mode has no local corpus
  const domain = readDomainConfig();
  const prompts = readAgentPrompts();

  const mgr = await BufferExcelManager.fromBuffer(null);
  await mgr.ensureFileExists();
  const sink = new CollectedImageSink();
  const ctx = createBufferContext({
    creds: {
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
    },
    config,
    domain,
    prompts,
    excel: mgr,
    images: sink,
  });

  console.log("\nRunning stateless pipeline (in-memory)...");
  await agent1TopicGenerator(ctx);
  const { failed } = await agent2ContentWriter(ctx);
  if (failed.length === 0) await agent3ImageGenerator(ctx);

  const updated = await mgr.toBuffer();

  // Reload the returned buffer to prove the data round-trips.
  const reloaded = await BufferExcelManager.fromBuffer(updated);
  const row = await reloaded.getTodayRow();

  const after = snapshot();
  const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
  const added = Object.keys(after).filter((k) => !(k in before));

  console.log("\n=== RESULT ===");
  console.log("Updated workbook bytes:", updated.length);
  console.log("Today row present:", row !== null, "| status:", row?.status);
  console.log("LinkedIn first line:", JSON.stringify((row?.linkedin ?? "").split("\n")[0].slice(0, 90)));
  console.log("Images returned:", sink.images.length, sink.images.map((i) => `${i.name}:${i.buffer.length}b`).join(", "));
  console.log("Failed platforms:", failed.length === 0 ? "none" : failed.join(", "));
  console.log("\nRepo filesystem changes during stateless run:",
    changed.length === 0 && added.length === 0
      ? "NONE (correct)"
      : `CHANGED=${changed.join(",")} ADDED=${added.join(",")}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
