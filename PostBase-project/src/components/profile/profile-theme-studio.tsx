"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Eye, LayoutTemplate, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DEFAULT_PROFILE_DESIGN, type ProfileDesign, type ProfileLayout, type ProfilePalette, type ProfileCardStyle } from "@/lib/profile-design";

const layouts: Array<{ id: ProfileLayout; name: string; description: string }> = [
  { id: "classic", name: "Classic", description: "A familiar, clear profile." },
  { id: "creator", name: "Creator", description: "Puts your media and links forward." },
  { id: "anime", name: "Anime-inspired", description: "Bold color and collectible-card energy." },
  { id: "portfolio", name: "Portfolio", description: "A focused home for skills and work." },
  { id: "minimal", name: "Minimal", description: "A calm, text-first presentation." },
];
const palettes: Array<{ id: ProfilePalette; name: string; colors: string }> = [
  { id: "midnight", name: "Midnight", colors: "from-slate-950 via-blue-900 to-indigo-600" },
  { id: "sakura", name: "Sakura", colors: "from-fuchsia-700 via-pink-500 to-orange-300" },
  { id: "cyber", name: "Cyber", colors: "from-cyan-500 via-blue-700 to-violet-800" },
  { id: "sunset", name: "Sunset", colors: "from-orange-500 via-rose-600 to-purple-800" },
  { id: "cloud", name: "Cloud", colors: "from-sky-300 via-blue-500 to-indigo-700" },
];
const cardStyles: Array<{ id: ProfileCardStyle; name: string }> = [{ id: "soft", name: "Soft" }, { id: "glass", name: "Glass" }, { id: "outline", name: "Outline" }];

export function ProfileThemeStudio({ design, onSaved }: { design: ProfileDesign | null | undefined; onSaved: (design: ProfileDesign) => void }) {
  const [draft, setDraft] = useState<ProfileDesign>(design ?? DEFAULT_PROFILE_DESIGN);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const previewPalette = useMemo(() => palettes.find((palette) => palette.id === draft.palette) ?? palettes[0], [draft.palette]);

  // A profile arrives asynchronously. Do not preserve an initial default over
  // an existing saved design, while still respecting edits the member has made.
  useEffect(() => {
    if (!dirty) setDraft(design ?? DEFAULT_PROFILE_DESIGN);
  }, [design, dirty]);

  const updateDraft = (update: Partial<ProfileDesign>) => {
    if (saving) return;
    setDraft((current) => ({ ...current, ...update }));
    setDirty(true);
    setError(null);
    setSuccess(null);
  };

  const save = async () => {
    const designToSave = draft;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileDesign: designToSave }) });
      if (!response.ok) throw new Error("Unable to save your profile theme.");
      onSaved(designToSave);
      setDirty(false);
      setSuccess("Your profile theme is saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save your profile theme."); }
    finally { setSaving(false); }
  };
  return <Card className="overflow-hidden">
    <CardHeader className="border-b border-surface-border bg-surface-light-blue/60"><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-brand-purple" /> Profile Theme Studio</CardTitle><CardDescription>Choose a reusable layout and style. Your name, username, and safety controls stay consistent for every visitor.</CardDescription></CardHeader>
    <CardContent className="space-y-6 p-4 sm:p-6">
      <section aria-labelledby="layout-heading"><h3 id="layout-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-navy-800"><LayoutTemplate className="h-4 w-4" /> Layout</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{layouts.map((layout) => { const selected = draft.layout === layout.id; return <button key={layout.id} type="button" disabled={saving} onClick={() => updateDraft({ layout: layout.id })} className={cn("min-h-28 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60", selected ? "border-brand-purple bg-brand-purple/5 shadow-sm" : "border-surface-border hover:bg-surface-light-blue")} aria-pressed={selected}><span className="mb-3 block h-8 rounded-md bg-gradient-to-r from-brand-purple/90 via-brand-blue to-brand-blue-light" aria-hidden="true" /><span className="flex items-center justify-between text-sm font-semibold text-navy-800">{layout.name}{selected && <Check className="h-4 w-4 text-brand-purple" />}</span><span className="mt-1 block text-xs text-muted-foreground">{layout.description}</span></button>; })}</div></section>
      <section aria-labelledby="palette-heading"><h3 id="palette-heading" className="mb-3 text-sm font-semibold text-navy-800">Palette</h3><div className="flex flex-wrap gap-2">{palettes.map((palette) => { const selected = draft.palette === palette.id; return <button key={palette.id} type="button" disabled={saving} onClick={() => updateDraft({ palette: palette.id })} aria-pressed={selected} className={cn("flex min-h-11 items-center gap-2 rounded-full border px-2 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60", selected ? "border-brand-purple" : "border-surface-border hover:bg-surface-light-blue")}><span className={cn("h-7 w-7 rounded-full bg-gradient-to-br", palette.colors)} aria-hidden="true" />{palette.name}</button>; })}</div></section>
      <section aria-labelledby="style-heading"><h3 id="style-heading" className="mb-3 text-sm font-semibold text-navy-800">Card style</h3><div className="flex flex-wrap gap-2">{cardStyles.map((style) => <Button key={style.id} type="button" size="sm" variant={draft.cardStyle === style.id ? "default" : "outline"} onClick={() => updateDraft({ cardStyle: style.id })} aria-pressed={draft.cardStyle === style.id} disabled={saving}>{style.name}</Button>)}</div></section>
      <label className={cn("flex items-start gap-3 rounded-xl border border-surface-border p-4", saving ? "cursor-not-allowed opacity-60" : "cursor-pointer")}><input type="checkbox" checked={draft.reducedMotion} disabled={saving} onChange={(event) => updateDraft({ reducedMotion: event.target.checked })} className="mt-1 h-4 w-4 accent-brand-purple" /><span><span className="block text-sm font-semibold text-navy-800">Use a calm profile</span><span className="mt-1 block text-xs text-muted-foreground">Turn off optional theme motion. Visitors can always choose their own reduced-motion and Standard-view settings.</span></span></label>
      <div className={cn("rounded-2xl bg-gradient-to-br p-4 text-white shadow-inner", previewPalette.colors)} aria-label="Theme preview"><div className={cn("max-w-sm p-4", draft.cardStyle === "glass" ? "rounded-2xl border border-white/30 bg-white/15 backdrop-blur" : draft.cardStyle === "outline" ? "rounded-2xl border-2 border-white/80" : "rounded-2xl bg-white/15 shadow-lg")}><div className="flex items-center gap-3"><span className="h-12 w-12 rounded-full border-2 border-white/80 bg-white/30" aria-hidden="true" /><span><span className="block font-bold">Your profile</span><span className="text-sm text-white/80">@username</span></span></div><p className="mt-3 text-sm text-white/90">{layouts.find((layout) => layout.id === draft.layout)?.description}</p></div></div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {success && <p role="status" aria-live="polite" className="text-sm text-emerald-700">{success}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="flex items-center gap-1 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" /> Custom backgrounds are managed through Cover studio.</p><Button type="button" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Saving…" : "Save theme"}</Button></div>
    </CardContent>
  </Card>;
}
