// lib/client/credentials.ts
// Parses a credentials.env file (KEY=VALUE lines) into the Credentials shape.

import type { Credentials } from "@/lib/client/contract";

/**
 * Parse KEY=VALUE lines from a credentials.env file. Lines that are blank or
 * start with `#` are ignored. Recognised keys map into the Credentials object;
 * any key not present in the text resolves to "".
 */
export function parseCredentials(text: string): Credentials {
  const values: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key !== "") {
      values[key] = value;
    }
  }

  return {
    deepseekApiKey: values.DEEPSEEK_API_KEY ?? "",
    openaiApiKey: values.OPENAI_API_KEY ?? "",
    geminiApiKey: values.GEMINI_API_KEY ?? "",
    tavilyApiKey: values.TAVILY_API_KEY ?? "",
    devtoApiKey: values.DEVTO_API_KEY ?? "",
    mediumToken: values.MEDIUM_INTEGRATION_TOKEN ?? "",
    instagramAccessToken: values.INSTAGRAM_ACCESS_TOKEN ?? "",
    instagramUserId: values.INSTAGRAM_USER_ID ?? "",
    linkedinAccessToken: values.LINKEDIN_ACCESS_TOKEN ?? "",
    linkedinUserId: values.LINKEDIN_USER_ID ?? "",
  };
}
