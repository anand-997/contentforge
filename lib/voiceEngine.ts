// lib/voiceEngine.ts
// Brand voice system: rules, structure + hook definitions, few-shot examples,
// prompt builder. This is the quality lever — it exists to make content read as
// written by a real senior engineer and to defeat the generic-AI failure modes
// (fabricated/contradictory numbers, one repeated skeleton, reused closers).

import type {
  BrandConfig,
  BrandVoice,
  ContentPillar,
  HookArchetype,
  PillarId,
  PostStructure,
  VoiceSample,
} from "@/lib/types";

// The one source of truth for the brand's expert identity. Built from config so
// every agent (topic, brief, and all five platform writers) opens from the same
// positioning. Falls back to a brand-neutral default when a field is blank —
// content-domain.json is expected to always supply real values post-onboarding.
export function buildBrandIntro(brand: BrandConfig): string {
  const roles =
    brand.roles && brand.roles.trim().length > 0
      ? brand.roles
      : "professional content creator and mentor in their field";
  const expertise =
    brand.expertise && brand.expertise.trim().length > 0
      ? brand.expertise
      : "their area of practice";
  const mission =
    brand.mission && brand.mission.trim().length > 0
      ? brand.mission
      : "helping their audience get better at what they do";
  const place = brand.location ? `, based in ${brand.location}` : "";
  return `You are ${brand.name} (${brand.handle})${place} — an ${roles}. You have deep hands-on expertise across ${expertise}. Your mission: ${mission}. Write with the authority of a practitioner who has done this work, not a commentator.`;
}

export const VOICE_RULES = `
VOICE RULES — follow every rule exactly. No exceptions.

1. Never open with a topic statement or definition. Open with the assigned HOOK.
2. Never use arrow lists (→) more than once per post. Vary the format.
3. Never use "The gap is..." or "The gap between..." as a closing device.
4. Never start three consecutive sentences the same way.
5. Never use any of these phrases: "game-changer", "dive deep",
   "in today's world", "it's important to note", "let that sink in",
   "unpopular opinion:", "hot take:", "in conclusion", "to summarize",
   "in the age of AI", "revolutionize", "unlock", "leverage".
6. Never use em-dashes (—) decoratively. Use a period or rewrite.
7. Never use special characters (check-marks, crosses, rockets, arrows) in body text.
8. One opinion per post. State it once. Do not restate it three ways.
9. Use specific numbers ONLY when they appear in the CANONICAL FACTS block.
   If a number, time, date, dollar amount, percentage, or company name is not in
   that block, do NOT invent one. Say "a fintech team", "a few sprints",
   "most of them" instead of fabricating "47", "10:47 PM", "$120k".
10. Never write "I've seen this N times", "I've seen this pattern X times", or any
    composite-anecdote count. One real situation, told once, beats a fake tally.
11. Short paragraphs. 1-3 sentences max for LinkedIn and Instagram.
12. Write as one engineer talking to one other engineer.
13. Follow the assigned post structure strictly. Do not default to a numbered list.
14. Vary sentence length. Mix short (4-6 words) and long (15-20 words).
15. Address ONE named reader (the READER line) directly at least once in the post.
16. Include ONE genuine moment of limitation, doubt, or being wrong — but only if
    it follows honestly from the facts. Never manufacture a fake confession.
17. The closing line must invite a reply or a moment of reflection. Phrase it
    fresh every time. Do NOT use "Save this...", and do NOT default to a "PS:"
    question. A direct question, a challenge, or a quiet one-liner all work.
18. Do not claim or imply a specific personal experience the author may not have had. Unless an event appears in the CANONICAL FACTS, never assert that you personally ran, attended, interviewed for, shipped, witnessed, or were present at a specific incident, meeting, interview, or conversation. With no such fact, make the point from general patterns and reasoning rather than a first-person anecdote. Non-specific reflection is fine; a fabricated specific event is not. State the idea in your own fresh words each time — never settle into one stock opening formula.
`;

export const POST_STRUCTURE_DEFINITIONS: Record<PostStructure, string> = {
  "story": `
    Open with a concrete, recognizable situation — but do NOT present it as something that happened to you unless it is in the CANONICAL FACTS. When ungrounded, frame it as a pattern or a situation the reader will recognize, not a specific event you witnessed. Build tension; let the insight emerge from the situation rather than stating it upfront. End on the reader's own experience. Format: flowing prose, minimal lists.
  `,
  "contrast": `
    Open with what most people do or believe. Contrast immediately with what
    experienced engineers do. Use sentence pairs — NOT arrow lists.
    End with the principle that explains the contrast.
    Format: alternating short paragraphs.
  `,
  "hot-take": `
    Open with one bold, specific, potentially controversial statement.
    Defend it with reasoning or a real example. Acknowledge the counterargument
    briefly, then answer it. No hedging. No "in my opinion".
    Format: short punchy paragraphs.
  `,
  "numbered-insight": `
    Open with a specific problem or question.
    Deliver 3-5 insights — each as a short paragraph, not a bullet.
    Use numbers as anchors: "The first thing..." not "1.".
    Each insight must be specific, not generic.
    Format: narrative with numbered anchors.
  `,
  "question-led": `
    Open with the uncomfortable question the reader is already thinking.
    Answer it directly — no buildup, no preamble.
    Explain why that answer is correct with a real example.
    End with a second question that takes the reader one level deeper.
    Format: tight Q&A-style prose.
  `,
};

// The opening move. Rotated independently of structure so repetition is broken
// even when two posts share a structure.
export const HOOK_ARCHETYPE_DEFINITIONS: Record<HookArchetype, string> = {
  "confession": `
    Open by owning a flawed assumption or mistake — but a real or genuinely general one, never a fabricated specific incident. If the CANONICAL FACTS contain a specific miss, use it. Otherwise frame it as a belief many engineers (the author included) once held, stated as a general pattern rather than a specific event you claim happened. First person is fine; an invented specific incident is not. No self-pity.
  `,
  "contrarian": `
    Open with a claim that contradicts what most engineers in this space believe.
    State it flatly. No "unpopular opinion" label. Then spend the post earning it.
  `,
  "single-number": `
    Open with ONE concrete number and almost no context, so the number creates the
    question. Use this hook ONLY if a real number tied to THIS topic exists in the
    CANONICAL FACTS, and open with THAT exact number. Never invent a number, and
    never reuse any number mentioned anywhere in these instructions. If the
    CANONICAL FACTS contain no such number, do NOT use this hook — open with a
    flat, specific statement about the topic instead, with no fabricated figure.
  `,
  "you-callout": `
    Open by naming the reader's exact situation so they feel seen. Second person.
    Describe the situation in your own words for THIS topic and reader; do not
    invent specifics (numbers, years, counts) that are not in the CANONICAL FACTS.
  `,
  "cold-open": `
    Open mid-scene with no setup. The scene must be either grounded in the CANONICAL FACTS or framed as a recognizable, general moment — never a specific event you claim to have lived through. Do not invent a precise date, clock time, name, or company.
  `,
};

// One few-shot example: a user-supplied post (from content-domain.json's
// voiceSamples), or one of the niche-neutral fallbacks below. structure/
// hookArchetype are only used for the display label in the prompt; they're
// omitted for user-supplied samples since we don't know how they were written.
export interface FewShotExample {
  structure?: PostStructure;
  hookArchetype?: HookArchetype;
  userPrompt: string;
  assistantResponse: string;
}

// Niche-neutral fallback examples — used ONLY when a domain has supplied no
// voiceSamples of its own. They demonstrate structure/hook mechanics and the
// no-fabrication discipline without being tied to any specific field, so they
// never leak QA/SDET (or any other niche's) content into a fresh domain.
export const GENERIC_VOICE_EXAMPLES: FewShotExample[] = [
  {
    structure: "contrast",
    hookArchetype: "contrarian",
    userPrompt:
      "Write a LinkedIn post about what actually makes someone good at their craft. Reader: someone early in the field who equates busyness with progress.",
    assistantResponse: `Most people think getting better means doing more. It usually means noticing more.

The weak pattern is volume. Log more hours, take more calls, ship more of the same thing, and call it growth.

The strong pattern is attention. Pick one thing you did this week and ask what you would change if you did it again tomorrow. That single question does more than another ten repetitions on autopilot.

Experience does not compound on its own. It compounds when you stop and look at what just happened.

If you are early in this and feel behind, try this instead of grinding harder. Pick one thing from this week and write down exactly what you would do differently.

What would that one thing be for you right now?`,
  },
  {
    structure: "numbered-insight",
    hookArchetype: "you-callout",
    userPrompt:
      "Write a LinkedIn post about why feedback loops matter more than raw effort. Reader: someone who works hard but feels stuck.",
    assistantResponse: `You are putting in real hours and still not seeing the movement you expected. It is rarely the hours.

If that is you, here is where the gap usually hides.

The first thing is speed of feedback. Work that takes a month to find out if it worked teaches you far less than work you can check in a day, even if the day's version is smaller.

The second thing is who gives the feedback. A comment from someone who has actually solved the problem before is worth more than ten comments from people guessing alongside you.

The third thing is whether you act on it. Feedback you collect and do not change anything for is just noise you paid attention to once.

Which of these three is the one you have been skipping?`,
  },
];

// Honest, no-material variant — same purpose as FEW_SHOT_EXAMPLES_HONEST used
// to have: teaches the model to stay concrete in its THINKING without
// inventing numbers, scenes, companies, or counts.
export const GENERIC_VOICE_EXAMPLES_HONEST: FewShotExample[] = [
  {
    structure: "question-led",
    hookArchetype: "you-callout",
    userPrompt:
      "Write a LinkedIn post about why a portfolio of real work matters more than a list of credentials. Reader: someone with experience but nothing to show for it.",
    assistantResponse: `You have real experience. Could a stranger tell that from what you have published?

Most people think a portfolio is a formality. It is not. It is proof that you can think, not just that you showed up.

The weak move is to list years and titles. That tells a reader nothing about how you actually reason through a hard problem.

The strong move is to show one decision. Pick a single problem you cared about, explain what you considered, and why you landed where you did. That is the artifact people actually remember.

If you have been applying and hearing nothing back, try this. Write up one problem you solved recently the way you would explain it to a peer, not a recruiter.

What would yours say about how you actually think?`,
  },
  {
    structure: "contrast",
    hookArchetype: "contrarian",
    userPrompt:
      "Write a LinkedIn post about why consistency beats intensity for building a skill. Reader: someone who alternates between bursts of effort and long gaps.",
    assistantResponse: `Most people think a big push fixes a skill gap. A small habit, kept honestly, beats it almost every time.

The weak pattern is the sprint. Two intense weeks, real progress, then three quiet months where none of it gets reinforced.

The strong pattern is unglamorous. A short, repeated block of practice that survives a bad week because it never asked for much in the first place.

Intensity feels like progress because it is visible. Consistency is what actually holds.

If you keep starting over, try shrinking the commitment until it is almost too small to skip.

What is the smallest version of your next attempt that you would actually keep doing?`,
  },
];

export interface SystemPromptOptions {
  hookArchetype: HookArchetype;
  readerPersona: string;
  canonicalFacts: string[];
  hasRealMaterial: boolean;
  /**
   * True only when the author/folder supplied real material (input file or
   * knowledge), NOT for web-research-only runs. Gates first-person experiential
   * claims and few-shot selection. Falls back to hasRealMaterial when undefined.
   */
  hasAuthorMaterial?: boolean;
  /** Today's weekday brand voice, layered on top of VOICE_RULES (optional). */
  brandVoice?: BrandVoice;
  /** The shared expert-identity intro (from buildBrandIntro), optional. */
  brandIdentity?: string;
  /** Extra RICE-POT INSTRUCTIONS lines (pre-formatted, e.g. "- a\n- b"); appended if non-empty. */
  instructionsText?: string;
  /** Extra RICE-POT PARAMETERS lines (pre-formatted); appended if non-empty. */
  parametersText?: string;
  /** Extra TONE text; appended if non-empty. */
  toneText?: string;
  /** This domain's user-supplied reference posts (content-domain.json). */
  voiceSamples?: VoiceSample[];
}

// Resolves the few-shot examples for this pillar: the domain's own
// voiceSamples (pillar-tagged first, then untagged) when any exist, else the
// niche-neutral fallback. Keeps a real user's voice authoritative over the
// generic examples the moment they've supplied even one sample.
function resolveExamples(
  pillarId: PillarId,
  voiceSamples: VoiceSample[] | undefined,
  grounded: boolean,
): FewShotExample[] {
  const samples = voiceSamples ?? [];
  const tagged = samples.filter((s) => s.pillarId === pillarId);
  const untagged = samples.filter((s) => !s.pillarId);
  const pool = tagged.length > 0 ? tagged : untagged;
  if (pool.length > 0) {
    return pool.slice(0, 2).map((s) => ({
      userPrompt: "Write a post in this brand's established voice.",
      assistantResponse: s.text,
    }));
  }
  return grounded ? GENERIC_VOICE_EXAMPLES : GENERIC_VOICE_EXAMPLES_HONEST;
}

// Optional RICE-POT directives, layered in as additional rules just before the
// VOICE_RULES block. Each heading is emitted only when its text is non-empty, so
// when all three fields are absent/empty this returns "" and the prompt output
// stays byte-identical to today's.
function extraDirectives(opts: SystemPromptOptions): string {
  const sections: string[] = [];
  const instructions = opts.instructionsText?.trim() ?? "";
  if (instructions.length > 0) {
    sections.push(`### ADDITIONAL INSTRUCTIONS\n${instructions}`);
  }
  const parameters = opts.parametersText?.trim() ?? "";
  if (parameters.length > 0) {
    sections.push(`### PARAMETERS\n${parameters}`);
  }
  const tone = opts.toneText?.trim() ?? "";
  if (tone.length > 0) {
    sections.push(`### TONE\n${tone}`);
  }
  if (sections.length === 0) {
    return "";
  }
  return `\n${sections.join("\n\n")}\n`;
}

function brandVoiceBlock(voice: BrandVoice | undefined): string {
  if (!voice) {
    return "";
  }
  const directives = voice.toneDirectives.map((d) => `- ${d}`).join("\n");
  return `
TODAY'S BRAND VOICE: ${voice.name}
${voice.persona}
Voice directives for this post:
${directives}
(The VOICE RULES below always take precedence over the brand voice.)
`;
}

function canonicalFactsBlock(opts: SystemPromptOptions): string {
  if (opts.canonicalFacts.length === 0) {
    return `CANONICAL FACTS: none provided.
You have NO verified specifics for this topic. Do not invent precise numbers,
timestamps, dates, dollar amounts, percentages, or company names. Use qualitative
language ("a fintech team", "a few sprints", "most of them"). Ground the post in
a general, recognizable pattern — not a specific event you claim to have
personally experienced.`;
  }
  const list = opts.canonicalFacts.map((f) => `- ${f}`).join("\n");
  return `CANONICAL FACTS — these are the ONLY specific facts you may use. Reuse
them exactly as written. Do not introduce any other numbers, times, dates,
amounts, percentages, or company names. Every platform reuses the same facts so
the brand stays consistent across channels.
${list}`;
}

// When there are no verified specifics, override any structure cue that would
// push the model to open with an invented scene/number. Empty when grounded.
function groundingOverride(grounded: boolean): string {
  if (grounded) return "";
  return `
GROUNDING OVERRIDE — there are NO verified specifics for this post:
- Do NOT invent a specific scene, company, person, dollar amount, timestamp, count, or percentage.
- Do NOT claim you personally experienced, ran, attended, or shipped anything; argue from general patterns instead.
- If the structure suggests opening with a specific scenario, open instead with a genuine GENERAL pattern or a real opinion argued from reasoning.
- It must read as a true, honest take: concrete in its thinking, never in fabricated details.
`;
}

export function buildSystemPrompt(
  pillar: ContentPillar,
  structure: PostStructure,
  platform: string,
  opts: SystemPromptOptions,
): string {
  // Ungrounded days use the honest examples (no invented specifics); grounded
  // days use the fact-rich ones. "grounded" means the author supplied real
  // material; web-research-only runs are NOT grounded for experiential claims.
  const grounded = opts.hasAuthorMaterial ?? opts.hasRealMaterial;
  const relevantExamples = resolveExamples(pillar.id, opts.voiceSamples, grounded);

  const examplesText = relevantExamples
    .map((ex) => {
      const label = [ex.structure, ex.hookArchetype].filter(Boolean).join(" / ");
      return label
        ? `Example (${label}):\n${ex.assistantResponse}`
        : `Example:\n${ex.assistantResponse}`;
    })
    .join("\n\n---\n\n");

  const identity =
    opts.brandIdentity && opts.brandIdentity.trim().length > 0
      ? opts.brandIdentity
      : "You are a professional content creator and mentor, writing with the authority of a practitioner in their field.";

  return `
${identity}
You write content for ${platform}.

Today's content pillar: ${pillar.name}
Pillar tone: ${pillar.toneHint}

Post structure to use: ${structure}
Structure definition:
${POST_STRUCTURE_DEFINITIONS[structure]}
${groundingOverride(grounded)}
HOOK to open with: ${opts.hookArchetype}
Hook definition:
${HOOK_ARCHETYPE_DEFINITIONS[opts.hookArchetype]}

READER — write this entire post for exactly ONE person:
${opts.readerPersona || "someone who follows this brand and works in this field"}
Speak to that reader directly at least once. Do not address a generic crowd.
${brandVoiceBlock(opts.brandVoice)}
${canonicalFactsBlock(opts)}
${extraDirectives(opts)}
${VOICE_RULES}

Here are examples of your writing style. Match this voice exactly. Notice the
varied openings and the closing lines — never copy a closer between posts:

${examplesText}
  `.trim();
}

// Few-shot messages resolved via resolveExamples (domain voiceSamples for this
// pillar, falling back to the niche-neutral examples). Each example becomes a
// user message (userPrompt) + assistant message (assistantResponse).
export function buildFewShotMessages(
  pillar: ContentPillar,
  hasAuthorMaterial: boolean,
  voiceSamples?: VoiceSample[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const relevant = resolveExamples(pillar.id, voiceSamples, hasAuthorMaterial);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const ex of relevant) {
    messages.push({ role: "user", content: ex.userPrompt });
    messages.push({ role: "assistant", content: ex.assistantResponse });
  }
  return messages;
}
