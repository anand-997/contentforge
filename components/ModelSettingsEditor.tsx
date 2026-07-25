"use client";

// components/ModelSettingsEditor.tsx
// A proper form for contentforge.config.json's `models` section, for folder
// and Drive mode where there is otherwise no in-app way to change the
// Deepseek/OpenAI model names (local mode has this via Sidebar's
// ConfigEditor, which talks to a server-filesystem API route that doesn't
// exist in folder/Drive mode). Only imports the type from lib/types — never
// lib/configManager.ts, which imports `fs`/DATA_DIR at module scope and
// would break the client bundle.

import { useState } from "react";
import { createPortal } from "react-dom";
import type { ImageEngine } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { Spinner } from "./statusBadge";
import { useToast } from "./ui";

/** Known-good Deepseek model ids; anything else triggers a soft warning. */
const KNOWN_DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

export interface ModelSettings {
  deepseekModel: string;
  imageEngine: ImageEngine;
  openaiImageModel: string;
}

export const BLANK_MODEL_SETTINGS: ModelSettings = {
  deepseekModel: "deepseek-v4-flash",
  imageEngine: "template",
  openaiImageModel: "gpt-image-1",
};

export interface ModelSettingsEditorProps {
  settings: ModelSettings;
  onSave: (settings: ModelSettings) => Promise<void>;
  onClose: () => void;
}

export function ModelSettingsEditor({
  settings,
  onSave,
  onClose,
}: ModelSettingsEditorProps): JSX.Element {
  const toast = useToast();
  const [draft, setDraft] = useState<ModelSettings>(settings);
  // Opens read-only — the user must explicitly click "Edit" before any field
  // becomes interactive, so a stray click never changes a saved model.
  const [locked, setLocked] = useState(true);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof ModelSettings>(key: K, value: ModelSettings[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await onSave(draft);
      toast.push("success", "Model settings saved.");
      onClose();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Could not save model settings.");
    } finally {
      setSaving(false);
    }
  }

  const modelUnknown =
    draft.deepseekModel.trim().length > 0 &&
    !KNOWN_DEEPSEEK_MODELS.includes(draft.deepseekModel.trim());

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Model settings"
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-lg rounded-2xl border border-hairline bg-ink-800 p-5 shadow-xl sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Model settings</h2>
            <p className="text-xs text-subtext">
              Stored only in your folder/Drive — never on the server.
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

        <div className="mt-4 max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-xs text-subtext">
              Deepseek model
              <InfoTooltip
                text="The text model that writes your posts. deepseek-v4-flash is the safe default. Unrecognized names still save but are flagged."
                side="right"
              />
            </span>
            <input
              value={draft.deepseekModel}
              disabled={locked}
              onChange={(e) => update("deepseekModel", e.target.value)}
              spellCheck={false}
              className={`input font-mono ${modelUnknown ? "border-amber/50" : ""}`}
              aria-invalid={modelUnknown}
            />
            {modelUnknown && (
              <p className="mt-1 flex items-center gap-1 text-[0.68rem] text-amber">
                <span aria-hidden="true">⚠</span> Unrecognized model — save only if you are
                sure.
              </p>
            )}
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-xs text-subtext">
              Image engine
              <InfoTooltip
                text='"template" renders deterministic branded PNGs locally, no image API key needed. "openai" calls an OpenAI image model instead.'
                side="right"
              />
            </span>
            <select
              value={draft.imageEngine}
              disabled={locked}
              onChange={(e) => update("imageEngine", e.target.value as ImageEngine)}
              className="input"
            >
              <option value="template">template (local, no API key)</option>
              <option value="openai">openai (AI-generated)</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-xs text-subtext">
              OpenAI image model
              <InfoTooltip text="Only used when image engine is set to openai." side="right" />
            </span>
            <input
              value={draft.openaiImageModel}
              disabled={locked || draft.imageEngine !== "openai"}
              onChange={(e) => update("openaiImageModel", e.target.value)}
              spellCheck={false}
              className="input font-mono"
            />
          </label>
        </div>

        <div className="mt-5 flex gap-2 border-t border-hairline pt-4">
          {locked ? (
            <>
              <button
                type="button"
                onClick={() => setLocked(false)}
                className="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-glow transition-all hover:bg-teal-soft"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onClose}
                className="focus-ring rounded-xl border border-hairline px-4 py-2.5 text-sm text-subtext hover:text-white"
              >
                Close
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
