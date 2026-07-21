// lib/runContext.ts
// Run context that lets the agents work against injected state instead of
// reaching for globals. This is ADDITIVE: createLocalContext() reproduces the
// exact current behavior (process.env keys, the file-backed ExcelManager
// singleton, public/images writes, on-disk briefs/config), so existing callers
// are unaffected. createBufferContext() backs a stateless, in-memory run for the
// deployed "bring your own folder" mode.

import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "./dataDir";
import { readConfig, writeConfig } from "./configManager";
import { readDomainConfig } from "./domainConfig";
import { readAgentPrompts, type AgentPrompts } from "./promptConfig";
import { excelManager } from "./excelManager";
import { readBrief, writeBrief, readRecentBriefs } from "./brief";
import type { ExcelAccessor } from "./excelSchema";
import type {
  BrandVoice,
  ContentBrief,
  ContentDomainConfig,
  ContentForgeConfig,
  GenerationLogEntry,
  WeeklyTheme,
} from "@/lib/types";

export interface RunCreds {
  deepseekApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  /** Optional web-search key (Tavily) for the research-grounding step. */
  tavilyApiKey?: string;
}

// Where Agent 3 puts generated images. Local writes to public/images; the
// stateless sink collects buffers for the response.
export interface ImageSink {
  /** Returns byte size if an image already exists (enables resume), else null. */
  exists(name: string): Promise<number | null>;
  /** Persists the image and returns the reference to store in the Excel row. */
  save(name: string, buffer: Buffer): Promise<string>;
  /** Remove a previously-saved image. No-op when absent or not applicable. */
  remove(name: string): Promise<void>;
}

export interface BriefStore {
  read(date: string): Promise<ContentBrief | null>;
  write(brief: ContentBrief): Promise<void>;
  readRecent(limit: number): Promise<ContentBrief[]>;
}

export interface RunContext {
  creds: RunCreds;
  config: ContentForgeConfig;
  /** This run's creative identity (brand, pillars, platforms, voice, tags) —
   * per-storage in both modes, so multiple visitors/domains never share one. */
  domain: ContentDomainConfig;
  /** RICE-POT agent prompt scaffolding — per-storage, same as `domain`. */
  prompts: AgentPrompts;
  excel: ExcelAccessor;
  images: ImageSink;
  briefStore: BriefStore;
  persistConfig(config: ContentForgeConfig): Promise<void>;
  /**
   * The date this run targets (YYYY-MM-DD). When absent, agents use today —
   * preserving byte-for-byte existing behavior. Set when regenerating a past day.
   */
  targetDate?: string;
  // Folder-mode overrides resolved in the browser and sent to the server. When
  // absent (local mode), the agents fall back to their on-disk defaults.
  theme?: WeeklyTheme;
  voice?: BrandVoice;
  material?: string;
  history?: GenerationLogEntry[];
}

// --------------------------------------------------------------------------
// Local (filesystem) context — byte-for-byte today's behavior.
// --------------------------------------------------------------------------

class LocalImageSink implements ImageSink {
  private dir = path.join(DATA_DIR, "images");
  async exists(name: string): Promise<number | null> {
    try {
      const s = await fs.stat(path.join(this.dir, name));
      return s.size;
    } catch {
      return null;
    }
  }
  async save(name: string, buffer: Buffer): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, name), buffer);
    return `/api/images/${name}`;
  }
  async remove(name: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.dir, name));
    } catch {
      /* already gone — nothing to do */
    }
  }
}

const localBriefStore: BriefStore = {
  read: readBrief,
  write: writeBrief,
  readRecent: readRecentBriefs,
};

export function createLocalContext(config?: ContentForgeConfig): RunContext {
  return {
    creds: {
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
      tavilyApiKey: process.env.TAVILY_API_KEY,
    },
    config: config ?? readConfig(),
    domain: readDomainConfig(),
    prompts: readAgentPrompts(),
    excel: excelManager,
    images: new LocalImageSink(),
    briefStore: localBriefStore,
    persistConfig: async (c) => {
      writeConfig(c);
    },
  };
}

// --------------------------------------------------------------------------
// Buffer (stateless) context — for the deployed folder mode. Nothing touches
// the server filesystem; images are collected and returned to the client.
// --------------------------------------------------------------------------

export interface CollectedImage {
  name: string;
  buffer: Buffer;
}

export class CollectedImageSink implements ImageSink {
  readonly images: CollectedImage[] = [];
  async exists(): Promise<number | null> {
    return null; // no cross-request resume
  }
  async save(name: string, buffer: Buffer): Promise<string> {
    this.images.push({ name, buffer });
    return `images/${name}`;
  }
  async remove(): Promise<void> {
    // Stateless per-request sink — nothing persisted to remove.
  }
}

class MemoryBriefStore implements BriefStore {
  private map = new Map<string, ContentBrief>();
  async read(date: string): Promise<ContentBrief | null> {
    return this.map.get(date) ?? null;
  }
  async write(brief: ContentBrief): Promise<void> {
    this.map.set(brief.date, brief);
  }
  async readRecent(limit: number): Promise<ContentBrief[]> {
    return Array.from(this.map.values()).slice(-limit).reverse();
  }
}

export function createBufferContext(opts: {
  creds: RunCreds;
  config: ContentForgeConfig;
  domain: ContentDomainConfig;
  prompts: AgentPrompts;
  excel: ExcelAccessor;
  images: ImageSink;
  targetDate?: string;
  theme?: WeeklyTheme;
  voice?: BrandVoice;
  material?: string;
  history?: GenerationLogEntry[];
}): RunContext {
  return {
    creds: opts.creds,
    config: opts.config,
    domain: opts.domain,
    prompts: opts.prompts,
    excel: opts.excel,
    briefStore: new MemoryBriefStore(),
    // Stateless: never write config to the (read-only) server filesystem.
    persistConfig: async () => {},
    images: opts.images,
    targetDate: opts.targetDate,
    theme: opts.theme,
    voice: opts.voice,
    material: opts.material,
    history: opts.history,
  };
}
