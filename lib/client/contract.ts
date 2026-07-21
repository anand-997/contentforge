// lib/client/contract.ts
// Shared client-side storage contract. Implemented by lib/client/storage.ts
// (the providers) and consumed by the dashboard UI. Pure types — safe to import
// anywhere. The actual implementations use browser-only APIs.

export type StorageMode = "folder" | "upload" | "drive";

export interface Credentials {
  deepseekApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;
  /** Optional web-search key (Tavily) for the research-grounding step. */
  tavilyApiKey: string;
  /** Optional Dev.to API key for the "Save Dev.to draft" action. */
  devtoApiKey: string;
  /** Optional Medium integration token for the "Save Medium draft" action. */
  mediumToken: string;
  /** Optional Instagram Graph API long-lived token for "Publish to Instagram". */
  instagramAccessToken: string;
  /** Optional Instagram professional account id (paired with the token). */
  instagramUserId: string;
  /** Optional LinkedIn member access token for "Post to LinkedIn". */
  linkedinAccessToken: string;
  /** Optional LinkedIn member id (`sub`); only needed if the token lacks openid. */
  linkedinUserId: string;
}

export interface StorageInfo {
  mode: StorageMode;
  /** Display name of the active folder (folder mode), else null. */
  folderName: string | null;
  hasWorkbook: boolean;
  hasCredentials: boolean;
  /** True when at least the Deepseek key is filled in credentials.env. */
  credentialsFilled: boolean;
}

export interface RecentFolder {
  id: string;
  name: string;
}

// Every provider (folder or upload) satisfies this. The UI talks only to this.
export interface StorageProvider {
  readonly mode: StorageMode;
  /** Create the two files (credentials.env, content_calendar.xlsx) + images/ if missing. */
  ensureFiles(): Promise<void>;
  /** The current workbook bytes, or null if none yet. */
  readWorkbook(): Promise<ArrayBuffer | null>;
  writeWorkbook(buffer: ArrayBuffer): Promise<void>;
  readCredentials(): Promise<Credentials>;
  /** Persist a generated image (base64) into the location's images/ area. */
  writeImage(name: string, base64: string): Promise<void>;
  /** A previewable object URL for a stored image, or null if absent. */
  imageObjectUrl(name: string): Promise<string | null>;
  /** Delete a stored image by basename. No-op when absent. */
  deleteImage(name: string): Promise<void>;
  info(): Promise<StorageInfo>;

  // ---- Weekly plan / knowledge / generation log (folder mode extras) ----
  /** Read a UTF-8 text file at a path relative to the location root, or null. */
  readText(relPath: string): Promise<string | null>;
  /** Write a UTF-8 text file at a path relative to the location root. */
  writeText(relPath: string, contents: string): Promise<void>;
  /**
   * Write raw bytes at a path relative to the location root, creating any
   * intermediate directories. Used by the local→Drive import to copy arbitrary
   * nested files (images, PDFs, the workbook) without special-casing each kind.
   */
  writeBytes(relPath: string, data: ArrayBuffer): Promise<void>;
  /**
   * Filenames directly inside the knowledge/ folder, excluding README.md and the
   * .cache directory. Empty when there are none.
   */
  listKnowledge(): Promise<string[]>;
  /** Raw bytes of a file inside knowledge/, or null if absent. */
  readKnowledgeBytes(name: string): Promise<ArrayBuffer | null>;
  /** Read a cached extraction (knowledge/.cache/<key>.txt), or null on miss. */
  cacheGet(key: string): Promise<string | null>;
  /** Store a cached extraction at knowledge/.cache/<key>.txt. */
  cachePut(key: string, text: string): Promise<void>;
}

// ---- Stateless server route shapes (must match app/api/*) ----

export interface GenerateImage {
  name: string;
  base64: string;
}

export interface GenerateResponse {
  workbookBase64: string;
  images: GenerateImage[];
  status: string | null;
  errorMessage: string | null;
  agentLog: string | null;
  note: string;
}

export interface TemplateResponse {
  credentialsEnv: string;
  workbookBase64: string;
  /** Starter weekly-plan.json contents (Record<Weekday, WeekdayPlan> JSON). */
  weeklyPlanJson: string;
  /** README.md placed inside the knowledge/ folder. */
  knowledgeReadme: string;
  /** Starter generation-log.json contents (an empty JSON array). */
  generationLogJson: string;
  /** Starter content-domain.json — brand-neutral (GENERIC_DEFAULT_DOMAIN). */
  contentDomainJson: string;
  /** Starter contentforge.config.json (DEFAULT_CONFIG). */
  configJson: string;
  /** Starter agent-prompts.json (DEFAULT_PROMPTS). */
  agentPromptsJson: string;
}
