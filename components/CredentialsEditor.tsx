"use client";

// components/CredentialsEditor.tsx
// A proper form for credentials.env (API keys/tokens), replacing the previous
// raw-textarea editor in components/SettingsMenu.tsx. Used by both Drive mode
// and folder mode.

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Credentials } from "@/lib/client/contract";
import { InfoTooltip } from "./InfoTooltip";
import { Spinner } from "./statusBadge";
import { useToast } from "./ui";

export interface CredentialsEditorProps {
  credentials: Credentials;
  onSave: (credentials: Credentials) => Promise<void>;
  onClose: () => void;
}

export function CredentialsEditor({
  credentials,
  onSave,
  onClose,
}: CredentialsEditorProps): JSX.Element {
  const toast = useToast();
  const [draft, setDraft] = useState<Credentials>(credentials);
  // Opens read-only — the user must explicitly click "Edit" before any field
  // becomes interactive, so a stray click never changes a saved key by accident.
  const [locked, setLocked] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof Credentials>(key: K, value: Credentials[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await onSave(draft);
      toast.push("success", "API keys saved.");
      onClose();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Could not save API keys.");
    } finally {
      setSaving(false);
    }
  }

  const inputType = revealed ? "text" : "password";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="API keys"
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-2xl rounded-2xl border border-hairline bg-ink-800 p-5 shadow-xl sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">API keys</h2>
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

        <div className="mt-4 max-h-[70vh] space-y-6 overflow-y-auto pr-1">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="focus-ring rounded-md px-2 py-1 text-xs text-teal hover:underline"
            >
              {revealed ? "Hide keys" : "Show keys"}
            </button>
          </div>

          <Section title="Core" help="Blocks the whole pipeline if missing.">
            <Field label="Deepseek API key">
              <input
                type={inputType}
                value={draft.deepseekApiKey}
                disabled={locked}
                onChange={(e) => update("deepseekApiKey", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
          </Section>

          <Section
            title="Optional AI"
            help="Only needed for AI image generation, vision OCR, or web-research grounding."
          >
            <Field label="OpenAI API key (images)">
              <input
                type={inputType}
                value={draft.openaiApiKey}
                disabled={locked}
                onChange={(e) => update("openaiApiKey", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
            <Field label="Gemini API key (vision OCR)">
              <input
                type={inputType}
                value={draft.geminiApiKey}
                disabled={locked}
                onChange={(e) => update("geminiApiKey", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
            <Field label="Tavily API key (web research)">
              <input
                type={inputType}
                value={draft.tavilyApiKey}
                disabled={locked}
                onChange={(e) => update("tavilyApiKey", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
          </Section>

          <Section
            title="Publishing"
            help="Each is only needed if you use that platform's Publish button."
          >
            <Field label="Dev.to API key">
              <input
                type={inputType}
                value={draft.devtoApiKey}
                disabled={locked}
                onChange={(e) => update("devtoApiKey", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
            <Field label="Medium integration token">
              <input
                type={inputType}
                value={draft.mediumToken}
                disabled={locked}
                onChange={(e) => update("mediumToken", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
            <Field label="Instagram access token">
              <input
                type={inputType}
                value={draft.instagramAccessToken}
                disabled={locked}
                onChange={(e) => update("instagramAccessToken", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
            <Field label="Instagram user id">
              <input
                type={inputType}
                value={draft.instagramUserId}
                disabled={locked}
                onChange={(e) => update("instagramUserId", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
            <Field label="LinkedIn access token">
              <input
                type={inputType}
                value={draft.linkedinAccessToken}
                disabled={locked}
                onChange={(e) => update("linkedinAccessToken", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
            <Field label="LinkedIn user id">
              <input
                type={inputType}
                value={draft.linkedinUserId}
                disabled={locked}
                onChange={(e) => update("linkedinUserId", e.target.value)}
                spellCheck={false}
                className="input font-mono"
              />
            </Field>
          </Section>
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

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-subtext">{title}</h3>
        {help && <InfoTooltip text={help} side="right" />}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.7rem] text-subtext">{label}</span>
      {children}
    </label>
  );
}
