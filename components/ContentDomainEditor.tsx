"use client";

// components/ContentDomainEditor.tsx
// The shared "Content & Brand" editor — content-domain.json's brand, pillars,
// enabled platforms, and voice samples, plus AI-assist drafting. Used by both
// local mode (components/Sidebar.tsx, saves via /api/domain) and folder/Drive
// mode (components/SettingsMenu.tsx, saves via provider.writeText) — the two
// callers differ only in how `onSave` persists the result.

import { useState } from "react";
import { createPortal } from "react-dom";
import type {
  BrandConfig,
  ContentDomainConfig,
  ContentPillar,
  PlatformId,
  VoiceSample,
} from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { Spinner } from "./statusBadge";
import { useToast } from "./ui";

const PLATFORM_ORDER: PlatformId[] = ["linkedin", "medium", "instagram", "youtube", "devto"];
const PLATFORM_LABELS: Record<PlatformId, string> = {
  linkedin: "LinkedIn",
  medium: "Medium",
  instagram: "Instagram",
  youtube: "YouTube",
  devto: "Dev.to",
};

function slugify(name: string, fallback: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

function emptyPillar(index: number): ContentPillar {
  return { id: `pillar-${index}`, name: "", weight: 20, keywords: [], toneHint: "" };
}

export interface ContentDomainEditorProps {
  domain: ContentDomainConfig;
  onSave: (domain: ContentDomainConfig) => Promise<void>;
  /** Needed for AI-assist when there's no server-side key (folder/Drive mode). */
  deepseekApiKey?: string;
  onClose: () => void;
}

export function ContentDomainEditor({
  domain,
  onSave,
  deepseekApiKey,
  onClose,
}: ContentDomainEditorProps): JSX.Element {
  const toast = useToast();
  // Opens read-only — the user must explicitly click "Edit" before any field
  // becomes interactive, so a stray click never changes saved settings by
  // accident. The <fieldset disabled={locked}> below disables every nested
  // input/select/textarea/button in one shot.
  const [locked, setLocked] = useState(true);
  const [brand, setBrand] = useState<BrandConfig>(domain.brand);
  const [niche, setNiche] = useState(domain.niche);
  const [description, setDescription] = useState(domain.description);
  const [pillars, setPillars] = useState<ContentPillar[]>(
    domain.pillars.length > 0 ? domain.pillars : [emptyPillar(0)],
  );
  const [enabledPlatforms, setEnabledPlatforms] = useState(domain.enabledPlatforms);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>(domain.voiceSamples);
  const [hashtagUniverse, setHashtagUniverse] = useState(domain.hashtagUniverse.join(" "));
  const [devtoTags, setDevtoTags] = useState(domain.devtoTags.join(", "));

  const [saving, setSaving] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);

  const enabledCount = PLATFORM_ORDER.filter((id) => enabledPlatforms[id] !== false).length;

  async function runAiAssist(): Promise<void> {
    if (description.trim().length === 0) {
      setAssistError("Describe your niche first — e.g. \"skincare and beauty tips for beginners\".");
      return;
    }
    setAssisting(true);
    setAssistError(null);
    try {
      const res = await fetch("/api/domain/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          brandName: brand.name,
          brand,
          enabledPlatforms,
          creds: { deepseekApiKey },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const draft = (await res.json()) as ContentDomainConfig;
      setNiche(draft.niche);
      setPillars(draft.pillars.length > 0 ? draft.pillars : pillars);
      setVoiceSamples(draft.voiceSamples);
      setHashtagUniverse(draft.hashtagUniverse.join(" "));
      setDevtoTags(draft.devtoTags.join(", "));
      toast.push("success", "Draft ready below — review and edit before saving.");
    } catch (err) {
      setAssistError(err instanceof Error ? err.message : "AI-assist failed.");
    } finally {
      setAssisting(false);
    }
  }

  function updatePillar(index: number, patch: Partial<ContentPillar>): void {
    setPillars((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function addPillar(): void {
    setPillars((prev) => [...prev, emptyPillar(prev.length)]);
  }

  function removePillar(index: number): void {
    setPillars((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function addVoiceSample(): void {
    setVoiceSamples((prev) => [...prev, { text: "" }]);
  }

  function updateVoiceSample(index: number, patch: Partial<VoiceSample>): void {
    setVoiceSamples((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeVoiceSample(index: number): void {
    setVoiceSamples((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave(): Promise<void> {
    if (brand.name.trim().length === 0) {
      toast.push("error", "Give your brand a name before saving.");
      return;
    }
    if (enabledCount === 0) {
      toast.push("error", "Enable at least one platform.");
      return;
    }
    const cleanedPillars = pillars
      .filter((p) => p.name.trim().length > 0)
      .map((p, i) => ({ ...p, id: p.id.trim() || slugify(p.name, `pillar-${i}`) }));
    if (cleanedPillars.length === 0) {
      toast.push("error", "Add at least one content pillar.");
      return;
    }
    const next: ContentDomainConfig = {
      niche,
      description,
      brand,
      pillars: cleanedPillars,
      enabledPlatforms,
      keywords: domain.keywords,
      hashtagUniverse: hashtagUniverse.split(/\s+/).map((t) => t.trim()).filter(Boolean),
      devtoTags: devtoTags.split(",").map((t) => t.trim()).filter(Boolean),
      voiceSamples: voiceSamples.filter((s) => s.text.trim().length > 0),
    };
    setSaving(true);
    try {
      await onSave(next);
      toast.push("success", "Brand & content settings saved.");
      onClose();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  // Portaled to document.body: this can be opened from inside components that
  // establish a CSS containing block for `position: fixed` (Sidebar's <aside>
  // has an active transform; SettingsMenu's <header> has backdrop-blur), which
  // would otherwise trap the "fixed" overlay inside that ancestor's box instead
  // of covering the viewport. See components/TopicDetailModal.tsx for the same
  // pattern.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Brand & content settings"
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-2xl rounded-2xl border border-hairline bg-ink-800 p-5 shadow-xl sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Brand &amp; content</h2>
            <p className="text-xs text-subtext">
              What this brand is and what it creates — your voice, your pillars, your platforms.
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

        <fieldset
          disabled={locked}
          className="mx-0 mb-0 mt-4 max-h-[70vh] min-w-0 space-y-6 overflow-y-auto border-0 p-0 pr-1"
        >
          {/* Brand */}
          <Section title="Brand">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <input
                  value={brand.name}
                  onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))}
                  className="input"
                  placeholder="Your Brand"
                />
              </Field>
              <Field label="Handle">
                <input
                  value={brand.handle}
                  onChange={(e) => setBrand((b) => ({ ...b, handle: e.target.value }))}
                  className="input font-mono"
                  placeholder="@yourbrand"
                />
              </Field>
              <Field label="Location">
                <input
                  value={brand.location}
                  onChange={(e) => setBrand((b) => ({ ...b, location: e.target.value }))}
                  className="input"
                  placeholder="City, Country"
                />
              </Field>
              <Field label="Mission (optional)">
                <input
                  value={brand.mission ?? ""}
                  onChange={(e) => setBrand((b) => ({ ...b, mission: e.target.value }))}
                  className="input"
                  placeholder="What you're helping your audience do"
                />
              </Field>
              <Field label="Roles / expertise" full>
                <input
                  value={brand.roles ?? ""}
                  onChange={(e) => setBrand((b) => ({ ...b, roles: e.target.value }))}
                  className="input"
                  placeholder="e.g. licensed esthetician and skincare educator"
                />
              </Field>
              <Field label="Areas of expertise" full>
                <input
                  value={brand.expertise ?? ""}
                  onChange={(e) => setBrand((b) => ({ ...b, expertise: e.target.value }))}
                  className="input"
                  placeholder="e.g. ingredient science, routines for sensitive skin"
                />
              </Field>
              <Field label="Medium handle (no @)">
                <input
                  value={brand.mediumHandle}
                  onChange={(e) => setBrand((b) => ({ ...b, mediumHandle: e.target.value }))}
                  className="input font-mono"
                />
              </Field>
              <Field label="Dev.to series name">
                <input
                  value={brand.devtoSeries}
                  onChange={(e) => setBrand((b) => ({ ...b, devtoSeries: e.target.value }))}
                  className="input"
                />
              </Field>
            </div>
          </Section>

          {/* Niche + AI-assist */}
          <Section
            title="Niche"
            help="A short label plus a free-text description. Describe your niche and let AI draft pillars, hashtags, and sample posts you can then edit."
          >
            <Field label="Niche label">
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="input"
                placeholder="e.g. Skincare & Beauty"
              />
            </Field>
            <Field label="Describe your niche" full>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="input resize-y"
                placeholder='e.g. "Skincare and beauty tips for people building a routine from scratch — ingredients, budget dupes, and what actually works."'
              />
            </Field>
            <button
              type="button"
              onClick={() => void runAiAssist()}
              disabled={assisting}
              className="focus-ring flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-sm font-semibold text-teal transition-colors hover:bg-teal/20 disabled:opacity-50"
            >
              {assisting ? <Spinner className="text-teal" /> : <span aria-hidden="true">✨</span>}
              {assisting ? "Drafting…" : "AI-assist: draft pillars & voice"}
            </button>
            {assistError && <p className="text-xs text-status-error">{assistError}</p>}
          </Section>

          {/* Pillars */}
          <Section
            title="Content pillars"
            help="The recurring themes your content rotates through. Each pillar gets its own tone and keyword pool."
          >
            <div className="space-y-3">
              {pillars.map((pillar, i) => (
                <div key={i} className="rounded-lg border border-hairline bg-ink-700/40 p-3">
                  <div className="flex items-start gap-2">
                    <div className="grid flex-1 grid-cols-2 gap-2">
                      <input
                        value={pillar.name}
                        onChange={(e) => updatePillar(i, { name: e.target.value })}
                        placeholder="Pillar name"
                        className="input"
                      />
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={pillar.weight}
                        onChange={(e) => updatePillar(i, { weight: Number(e.target.value) || 1 })}
                        placeholder="Weight"
                        className="input"
                        title="Relative rotation weight"
                      />
                      <input
                        value={pillar.keywords.join(", ")}
                        onChange={(e) =>
                          updatePillar(i, {
                            keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                          })
                        }
                        placeholder="Keywords, comma-separated"
                        className="input col-span-2"
                      />
                      <input
                        value={pillar.toneHint}
                        onChange={(e) => updatePillar(i, { toneHint: e.target.value })}
                        placeholder="Tone hint — how this pillar should sound"
                        className="input col-span-2"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePillar(i)}
                      disabled={pillars.length <= 1}
                      aria-label={`Remove pillar ${i + 1}`}
                      className="focus-ring mt-1 rounded p-1 text-subtext hover:text-status-error disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addPillar}
              className="focus-ring rounded-lg border border-hairline px-3 py-1.5 text-xs text-teal hover:bg-teal/10"
            >
              + Add pillar
            </button>
          </Section>

          {/* Platforms */}
          <Section
            title="Platforms"
            help="Disabled platforms are skipped entirely by the pipeline — no content, no images, no checklist entry."
          >
            <div className="flex flex-wrap gap-2">
              {PLATFORM_ORDER.map((id) => {
                const on = enabledPlatforms[id] !== false;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      setEnabledPlatforms((prev) => ({ ...prev, [id]: !on }))
                    }
                    aria-pressed={on}
                    className={`focus-ring rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      on
                        ? "border-teal/40 bg-teal/15 text-teal"
                        : "border-hairline bg-ink-700/40 text-subtext"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {PLATFORM_LABELS[id]}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Voice samples */}
          <Section
            title="Voice samples"
            help="Paste 1-3 posts you've actually written. These become the model's few-shot examples — the single biggest lever on quality. Leave empty to use generic structural examples instead."
          >
            <div className="space-y-3">
              {voiceSamples.map((sample, i) => (
                <div key={i} className="rounded-lg border border-hairline bg-ink-700/40 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      value={sample.pillarId ?? ""}
                      onChange={(e) =>
                        updateVoiceSample(i, { pillarId: e.target.value || undefined })
                      }
                      className="input w-auto text-xs"
                    >
                      <option value="">Any pillar</option>
                      {pillars
                        .filter((p) => p.name.trim().length > 0)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeVoiceSample(i)}
                      aria-label={`Remove sample ${i + 1}`}
                      className="focus-ring ml-auto rounded p-1 text-subtext hover:text-status-error"
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    value={sample.text}
                    onChange={(e) => updateVoiceSample(i, { text: e.target.value })}
                    rows={4}
                    className="input resize-y"
                    placeholder="Paste a real post in your voice…"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addVoiceSample}
              className="focus-ring rounded-lg border border-hairline px-3 py-1.5 text-xs text-teal hover:bg-teal/10"
            >
              + Add sample
            </button>
          </Section>

          {/* Hashtags + Dev.to tags */}
          <Section title="Fallback tags" help="Used only when the model's own output has too few hashtags, or for Dev.to's frontmatter.">
            <Field label="Hashtag universe (space-separated)">
              <input
                value={hashtagUniverse}
                onChange={(e) => setHashtagUniverse(e.target.value)}
                className="input font-mono"
                placeholder="#YourTag #AnotherTag"
              />
            </Field>
            <Field label="Dev.to tags (comma-separated)">
              <input
                value={devtoTags}
                onChange={(e) => setDevtoTags(e.target.value)}
                className="input font-mono"
                placeholder="webdev, tutorial"
              />
            </Field>
          </Section>
        </fieldset>

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

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className={`block ${full ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-[0.7rem] text-subtext">{label}</span>
      {children}
    </label>
  );
}
