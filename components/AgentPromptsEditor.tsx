"use client";

// components/AgentPromptsEditor.tsx
// Editor for agent-prompts.json (RICE-POT): role/instructions/parameters/tone
// per agent stage, plus the image card's headline knobs. This file previously
// had no UI at all — editing meant hand-editing the JSON.

import { useState } from "react";
import { createPortal } from "react-dom";
import type { AgentPromptBlock, AgentPrompts, ImagePromptBlock } from "@/lib/promptConfig";
import { InfoTooltip } from "./InfoTooltip";
import { Spinner } from "./statusBadge";
import { useToast } from "./ui";

const STAGES: Array<{ key: "topic" | "brief" | "content"; label: string; help: string }> = [
  { key: "topic", label: "Topic", help: "Guides Agent 1 choosing today's topic." },
  { key: "brief", label: "Brief", help: "Guides Agent 1 turning the topic into a content brief." },
  { key: "content", label: "Content", help: "Guides Agent 2 writing each platform's post." },
];

function linesToText(lines: string[]): string {
  return lines.join("\n");
}
function textToLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export interface AgentPromptsEditorProps {
  prompts: AgentPrompts;
  onSave: (prompts: AgentPrompts) => Promise<void>;
  onClose: () => void;
}

export function AgentPromptsEditor({
  prompts,
  onSave,
  onClose,
}: AgentPromptsEditorProps): JSX.Element {
  const toast = useToast();
  const [draft, setDraft] = useState<AgentPrompts>(prompts);
  const [saving, setSaving] = useState(false);

  function updateBlock(key: "topic" | "brief" | "content", patch: Partial<AgentPromptBlock>): void {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  }

  function updateImage(patch: Partial<ImagePromptBlock>): void {
    setDraft((d) => ({ ...d, image: { ...d.image, ...patch } }));
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await onSave(draft);
      toast.push("success", "Prompts saved.");
      onClose();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Could not save prompts.");
    } finally {
      setSaving(false);
    }
  }

  // Portaled to document.body — see components/ContentDomainEditor.tsx for why.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agent prompts settings"
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-2xl rounded-2xl border border-hairline bg-ink-800 p-5 shadow-xl sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Agent prompts</h2>
            <p className="text-xs text-subtext">
              Supplementary role/instructions/tone layered on top of your brand identity.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring rounded-lg p-1.5 text-subtext hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-[70vh] space-y-6 overflow-y-auto pr-1">
          {STAGES.map(({ key, label, help }) => {
            const block = draft[key];
            return (
              <section key={key} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-subtext">
                    {label}
                  </h3>
                  <InfoTooltip text={help} side="right" />
                </div>
                <label className="block">
                  <span className="mb-1 block text-[0.7rem] text-subtext">
                    Role (optional — leave blank to skip)
                  </span>
                  <input
                    value={block.role}
                    onChange={(e) => updateBlock(key, { role: e.target.value })}
                    className="input"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[0.7rem] text-subtext">
                    Instructions (one per line)
                  </span>
                  <textarea
                    value={linesToText(block.instructions)}
                    onChange={(e) => updateBlock(key, { instructions: textToLines(e.target.value) })}
                    rows={3}
                    className="input resize-y"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[0.7rem] text-subtext">
                    Parameters (one per line)
                  </span>
                  <textarea
                    value={linesToText(block.parameters)}
                    onChange={(e) => updateBlock(key, { parameters: textToLines(e.target.value) })}
                    rows={3}
                    className="input resize-y"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[0.7rem] text-subtext">Tone</span>
                  <input
                    value={block.tone}
                    onChange={(e) => updateBlock(key, { tone: e.target.value })}
                    className="input"
                  />
                </label>
              </section>
            );
          })}

          <section className="space-y-2">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-subtext">
                Image card
              </h3>
              <InfoTooltip text="Knobs for the branded PNG card's headline/subline." side="right" />
            </div>
            <label className="block">
              <span className="mb-1 block text-[0.7rem] text-subtext">
                Subline source
              </span>
              <select
                value={draft.image.sublineSource}
                onChange={(e) => updateImage({ sublineSource: e.target.value as ImagePromptBlock["sublineSource"] })}
                className="input"
              >
                <option value="fact">A canonical fact from the brief</option>
                <option value="topic">The topic itself</option>
                <option value="insight">The post&apos;s core insight</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.7rem] text-subtext">
                Headline max characters
              </span>
              <input
                type="number"
                min={16}
                value={draft.image.headlineMaxChars}
                onChange={(e) => updateImage({ headlineMaxChars: Number(e.target.value) || 16 })}
                className="input"
              />
            </label>
          </section>
        </div>

        <div className="mt-5 flex gap-2 border-t border-hairline pt-4">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-glow transition-all hover:bg-teal-soft disabled:opacity-60"
          >
            {saving ? <Spinner className="text-ink-900" /> : null}
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="focus-ring rounded-xl border border-hairline px-4 py-2.5 text-sm text-subtext hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
