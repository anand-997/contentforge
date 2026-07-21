// lib/client/knowledgeFolders.ts
// Derives the knowledge/ subfolder names a weekly plan expects, so first-run
// scaffolding creates the folders the plan actually references instead of
// leaving dangling entries. A `knowledgeFiles` entry can be a file OR a folder
// (see lib/templates.ts KNOWLEDGE_README) — only the folder-shaped ones (no file
// extension) get created.
//
// Pure function over JSON text — no browser/Node APIs, safe to import anywhere.

/** True when an entry looks like a filename (has an extension) rather than a folder. */
function looksLikeFile(entry: string): boolean {
  const base = entry.split(/[\\/]/).pop() ?? entry;
  // A trailing ".<1-8 non-dot chars>" is treated as an extension.
  return /\.[^.\s/\\]{1,8}$/.test(base);
}

/**
 * Unique folder-style `knowledgeFiles` entries across every weekday of a
 * weekly-plan.json document. Returns [] for malformed input — scaffolding must
 * never fail because a user hand-edited their plan.
 */
export function knowledgeFolderNames(planJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(planJson);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const names = new Set<string>();
  for (const day of Object.values(parsed as Record<string, unknown>)) {
    if (typeof day !== "object" || day === null) continue;
    const entries = (day as { knowledgeFiles?: unknown }).knowledgeFiles;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "string") continue;
      // Only the first path segment is a direct child of knowledge/.
      const first = entry.split(/[\\/]/).filter((s) => s.length > 0)[0];
      if (!first || first.startsWith(".") || looksLikeFile(first)) continue;
      names.add(first);
    }
  }
  return Array.from(names);
}
