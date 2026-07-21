// scripts/dryrun.ts
// Dry run of the weekday-themed, learnings-grounded pipeline for 3 days
// (Mon/Tue/Wed). No publishing, no Excel writes. Exercises the real
// weeklyConfig, knowledge retrieval, voiceEngine (brand voice layer), and the
// deterministic image renderer. Requires a built index (npm run ingest or the
// text-only verify build). Run: npx tsx scripts/dryrun.ts

import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { DATA_DIR } from "../lib/dataDir";
import { readDomainConfig } from "../lib/domainConfig";
import { themeForDay, voiceForDay } from "../lib/weeklyConfig";
import { retrieveForTheme } from "../lib/knowledge/index";
import {
  buildSystemPrompt,
  buildFewShotMessages,
  type SystemPromptOptions,
} from "../lib/voiceEngine";
import { renderCard, deriveHeadline } from "../lib/imageTemplate";
import { firstLine } from "../lib/similarity";
import { readConfig } from "../lib/configManager";
import type {
  ContentPillar,
  HookArchetype,
  PostStructure,
} from "../lib/types";

try {
  const raw = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const l of raw.split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* ignore */ }

const config = readConfig();
const domain = readDomainConfig();
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: config.models.deepseekBaseUrl,
});

// Per-day variety choices (Agent 1 normally rotates these from history).
const PLAN: Array<{ structure: PostStructure; hook: HookArchetype }> = [
  { structure: "story", hook: "confession" },
  { structure: "numbered-insight", hook: "contrarian" },
  { structure: "contrast", hook: "you-callout" },
];

function extractJson(text: string): string {
  const t = text.replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  return s !== -1 && e > s ? t.slice(s, e + 1) : t;
}

async function briefDetails(
  topic: string,
  excerpt: string,
): Promise<{ persona: string; facts: string[] }> {
  const prompt = `Prepare a content brief from this real study note.
Topic: "${topic}"
Note excerpt:
"""${excerpt.slice(0, 1200)}"""
Return ONLY minified JSON: {"readerPersona":"<one specific reader>","canonicalFacts":["<short fact from the note>"]}
Facts must come from the note. 1 to 4 facts.`;
  try {
    const c = await client.chat.completions.create({
      model: config.models.deepseekModel,
      max_tokens: 600,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = JSON.parse(extractJson(c.choices[0]?.message?.content ?? "{}")) as {
      readerPersona?: unknown;
      canonicalFacts?: unknown;
    };
    const persona = typeof parsed.readerPersona === "string" ? parsed.readerPersona : "";
    const facts = Array.isArray(parsed.canonicalFacts)
      ? parsed.canonicalFacts.filter((f): f is string => typeof f === "string").slice(0, 4)
      : [];
    return { persona, facts };
  } catch {
    return { persona: "", facts: [] };
  }
}

async function generate(
  pillar: ContentPillar,
  structure: PostStructure,
  platform: string,
  opts: SystemPromptOptions,
  userPrompt: string,
): Promise<string> {
  const system = buildSystemPrompt(pillar, structure, platform, opts);
  const c = await client.chat.completions.create({
    model: config.models.deepseekModel,
    max_tokens: config.models.maxTokensPerCall,
    temperature: config.models.temperatureContent,
    messages: [
      { role: "system", content: system },
      ...buildFewShotMessages(pillar, opts.hasRealMaterial),
      { role: "user", content: userPrompt },
    ],
  });
  return (c.choices[0]?.message?.content ?? "").trim();
}

async function main(): Promise<void> {
  const usedSources: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const date = new Date(2026, 5, 15 + i); // Mon/Tue/Wed
    const { day, theme } = themeForDay(date);
    const { voice } = voiceForDay(date);
    const domainPillars = domain.pillars.length > 0
      ? domain.pillars
      : [{ id: "general", name: "General", weight: 1, keywords: [], toneHint: "" }];
    const pillar =
      domainPillars.find((p) => p.id === theme.pillar) ?? domainPillars[0];
    const { structure, hook } = PLAN[i];

    const src = await retrieveForTheme(theme.keywords, theme.learningTags, usedSources);
    const sourceTitle = src ? src.entry.title : "(no learnings match — concept-level)";
    if (src) usedSources.push(src.entry.id);
    const excerpt = src?.entry.excerpt ?? "";

    const topicSeed = excerpt
      ? `Based on the note "${src?.entry.title}", an angle a senior QA engineer would post about`
      : theme.theme;
    const topicResp = await client.chat.completions.create({
      model: config.models.deepseekModel,
      max_tokens: 60,
      temperature: 0.9,
      messages: [{
        role: "user",
        content: `Theme: ${theme.theme}. ${topicSeed}. Note excerpt:\n"""${excerpt.slice(0, 700)}"""\nReturn ONE specific post title (no quotes, no "Why Your", no trailing punctuation).`,
      }],
    });
    const topic = (topicResp.choices[0]?.message?.content ?? theme.theme)
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?]+$/g, "")
      .trim();

    const { persona, facts } = excerpt
      ? await briefDetails(topic, excerpt)
      : { persona: "", facts: [] };

    const opts: SystemPromptOptions = {
      hookArchetype: hook,
      readerPersona: persona,
      canonicalFacts: facts,
      hasRealMaterial: facts.length > 0,
      brandVoice: voice,
    };

    const li = await generate(
      pillar, structure, "LinkedIn", opts,
      `Write a LinkedIn post about: "${topic}". 150-200 words. Open with the assigned HOOK. Use only the canonical facts. Fresh reply-inviting closer (no "PS", no "Save this"). Body only, zero hashtags.`,
    );
    const ig = await generate(
      pillar, structure, "Instagram", opts,
      `Write an Instagram caption about: "${topic}". Hook line, then short lines, then a CTA that invites a reply (vary it, no "Save this"), then 5 hashtags. Use only the canonical facts.`,
    );

    const headline = deriveHeadline(firstLine(li), topic);
    const png = await renderCard({
      kicker: `${domain.brand.name.toUpperCase()} | ${pillar.name.toUpperCase()}`,
      headline,
      subline: topic,
      footerLeft: theme.theme,
      handle: domain.brand.handle,
      width: 1200,
      height: 627,
      colors: domain.brand.imageColors,
    });
    const out = path.join(DATA_DIR, "images", `_dryrun-${day}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png);

    console.log(`\n\n################# DAY ${i + 1}: ${day.toUpperCase()} #################`);
    console.log(`Theme: ${theme.theme} | Pillar: ${pillar.id} | Voice: ${voice.name} | Structure: ${structure} | Hook: ${hook}`);
    console.log(`Learnings source: ${sourceTitle}`);
    console.log(`Reader: ${persona || "(none)"}`);
    console.log(`Canonical facts (${facts.length}):`);
    facts.forEach((f) => console.log("   - " + f));
    console.log(`Topic: ${topic}`);
    console.log(`\n----- LINKEDIN -----\n${li}`);
    console.log(`\n----- INSTAGRAM -----\n${ig}`);
    console.log(`\nImage headline: ${JSON.stringify(headline)}  -> ${out} (${png.length} bytes)`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
