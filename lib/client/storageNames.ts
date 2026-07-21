// lib/client/storageNames.ts
// Filenames + directory names of the files ContentForge keeps inside a user's
// storage location. Shared by every StorageProvider (FolderStorage,
// UploadDownloadStorage, DriveStorage) so the same strings are used everywhere.
// Pure constants — safe to import anywhere.

export const WEEKLY_PLAN_FILENAME = "weekly-plan.json";
export const GENERATION_LOG_FILENAME = "generation-log.json";
export const KNOWLEDGE_DIRNAME = "knowledge";
export const KNOWLEDGE_README_FILENAME = "README.md";
export const CACHE_DIRNAME = ".cache";

// Per-visitor creative identity + run settings + prompt scaffolding — see
// lib/domainConfig.ts / lib/configManager.ts / lib/promptConfig.ts. Stored in
// the user's own folder/Drive, same as everything else above, so no two
// visitors ever share a brand, pillar set, or model config.
export const CONTENT_DOMAIN_FILENAME = "content-domain.json";
export const CONFIG_FILENAME = "contentforge.config.json";
export const PROMPTS_FILENAME = "agent-prompts.json";
