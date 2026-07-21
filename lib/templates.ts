// lib/templates.ts
// Starter file contents the browser writes into a freshly chosen folder for the
// deployed "folder mode". These are the seed versions of the files the app then
// reads/updates per-session: the weekday plan, the knowledge folder readme, and
// the generation log. No `any`.

import { DEFAULT_PLAN } from "@/lib/weeklyConfig";

// The seed weekly-plan.json. Must be valid JSON (no leading comment/banner).
export const WEEKLY_PLAN_TEMPLATE: string =
  JSON.stringify(DEFAULT_PLAN, null, 2) + "\n";

// The README dropped into the knowledge/ folder explaining the local learnings
// feature (text extraction, weekday referencing, caching).
export const KNOWLEDGE_README: string = `# Knowledge folder

Drop your real learning files here so the app can ground each day's posts in
material you actually wrote or used. Supported file types:

- \`.pdf\`, \`.docx\`, \`.pptx\`, \`.xlsx\` — class notes, slides, spreadsheets, examples
- \`.png\` — screenshots
- \`.txt\`, \`.md\` — plain notes

## How to use these files

1. Add your files and/or topic folders here (e.g. java/, cypress/notes.pdf).
   Files, folders, and folders inside folders are all read, at any depth.
   In weekly-plan.json a "knowledgeFiles" entry can be a file OR a folder.
2. Reference them per weekday in \`weekly-plan.json\` under \`"knowledgeFiles"\`,
   e.g. \`"knowledgeFiles": ["selenium.pdf", "my-notes.md"]\`.
3. The app extracts the text from each referenced file **with code (no AI
   tokens)** and grounds that day's posts in it.

Extracted text is cached in \`.cache/\` so files that have not changed are not
re-processed on the next run.
`;

// The seed generation-log.json: an empty JSON array.
export const GENERATION_LOG_TEMPLATE: string = "[]\n";

export const WEEKLY_PLAN_FILENAME = "weekly-plan.json";
export const KNOWLEDGE_DIRNAME = "knowledge";
export const GENERATION_LOG_FILENAME = "generation-log.json";
