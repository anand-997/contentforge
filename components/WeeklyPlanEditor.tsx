"use client";

// components/WeeklyPlanEditor.tsx
// Per-weekday theme + brand-voice rotation editor (weekly-plan.json). Replaces
// the previous "edit weekly-plan.json by hand" instruction with a real UI.

import { useState } from "react";
import { createPortal } from "react-dom";
import type { ContentPillar, Weekday, WeekdayPlan } from "@/lib/types";
import { Spinner } from "./statusBadge";
import { useToast } from "./ui";

const WEEKDAYS: Array<{ key: Weekday; label: string }> = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

function csv(list: string[]): string {
  return list.join(", ");
}
function parseCsv(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}
function lines(list: string[]): string {
  return list.join("\n");
}
function parseLines(text: string): string[] {
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

export interface WeeklyPlanEditorProps {
  plan: Record<Weekday, WeekdayPlan>;
  pillars: ContentPillar[];
  onSave: (plan: Record<Weekday, WeekdayPlan>) => Promise<void>;
  onClose: () => void;
}

export function WeeklyPlanEditor({
  plan,
  pillars,
  onSave,
  onClose,
}: WeeklyPlanEditorProps): JSX.Element {
  const toast = useToast();
  // Opens read-only — see components/ContentDomainEditor.tsx for why. Only
  // gates the fields inside an expanded day (see the fieldset below); the
  // accordion toggle itself stays usable so browsing days doesn't require
  // clicking "Edit" first.
  const [locked, setLocked] = useState(true);
  const [draft, setDraft] = useState<Record<Weekday, WeekdayPlan>>(plan);
  const [open, setOpen] = useState<Weekday | null>("mon");
  const [saving, setSaving] = useState(false);

  function updateDay(day: Weekday, patch: Partial<WeekdayPlan>): void {
    setDraft((d) => ({ ...d, [day]: { ...d[day], ...patch } }));
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await onSave(draft);
      toast.push("success", "Weekly plan saved.");
      onClose();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Could not save weekly plan.");
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
        aria-label="Weekly plan settings"
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-2xl rounded-2xl border border-hairline bg-ink-800 p-5 shadow-xl sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Weekly plan</h2>
            <p className="text-xs text-subtext">
              Which theme and voice each weekday&apos;s post rotates through.
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

        <div className="mt-4 max-h-[70vh] space-y-2 overflow-y-auto pr-1">
          {WEEKDAYS.map(({ key, label }) => {
            const day = draft[key];
            const isOpen = open === key;
            return (
              <div key={key} className="rounded-lg border border-hairline bg-ink-700/40">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : key)}
                  className="focus-ring flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-semibold text-white">{label}</span>
                  <span className="truncate text-xs text-subtext">
                    {day.theme || "(no theme set)"}
                  </span>
                </button>
                {isOpen && (
                  // Locked only disables the fields inside — expanding/
                  // collapsing a day to view it stays available without
                  // clicking "Edit" first (see the toggle button above,
                  // which is outside this fieldset).
                  <fieldset
                    disabled={locked}
                    className="m-0 space-y-2.5 border-x-0 border-b-0 border-t border-hairline p-3"
                  >
                    <label className="block">
                      <span className="mb-1 block text-[0.7rem] text-subtext">Theme</span>
                      <input
                        value={day.theme}
                        onChange={(e) => updateDay(key, { theme: e.target.value })}
                        className="input"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[0.7rem] text-subtext">Pillar</span>
                      <select
                        value={day.pillar}
                        onChange={(e) => updateDay(key, { pillar: e.target.value })}
                        className="input"
                      >
                        <option value="">— choose a pillar —</option>
                        {pillars.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[0.7rem] text-subtext">
                        Keywords (comma-separated)
                      </span>
                      <input
                        value={csv(day.keywords)}
                        onChange={(e) => updateDay(key, { keywords: parseCsv(e.target.value) })}
                        className="input"
                      />
                    </label>
                    <div className="rounded-md border border-hairline bg-ink-600/30 p-2.5">
                      <p className="mb-2 text-[0.65rem] font-medium uppercase tracking-wide text-subtext">
                        Brand voice for this day
                      </p>
                      <label className="mb-2 block">
                        <span className="mb-1 block text-[0.7rem] text-subtext">Voice name</span>
                        <input
                          value={day.voice.name}
                          onChange={(e) =>
                            updateDay(key, { voice: { ...day.voice, name: e.target.value } })
                          }
                          className="input"
                        />
                      </label>
                      <label className="mb-2 block">
                        <span className="mb-1 block text-[0.7rem] text-subtext">Persona</span>
                        <textarea
                          value={day.voice.persona}
                          onChange={(e) =>
                            updateDay(key, { voice: { ...day.voice, persona: e.target.value } })
                          }
                          rows={2}
                          className="input resize-y"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[0.7rem] text-subtext">
                          Tone directives (one per line)
                        </span>
                        <textarea
                          value={lines(day.voice.toneDirectives)}
                          onChange={(e) =>
                            updateDay(key, {
                              voice: { ...day.voice, toneDirectives: parseLines(e.target.value) },
                            })
                          }
                          rows={3}
                          className="input resize-y"
                        />
                      </label>
                    </div>
                  </fieldset>
                )}
              </div>
            );
          })}
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
