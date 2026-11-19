"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FilterChip } from "@/components/shared/filter-chip";
import { ProfileThemePreview, type ProfileThemePreviewIdentity } from "@/components/profile-theme-studio/profile-theme-preview";
import { cn } from "@/lib/utils";
import {
  availableProfileThemeStyles,
  MAX_PROFILE_THEME_DECORATIONS,
  MAX_PROFILE_THEME_DECORATION_BYTES,
  PROFILE_THEME_DECORATION_ACCEPT,
  normalizeProfileThemeConfig,
  orderedProfileThemeBlocks,
  profileThemeBlocks,
  profileThemeDecorationZones,
  profileThemeLayoutById,
  profileThemeLayouts,
  profileThemeStyleById,
  standardProfileThemeConfig,
  type ProfileThemeConfig,
  type ProfileThemeDecoration,
  type ProfileThemeDecorationZone,
} from "@/lib/profile-theme";
import { ArrowDown, ArrowUp, Eye, Loader2, Palette, Save, Sparkles, Upload, X } from "lucide-react";

/** Like Cover Studio: the cards sit on a dark studio surface. */
const PANEL = "border-white/10 bg-[#0f172a]";

/** A staged decoration the member has picked but not published yet. */
interface StagedDecoration {
  id: string;
  zone: ProfileThemeDecorationZone;
  /** The local data URL while staged, the stored URL once saved. */
  url: string | null;
  file: File | null;
}

/**
 * The config the preview renders: saved decorations keep their stored URLs,
 * and staged ones show the local data URL they were picked with. Nothing here
 * knows about the save serialization — that is `saveDecorationList`.
 */
function previewDecorationList(staged: StagedDecoration[], config: ProfileThemeConfig): ProfileThemeDecoration[] {
  return [
    ...config.decorations.filter((decoration) => !staged.some((entry) => entry.id === decoration.id)),
    ...staged.map(({ id, zone, url }) => ({ id, url: url ?? "", zone })),
  ];
}

/**
 * The config as the save request serializes it: staged decorations become
 * `url: null` entries in the same order their files are appended — the route
 * fills each null from the file at that position. A null is exactly what
 * `normalizeProfileThemeConfig` refuses, which is the point: the *stored*
 * config cannot carry a stub that never became an upload, and a data URL
 * should never be stored as if it were one.
 */
function saveDecorationList(staged: StagedDecoration[]): ProfileThemeDecoration[] {
  return staged.map(({ id, zone }) => ({ id, url: null, zone }));
}

/**
 * The Profile Theme Studio, as a tab of the profile beside Cover Studio.
 *
 * It edits the member's *theme*: a layout, one of the contrast-checked
 * styles, which optional blocks show and in what order, decorations pinned to
 * fixed zones, and whether the style's ambient motion runs. It saves the whole
 * shape to `/api/profile/theme` in one action; the Standard view toggle shows
 * the plain profile beside the themed one, and "Save standard profile" writes
 * the off-state, which is also what a member who changed their mind gets back
 * to.
 */
export function ProfileThemeStudio() {
  const { user, isLoading: authLoading } = useAuth();
  const decorationInputRef = useRef<HTMLInputElement>(null);

  const [config, setConfig] = useState<ProfileThemeConfig>(standardProfileThemeConfig);
  const [staged, setStaged] = useState<StagedDecoration[]>([]);
  const [compareStandard, setCompareStandard] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [loadingTheme, setLoadingTheme] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The reduced-motion preference, read once at mount and listened to. The
   * switch may stay on in the config, but the preview — and the published
   * theme — still answer to this: the config asks, the viewer's system
   * decides.
   */
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (authLoading || !user) {
      if (!authLoading) {
        setLoadingTheme(false);
        setLoadFailed(false);
      }
      return;
    }
    let cancelled = false;
    const loadTheme = async () => {
      try {
        const response = await fetch("/api/profile/theme");
        if (!response.ok) {
          if (!cancelled) setLoadFailed(true);
          return;
        }
        const payload = (await response.json()) as { themeConfig?: unknown };
        const stored = normalizeProfileThemeConfig(payload.themeConfig);
        if (!cancelled && stored) setConfig(stored);
        // A stored config that fails validation is the Standard view, not a
        // broken editor: the fallback is the same config a first-time studio
        // opens with.
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoadingTheme(false);
      }
    };
    void loadTheme();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const identity: ProfileThemePreviewIdentity = {
    name: user?.name || user?.email?.split("@")[0] || "Your name",
    username: user?.username ?? null,
    bio: user?.user_metadata?.bio ?? user?.user_metadata?.description ?? null,
    avatarUrl: user?.image ?? user?.user_metadata?.avatar_url ?? null,
    location: (user?.user_metadata?.location as string | undefined) ?? null,
    website: (user?.user_metadata?.website as string | undefined) ?? null,
  };

  const selectedStyle = profileThemeStyleById(config.styleId);
  const selectedLayout = profileThemeLayoutById(config.layoutId);
  const availableStyles = availableProfileThemeStyles();

  const previewConfig: ProfileThemeConfig = compareStandard
    ? { ...standardProfileThemeConfig }
    : { ...config, decorations: previewDecorationList(staged, config) };

  const handleStagedList = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length !== files.length) {
      setError("Decorations must be images (PNG, JPG, WebP or GIF).");
      return;
    }
    const tooLarge = images.find((file) => file.size > MAX_PROFILE_THEME_DECORATION_BYTES);
    if (tooLarge) {
      setError(`"${tooLarge.name}" is over 5 MB.`);
      return;
    }
    if (staged.length + images.length > MAX_PROFILE_THEME_DECORATIONS) {
      setError(`You can pin up to ${MAX_PROFILE_THEME_DECORATIONS} decorations.`);
      return;
    }

    void Promise.all(
      images.map(
        (file) =>
          new Promise<StagedDecoration>((resolve) => {
            const id = `deco-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const reader = new FileReader();
            reader.onload = () => resolve({ id, zone: "corner-top-right" as ProfileThemeDecorationZone, url: String(reader.result), file });
            reader.readAsDataURL(file);
          }),
      ),
    ).then((newStaged) => {
      setStaged((previous) => [...previous, ...newStaged]);
      setError(null);
    });
  };

  const removeStaged = (id: string) => {
    setStaged((previous) => previous.filter((decoration) => decoration.id !== id));
    setConfig((previous) => ({ ...previous, decorations: previous.decorations.filter((decoration) => decoration.id !== id) }));
    setSaved(false);
  };

  const setStagedZone = (id: string, zone: ProfileThemeDecorationZone) => {
    setStaged((previous) => previous.map((decoration) => (decoration.id === id ? { ...decoration, zone } : decoration)));
  };

  /**
   * Moving one block one step along the position list: positions are swapped
   * with the neighbor so the list stays a clean permutation — the shape the
   * validator and the preview both require.
   */
  const moveBlock = (id: string, direction: -1 | 1) => {
    setConfig((previous) => {
      const ordered = orderedProfileThemeBlocks(previous);
      const index = ordered.findIndex((placement) => placement.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= ordered.length) return previous;
      const moved = [...ordered];
      const swap = moved[index]!;
      moved[index] = moved[target]!;
      moved[target] = swap;
      return { ...previous, blocks: moved.map((placement, position) => ({ ...placement, position })) };
    });
    setSaved(false);
  };

  const toggleBlock = (id: string) => {
    setConfig((previous) => ({
      ...previous,
      blocks: previous.blocks.map((placement) =>
        placement.id === id ? { ...placement, included: !placement.included } : placement,
      ),
    }));
    setSaved(false);
  };

  const toggleMotion = (checked: boolean) => {
    setConfig((previous) => ({ ...previous, motion: checked }));
    setSaved(false);
  };

  const saveTheme = async (next: ProfileThemeConfig) => {
    if (authLoading || !user) {
      setError("Sign in before saving your theme.");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const form = new FormData();
      form.append("config", JSON.stringify({ ...next, decorations: saveDecorationList(staged) }));
      for (const decoration of staged) {
        if (decoration.file) form.append("decorations", decoration.file, `${decoration.id}-${decoration.file.name}`);
      }
      const response = await fetch("/api/profile/theme", { method: "POST", body: form });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Unable to save your theme.");
      }
      const payload = (await response.json()) as { themeConfig?: unknown };
      const stored = normalizeProfileThemeConfig(payload.themeConfig);
      if (stored) {
        // The stored config — with the uploaded URLs — becomes the working
        // copy, and the staged files are now history the config owns.
        setConfig(stored);
        setStaged([]);
      }
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save your theme.");
    } finally {
      setSaving(false);
    }
  };

  /** The themed save button, unless the Standard comparison is over the save. */
  const savingStandard = compareStandard;

  const disableDuringLoad = authLoading || loadingTheme || saving;

  return (
    <div className="overflow-hidden rounded-xl bg-[#0a0f1a] text-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-2">
          <Palette className="h-6 w-6 text-brand-blue" />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-white/80">
            Profile Theme Studio
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/60">
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            <button
              type="button"
              onClick={() => setCompareStandard((value) => !value)}
              className="rounded px-1 underline decoration-dotted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {compareStandard ? "Previewing Standard — show themed" : "Previewing themed — show Standard"}
            </button>
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            {availableStyles.length} styles
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {loadFailed && (
          <p className="mb-4 text-xs text-white/50">
            Your saved theme could not be read right now — the studio opens on the Standard defaults. Saving will try again.
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {/* Preview */}
            <Card className={PANEL}>
              <CardContent className="p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">
                    {compareStandard ? "Standard view" : config.standard ? "Standard view (theme off)" : `${selectedLayout?.name} · ${selectedStyle?.name}`}
                  </p>
                  <p className="text-xs text-white/50">
                    {reducedMotion && "System asks for reduced motion — preview is still."}
                  </p>
                </div>
                <div className="mx-auto max-w-[560px]">
                  <ProfileThemePreview config={previewConfig} identity={identity} reducedMotion={reducedMotion} />
                </div>
                <p className="mt-2 text-center text-[10px] text-white/40">
                  Blocks show sample content — your real posts and photos fill them on the profile.
                </p>
              </CardContent>
            </Card>

            {/* Layout picker */}
            <Card className={PANEL}>
              <CardContent className="p-3 sm:p-4">
                <div
                  role="group"
                  aria-label="Template layouts"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {profileThemeLayouts.map((layout) => (
                    <button
                      key={layout.id}
                      type="button"
                      aria-pressed={config.layoutId === layout.id}
                      onClick={() => {
                        setConfig((previous) => ({ ...previous, layoutId: layout.id, standard: false }));
                        setSaved(false);
                      }}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        config.layoutId === layout.id
                          ? "border-brand-blue bg-brand-blue/10"
                          : "border-white/10 hover:border-white/30",
                      )}
                    >
                      <p className="text-sm font-semibold text-white">{layout.name}</p>
                      <p className="mt-0.5 text-xs text-white/50">{layout.description}</p>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-white/40">
                  Every layout keeps your name, photo and safety controls in a fixed, recognizable place.
                </p>
              </CardContent>
            </Card>

            {/* Style picker — only styles that pass the contrast safeguard. */}
            <Card className={PANEL}>
              <CardContent className="p-3 sm:p-4">
                <div
                  role="group"
                  aria-label="Safe anime-inspired styles"
                  className="flex flex-wrap gap-2"
                >
                  {availableStyles.map((style) => (
                    <FilterChip
                      key={style.id}
                      selected={config.styleId === style.id}
                      surface="dark"
                      onClick={() => {
                        setConfig((previous) => ({ ...previous, styleId: style.id, standard: false }));
                        setSaved(false);
                      }}
                    >
                      {style.name}
                    </FilterChip>
                  ))}
                </div>
                <p className="mt-2 text-xs text-white/50">{selectedStyle?.description}</p>
                <p className="mt-1 text-[10px] text-white/40">
                  Styles ship as fixed, contrast-checked palettes — original motifs, no fan art — so your profile is always readable.
                </p>
              </CardContent>
            </Card>

            {/* Movable optional blocks */}
            <Card className={PANEL}>
              <CardContent className="p-3 sm:p-4">
                <p className="mb-2 text-sm font-semibold text-white">Blocks</p>
                <ul className="space-y-2" aria-label="Optional blocks">
                  {orderedProfileThemeBlocks(config).map((placement) => {
                    const block = profileThemeBlocks.find((candidate) => candidate.id === placement.id);
                    if (!block) return null;
                    const first = placement.position === 0;
                    const last = placement.position === config.blocks.length - 1;
                    return (
                      <li
                        key={placement.id}
                        className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <Switch
                          checked={placement.included}
                          onCheckedChange={() => toggleBlock(placement.id)}
                          aria-label={`${placement.included ? "Remove" : "Add"} ${block.name} block`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white">{block.name}</p>
                          <p className="truncate text-xs text-white/50">{block.description}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 border-white/20 p-0 text-white hover:bg-white/10"
                            onClick={() => moveBlock(placement.id, -1)}
                            disabled={first}
                            aria-label={`Move ${block.name} up`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 border-white/20 p-0 text-white hover:bg-white/10"
                            onClick={() => moveBlock(placement.id, 1)}
                            disabled={last}
                            aria-label={`Move ${block.name} down`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            {/* Decorations */}
            <Card className={PANEL}>
              <CardContent className="p-3 sm:p-4">
                <p className="mb-2 text-sm font-semibold text-white">Decorations</p>
                <Button
                  type="button"
                  variant="onDark"
                  className="w-full border-dashed"
                  onClick={() => decorationInputRef.current?.click()}
                  disabled={staged.length >= MAX_PROFILE_THEME_DECORATIONS}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Pin your own art ({staged.length}/{MAX_PROFILE_THEME_DECORATIONS})
                </Button>
                <input
                  ref={decorationInputRef}
                  type="file"
                  accept={PROFILE_THEME_DECORATION_ACCEPT}
                  className="hidden"
                  onChange={handleStagedList}
                />
                <p className="mt-2 text-[10px] text-white/40">
                  PNG, JPG, WebP or GIF up to 5 MB each. Decorations sit in fixed corners — never over your name, photo or text.
                </p>
                {(staged.length > 0 || config.decorations.length > 0) && (
                  <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {staged.map((decoration) => (
                      <li key={decoration.id} className="relative rounded-lg border border-white/10 bg-white/5 p-2">
                        <button
                          type="button"
                          onClick={() => removeStaged(decoration.id)}
                          aria-label="Remove decoration"
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        {decoration.url && (
                          <img
                            src={decoration.url}
                            alt="Decoration to pin"
                            className="h-16 w-full rounded object-contain"
                          />
                        )}
                        <Label htmlFor={`zone-${decoration.id}`} className="mt-1 block text-[10px] text-white/60">
                          Placement
                        </Label>
                        <select
                          id={`zone-${decoration.id}`}
                          value={decoration.zone}
                          onChange={(event) => setStagedZone(decoration.id, event.target.value as ProfileThemeDecorationZone)}
                          className="mt-0.5 w-full rounded border border-white/20 bg-[#0f172a] px-1 py-0.5 text-[10px] text-white"
                        >
                          {profileThemeDecorationZones.map((zone) => (
                            <option key={zone.id} value={zone.id}>
                              {zone.name}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                    {/* Saved decorations that are not restaged this session: shown for context. */}
                    {config.decorations
                      .filter((decoration) => !staged.some((stagedDecoration) => stagedDecoration.id === decoration.id))
                      .map((decoration) => (
                        <li key={decoration.id} className="rounded-lg border border-white/10 bg-white/5 p-2">
                          <img
                            src={decoration.url ?? ""}
                            alt="Saved decoration"
                            className="h-16 w-full rounded object-contain"
                          />
                          <p className="mt-1 text-[10px] text-white/60">
                            {profileThemeDecorationZones.find((zone) => zone.id === decoration.zone)?.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => removeStaged(decoration.id)}
                            className="mt-1 text-[10px] text-white/50 underline hover:text-white"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-3">
            <Card className={PANEL}>
              <CardContent className="space-y-3 p-4">
                {/* The switch is named by `aria-label`: the app's `Switch` types
                    an accessible name as either that or a labelled pair, and a
                    `Label[htmlFor]` beside it named nothing the switch heard. */}
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-white text-sm font-semibold">Ambient motion</Label>
                  <Switch
                    aria-label="Ambient motion"
                    checked={config.motion && !reducedMotion}
                    onCheckedChange={toggleMotion}
                    disabled={reducedMotion || !(selectedStyle?.motionCapable ?? false)}
                  />
                </div>
                <p className="text-xs text-white/50 leading-relaxed">
                  {reducedMotion
                    ? "Your system asks for reduced motion, so the live theme will stay still too."
                    : selectedStyle?.motionCapable
                      ? "Style motifs drift gently. The published theme respects every reader's own motion setting."
                      : `${selectedStyle?.name} is a still style — nothing animates.`}
                </p>
              </CardContent>
            </Card>

            <Card className={PANEL}>
              <CardContent className="space-y-3 p-4">
                <p className="text-sm font-semibold text-white">
                  {savingStandard ? "Save standard profile" : "Save theme"}
                </p>
                <p className="text-xs text-white/50 leading-relaxed">
                  {savingStandard
                    ? "Saves the theme off: your profile renders the Standard view it has today."
                    : "Saves layout, style, blocks and decorations in one write. Identity and safety controls are not part of it — they keep their place in every layout."}
                </p>
                <Button
                  className="w-full bg-brand-blue text-white hover:bg-brand-blue/90"
                  onClick={() =>
                    saveTheme(
                      savingStandard
                        ? { ...standardProfileThemeConfig, standard: true }
                        : { ...config, standard: false },
                    )
                  }
                  disabled={disableDuringLoad || !user}
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : saved ? (
                    "Saved"
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      {savingStandard ? "Save standard profile" : "Save theme"}
                    </>
                  )}
                </Button>
                <p className="text-[10px] text-white/40">
                  Your identity zone and safety controls are fixed in every layout and style.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
