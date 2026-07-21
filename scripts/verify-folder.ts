// scripts/verify-folder.ts — verify folder-mode server paths (no publishing).
// 1) extractBuffer on a real PDF + DOCX (in-memory, no tokens).
// 2) folder-mode generation with theme/voice/material/history overrides; confirm
//    grounding + no repo filesystem writes.

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../lib/dataDir";
import { readConfig } from "../lib/configManager";
import { readDomainConfig } from "../lib/domainConfig";
import { readAgentPrompts } from "../lib/promptConfig";
import { extractBuffer } from "../lib/knowledge/extractors";
import {
  BufferExcelManager,
} from "../lib/excelBuffer";
import {
  createBufferContext,
  CollectedImageSink,
} from "../lib/runContext";
import { agent1TopicGenerator, agent2ContentWriter } from "../lib/agents";
import type { BrandVoice, GenerationLogEntry, WeeklyTheme } from "../lib/types";

try {
  const raw = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const l of raw.split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* ignore */ }

function snapshot(): Set<string> {
  const out = new Set<string>();
  const xlsx = path.join(DATA_DIR, "content_calendar.xlsx");
  if (fs.existsSync(xlsx)) out.add("content_calendar.xlsx:" + fs.statSync(xlsx).mtimeMs);
  const imgDir = path.join(DATA_DIR, "images");
  if (fs.existsSync(imgDir)) {
    for (const f of fs.readdirSync(imgDir)) out.add("img:" + f + ":" + fs.statSync(path.join(imgDir, f)).mtimeMs);
  }
  return out;
}

async function main(): Promise<void> {
  const cfg = readConfig().knowledge;

  console.log("=== 1) extractBuffer (in-memory, code-only) ===");
  const pdf = "my_learnings/manual-and-automation-testing-21may22batch-20260617T155206Z-3-001/manual-and-automation-testing-21may22batch/Utility/UtilityClass.pdf";
  const docx = "my_learnings/manual-and-automation-testing-21may22batch-20260617T155206Z-3-001/manual-and-automation-testing-21may22batch/Rest assured/TokenizedAuthorization.docx";
  for (const rel of [pdf, docx]) {
    const bytes = fs.readFileSync(path.join(process.cwd(), rel));
    const r = await extractBuffer(path.basename(rel), bytes, { ...cfg, ocrScannedPdfs: false, visionFallback: false });
    console.log(`  ${path.basename(rel)} -> type=${r.type} chars=${r.text.length} sample=${JSON.stringify(r.text.replace(/\s+/g, " ").slice(0, 120))}`);
  }

  console.log("\n=== 2) folder-mode generation with overrides ===");
  const before = snapshot();

  const theme: WeeklyTheme = {
    theme: "Cypress E2E reliability",
    keywords: ["cypress", "flaky tests", "cy.intercept"],
    pillar: "automation",
    learningTags: [],
    knowledgeFiles: ["cypress.pdf"],
  };
  const voice: BrandVoice = {
    name: "The Mentor",
    persona: "A senior QA engineer mentoring a junior one-on-one. Calm, direct.",
    toneDirectives: ["Teach one concrete lesson.", "No hype.", "Actionable nugget."],
  };
  const material =
    'From my notes (cypress.pdf): Cypress retries the last query+assertion for up to 4 seconds (defaultCommandTimeout) before failing. cy.intercept() stubs network so a test does not depend on a live backend. A login spec went flaky after a CI bump; the cause was an un-awaited XHR, fixed with cy.intercept + cy.wait("@login").';
  const history: GenerationLogEntry[] = [
    { date: "2026-06-16", topic: "Why your Selenium waits are lying to you", pillar: "automation", structure: "contrast", hookArchetype: "contrarian", hook: "You think implicit waits make tests stable.", closer: "What does your CI never simulate?" },
  ];

  const config = readConfig();
  config.knowledge.enabled = false;
  const domain = readDomainConfig();
  const prompts = readAgentPrompts();
  const mgr = await BufferExcelManager.fromBuffer(null);
  await mgr.ensureFileExists();
  const sink = new CollectedImageSink();
  const ctx = createBufferContext({
    creds: { deepseekApiKey: process.env.DEEPSEEK_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY },
    config, domain, prompts, excel: mgr, images: sink, theme, voice, material, history,
  });

  await agent1TopicGenerator(ctx);
  const failed = await agent2ContentWriter(ctx);
  const row = await mgr.getTodayRow();

  const after = snapshot();
  const changed = [...after].filter((x) => !before.has(x)).concat([...before].filter((x) => !after.has(x)));

  console.log("Topic:", row?.topic);
  console.log("LinkedIn first line:", JSON.stringify((row?.linkedin ?? "").split("\n")[0].slice(0, 120)));
  const li = (row?.linkedin ?? "").toLowerCase();
  console.log("Grounded in material? mentions cypress:", li.includes("cypress"), "| 4 second/defaultCommandTimeout:", li.includes("4 second") || li.includes("defaultcommandtimeout") || li.includes("cy.intercept"));
  console.log("Failed platforms:", failed.length === 0 ? "none" : failed.join(", "));
  console.log("Repo filesystem changes:", changed.length === 0 ? "NONE (correct)" : changed.join(", "));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
