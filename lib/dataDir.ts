// lib/dataDir.ts
// Local/server mode's runtime data root. Every generated artifact (config,
// prompts, domain, weekly plan, workbook, images, knowledge, briefs, logs)
// lives here — never under the app code directory — so app code and user
// content stay separate, the same way folder/Drive mode keeps a visitor's
// data out of the app bundle. Override with CONTENTFORGE_DATA_DIR for a
// different deployment layout.

import path from "path";

export const DATA_DIR =
  process.env.CONTENTFORGE_DATA_DIR ??
  path.join(process.cwd(), "..", "social-media-config", "contentforge");
