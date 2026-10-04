"use client";

import { useRef, useState, useCallback } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  COVER_CANVAS_HEIGHT,
  ShortVideoCanvas,
} from "@/components/cover-studio/short-video-canvas";
import {
  coverVideoFileName,
  isCoverVideoRecordingSupported,
  recordCoverVideo,
} from "@/components/cover-studio/record-cover-video";
import { FilterChip } from "@/components/shared/filter-chip";
import {
  shortVideoTemplates,
  shortVideoCategories,
  type CoverTemplateId,
} from "@/components/cover-studio/short-video-templates";
import {
  Eye,
  Film,
  ImageIcon,
  Images,
  Palette,
  Play,
  Save,
  Star,
  Loader2,
  Link2,
  Upload,
  Sparkles,
  X,
} from "lucide-react";

const BACKGROUND_MODES = [
  { value: "color", label: "Color", icon: Palette },
  { value: "video", label: "Video", icon: Film },
  { value: "photo", label: "Pictures", icon: Images },
] as const;

/**
 * The pictures that build the animated wall. Two is the least that reads as a
 * wall rather than one backdrop, and the cap keeps a single publish inside the
 * upload limit.
 */
const MIN_PHOTOS = 2;
const MAX_PHOTOS = 12;

/**
 * A stable empty list. The canvas restarts its render effect when the picture
 * array's identity changes, so this has to be one constant rather than a fresh
 * `[]` on every render.
 */
const EMPTY_PHOTOS: string[] = [];

/** Maps a data URL's mime type to the extension the upload API expects. */
function extensionForType(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("mp4")) return "mp4";
  if (type.includes("webm")) return "webm";
  if (type.includes("quicktime")) return "mov";
  return "jpg";
}

const SPEEDS = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
] as const;

/**
 * The surface every panel on this page sits on.
 *
 * The page is a dark studio — `bg-[#0a0f1a]` on the wrapper, and every heading,
 * label, input, chip and panel inside these cards styled in white and
 * white-at-an-opacity. The cards themselves were left on `Card`'s own white,
 * which made all of that invisible: a `text-white` heading on a white card, and
 * chips that were solid white pills with white text on them.
 *
 * It is one constant rather than a class repeated per card because the two
 * together are one decision, and a card that keeps the dark border but loses the
 * dark background is exactly the bug this fixes.
 */
const PANEL = "border-white/10 bg-[#0f172a]";

/**
 * The cover studio, as a piece of the profile rather than a page of its own.
 *
 * It was `/cover-studio`, in the main navigation, which made a member's own
 * cover look like a module of the app beside Marketplace and Jobs. What it
 * actually is is the last step of setting up a profile, so it renders inside the
 * profile's "Cover studio" tab, and `/cover-studio` redirects there for the
 * bookmarks that exist.
 *
 * Nothing else changed in the move: it still reads the session, still writes the
 * cover through the same endpoints, and is still mounted only where a signed-in
 * member can see it.
 */
export function CoverStudio() {
  const { user, isLoading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgVideoInputRef = useRef<HTMLInputElement>(null);
  const bgPhotosInputRef = useRef<HTMLInputElement>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState<CoverTemplateId>("marquee-wall");
  const [category, setCategory] = useState("All");
  const [backgroundMode, setBackgroundMode] = useState<"color" | "video" | "photo">("color");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [bgVideo, setBgVideo] = useState<string | null>(null);
  const [bgPhotos, setBgPhotos] = useState<string[]>([]);
  const [bgColor, setBgColor] = useState("#071426");
  const [subtitle, setSubtitle] = useState("");
  const [productLabel, setProductLabel] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [speed, setSpeed] = useState<"slow" | "normal" | "fast">("slow");
  const [duration, setDuration] = useState(8);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // profile frame drag/resize state
  const [profileOffsetX, setProfileOffsetX] = useState(0);
  const [profileOffsetY, setProfileOffsetY] = useState(0);
  const [profileRadius, setProfileRadius] = useState<number | undefined>(undefined);
  const handleProfileChange = useCallback(
    (offsetX: number, offsetY: number, radius: number) => {
      setProfileOffsetX(offsetX);
      setProfileOffsetY(offsetY);
      setProfileRadius(radius);
    },
    [],
  );

  const selectedTemplate = shortVideoTemplates.find((t) => t.id === selectedTemplateId);

  const filteredTemplates = shortVideoTemplates.filter((t) =>
    category === "All" || 
    (category === "Color" && t.backgroundMode === "color") ||
    (category === "Video" && t.backgroundMode === "video") ||
    (category === "Subtitle" && t.showSubtitle) ||
    (category === "Product" && t.showProductChip)
  );

  const handleProfileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Profile photo must be an image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Profile photo must be under 10 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfilePhoto(String(reader.result));
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleBgVideoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Background must be a video file.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("Background video must be under 50 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBgVideo(String(reader.result));
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  // Several pictures at once: they are held as data URLs, because a canvas that
  // has drawn a cross-origin image cannot be captured, and every picture here is
  // drawn onto the recording canvas.
  const handleBgPhotosUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length !== files.length) {
      setError("Pictures must be images (JPG, PNG or WebP).");
      return;
    }
    const tooLarge = images.find((file) => file.size > 10 * 1024 * 1024);
    if (tooLarge) {
      setError(`"${tooLarge.name}" is over 10 MB.`);
      return;
    }
    if (bgPhotos.length + images.length > MAX_PHOTOS) {
      setError(`You can use up to ${MAX_PHOTOS} pictures.`);
      return;
    }

    void Promise.all(
      images.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(file);
          }),
      ),
    ).then((urls) => {
      setBgPhotos((previous) => [...previous, ...urls]);
      setError(null);
    });
  };

  const removeBgPhoto = (index: number) => {
    setBgPhotos((previous) => previous.filter((_, position) => position !== index));
  };

  const triggerProfileUpload = () => fileInputRef.current?.click();
  const triggerBgVideoUpload = () => bgVideoInputRef.current?.click();
  const triggerBgPhotosUpload = () => bgPhotosInputRef.current?.click();

  /** Reads a data URL back into a File, so previews can be uploaded as-is. */
  const dataUrlToFile = async (dataUrl: string, baseName: string): Promise<File> => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const type = blob.type || "image/jpeg";
    return new File([blob], `${baseName}.${extensionForType(type)}`, { type });
  };

  /**
   * Records the preview and publishes it as the profile's cover video.
   *
   * The clip is captured from the live canvas, so the studio switches the canvas
   * into recording mode first: otherwise a reduced-motion preference or a preview
   * scrolled out of view would record a single frozen frame.
   */
  const publishCoverVideo = async () => {
    if (authLoading || !user) {
      setError("Sign in before publishing.");
      return;
    }
    if (!profilePhoto) {
      setError("Add a profile photo first.");
      return;
    }
    if (backgroundMode === "photo" && bgPhotos.length < MIN_PHOTOS) {
      setError(`Add at least ${MIN_PHOTOS} pictures to build the cover video.`);
      return;
    }
    if (!canvasEl) {
      setError("The preview is still starting up. Try again in a moment.");
      return;
    }
    if (!isCoverVideoRecordingSupported()) {
      setError("This browser cannot record video. Try Chrome, Edge, or Safari.");
      return;
    }

    setIsPublishing(true);
    setSaved(false);
    setError(null);
    setRenderProgress(0);
    setRecording(true);
    try {
      // One frame for the canvas to leave pause/reduced-motion and start drawing.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      const { blob, mimeType } = await recordCoverVideo({
        canvas: canvasEl,
        durationMs: duration * 1000,
        onProgress: setRenderProgress,
      });

      const form = new FormData();
      form.append("video", new File([blob], coverVideoFileName(mimeType), { type: mimeType }));
      form.append("profilePhoto", await dataUrlToFile(profilePhoto, "profile"));
      if (backgroundMode === "photo") {
        for (const [index, picture] of bgPhotos.entries()) {
          form.append("photos", await dataUrlToFile(picture, `picture-${index}`));
        }
      }
      if (backgroundMode === "video" && bgVideo) {
        form.append("backgroundVideo", await dataUrlToFile(bgVideo, "background"));
      }
      form.append("templateId", selectedTemplateId);
      form.append("subtitle", subtitle.slice(0, 120));
      form.append("productLabel", productLabel.slice(0, 60));
      form.append("productUrl", productUrl.slice(0, 2048));
      form.append("speed", speed);
      form.append("duration", String(duration));
      form.append("aspectRatio", "2.7:1");
      form.append("profileOffsetX", String(profileOffsetX));
      form.append("profileOffsetY", String(profileOffsetY));
      form.append(
        "profileRadius",
        String(profileRadius ?? Math.round(COVER_CANVAS_HEIGHT * 0.24)),
      );

      const response = await fetch("/api/short-video-covers", { method: "POST", body: form });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to publish the cover video.");
      }
      setSaved(true);
      // Back to the profile, and to this tab: the member was already there, and
      // the reload is what reads the cover video they just published.
      setTimeout(() => window.location.assign("/profile?tab=cover"), 800);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Unable to publish.");
    } finally {
      setRecording(false);
      setIsPublishing(false);
      setRenderProgress(0);
    }
  };

  return (
    // Sized by its content rather than by the viewport, and a panel rather than
    // a page: it is mounted inside the profile's tab, where `min-h-screen` would
    // have pushed the footer a screen down. The dark shell stays, because the
    // studio's own preview controls are drawn for it.
    <div className="overflow-hidden rounded-xl bg-[#0a0f1a] text-white">
      {/* A div, not a `header`: inside the profile this is part of a tab, not
          the top of the document. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-6 w-6 text-brand-blue" />
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-white/80">
              LinkMe+ Cover Studio
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/60">
            <span className="flex items-center gap-1"><Play className="h-3 w-3" /> Profile cover video</span>
            <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> {shortVideoTemplates.length} templates</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Main: Preview + Editor */}
          <div className="min-w-0 space-y-4">
            {/* Cover preview — the profile banner's 2.7:1 frame */}
            <Card className={cn("overflow-hidden", PANEL)}>
              <CardContent className="p-2 sm:p-3">
                <div className="relative mx-auto aspect-[2.7/1] w-full max-w-[520px] overflow-hidden rounded-xl border border-white/20 shadow-2xl">
                  <ShortVideoCanvas
                    template={selectedTemplate!}
                    profilePhoto={profilePhoto}
                    backgroundVideo={backgroundMode === "video" ? bgVideo : null}
                    backgroundPhoto={backgroundMode === "photo" ? (bgPhotos[0] ?? null) : null}
                    backgroundPhotos={backgroundMode === "photo" ? bgPhotos : EMPTY_PHOTOS}
                    backgroundColor={backgroundMode === "color" ? bgColor : undefined}
                    aspectRatio="cover"
                    recording={recording}
                    subtitle={subtitle}
                    productLabel={productLabel}
                    speed={speed}
                    duration={duration}
                    isPlaying={isPlaying}
                    profileOffsetX={profileOffsetX}
                    profileOffsetY={profileOffsetY}
                    profileRadius={profileRadius}
                    onProfileChange={handleProfileChange}
                    onCanvasReady={setCanvasEl}
                  />
                  {/* Overlay badges */}
                  <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white backdrop-blur">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    LIVE
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPlaying((p) => !p)}
                    className="absolute bottom-3 right-3 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/70"
                  >
                    {isPlaying ? "Pause" : "Play"}
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-3">
                  <p className="text-xs text-white/50">
                    1200×444 · loops on your profile banner · no sound
                  </p>
                  <p className="text-xs text-white/50">
                    {recording ? "Recording the cover video…" : "Drag the centre to reposition"}
                  </p>
                </div>
                {isPublishing && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full bg-brand-blue transition-all duration-300"
                        style={{ width: `${Math.round(renderProgress * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Template picker */}
            <Card className={PANEL}>
              <CardContent className="p-3 sm:p-4">
                <div
                  role="group"
                  aria-label="Filter templates by category"
                  className="mb-3 flex gap-2 overflow-x-auto pb-1"
                >
                  {shortVideoCategories.map((cat) => (
                    <FilterChip
                      key={cat}
                      selected={category === cat}
                      surface="dark"
                      onClick={() => setCategory(cat)}
                    >
                      {cat}
                    </FilterChip>
                  ))}
                </div>
                <p className="text-xs text-white/50 mb-3">
                  {filteredTemplates.length} templates · your pictures become the moving wall
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {filteredTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => {
                        setSelectedTemplateId(template.id);
                        setBackgroundMode(template.backgroundMode);
                      }}
                      className={cn(
                        "relative aspect-video overflow-hidden rounded-lg border-2 text-left transition-all",
                        selectedTemplateId === template.id
                          ? "border-brand-blue ring-2 ring-brand-blue/30"
                          : "border-white/10 hover:border-white/30",
                      )}
                    >
                      {/* thumbnail preview */}
                      <img
                        src={template.thumb}
                        alt={template.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-[10px] font-semibold text-white">
                        {template.name}
                      </span>
                      {selectedTemplateId === template.id && (
                        <div className="absolute top-1.5 right-1.5 flex h-5 items-center gap-1 rounded-full bg-brand-blue px-2 text-[10px] font-bold text-white">
                          <Star className="h-3 w-3" />
                          Selected
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Upload + Edit section */}
            <Card className={PANEL}>
              <CardContent className="p-3 sm:p-4">
                <h3 className="text-sm font-semibold text-white mb-3">Your content</h3>

                {/* Profile photo */}
                <div className="mb-4">
                  <Label className="text-white/80 text-xs">Profile photo (required)</Label>
                  {profilePhoto ? (
                    <div className="mt-2 flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2">
                      <img
                        src={profilePhoto}
                        alt="Profile"
                        className="h-14 w-14 rounded-full object-cover ring-2 ring-brand-blue/50"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-white/20 text-white hover:bg-white/10"
                        onClick={triggerProfileUpload}
                      >
                        <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
                        Change
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="onDark"
                      className="w-full border-dashed"
                      onClick={triggerProfileUpload}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Drop your profile photo
                    </Button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProfileUpload}
                  />
                </div>

                {/* Background */}
                <div className="mb-4">
                  <Label className="text-white/80 text-xs mb-2">Background</Label>
                  <div role="group" aria-label="Background" className="flex gap-2">
                    {BACKGROUND_MODES.map(({ value, label, icon: Icon }) => (
                      <FilterChip
                        key={value}
                        selected={backgroundMode === value}
                        surface="dark"
                        onClick={() => setBackgroundMode(value)}
                      >
                        <Icon className="mr-1.5 h-3.5 w-3.5" />
                        {label}
                      </FilterChip>
                    ))}
                  </div>

                  {backgroundMode === "color" && (
                    <div className="mt-3 flex items-center gap-3">
                      {/* The label was beside the swatch, not attached to it, so
                          neither field had a name: a `Label` only names a
                          control through `htmlFor`, or by wrapping it. The hex
                          field had a placeholder, which is the spec's last
                          resort and reads as "#071426", so it is named too. */}
                      <Label htmlFor="cover-background-color" className="text-white/60 text-xs">
                        Color
                      </Label>
                      <Input
                        id="cover-background-color"
                        type="color"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        className="h-10 w-16 rounded border-white/20 bg-white/5 p-0 text-transparent cursor-pointer"
                      />
                      <Input
                        aria-label="Color hex value"
                        type="text"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        className="flex-1 border-white/20 bg-white/5 text-white text-xs"
                        placeholder="#071426"
                      />
                    </div>
                  )}

                  {backgroundMode === "video" && (
                    <div className="mt-3">
                      {bgVideo ? (
                        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2">
                          <Film className="h-8 w-8 text-brand-blue/60" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white truncate">Background video loaded</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-1 border-white/20 text-white hover:bg-white/10"
                              onClick={triggerBgVideoUpload}
                            >
                              Change
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="onDark"
                          className="w-full border-dashed"
                          onClick={triggerBgVideoUpload}
                        >
                          <Film className="mr-2 h-4 w-4" />
                          Upload background video (MP4, up to 50 MB)
                        </Button>
                      )}
                      <input
                        ref={bgVideoInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={handleBgVideoUpload}
                      />
                    </div>
                  )}

                  {backgroundMode === "photo" && (
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="onDark"
                        className="w-full border-dashed"
                        onClick={triggerBgPhotosUpload}
                      >
                        <Images className="mr-2 h-4 w-4" />
                        Add your pictures ({MIN_PHOTOS}+ builds the wall)
                      </Button>
                      <input
                        ref={bgPhotosInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleBgPhotosUpload}
                      />
                      {bgPhotos.length > 0 && (
                        <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                          {bgPhotos.map((picture, index) => (
                            <li key={`${index}-${picture.length}`} className="relative">
                              <img
                                src={picture}
                                alt={`Picture ${index + 1}`}
                                className="aspect-square w-full rounded object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => removeBgPhoto(index)}
                                aria-label={`Remove picture ${index + 1}`}
                                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {bgPhotos.length === 1 && (
                        <p className="mt-2 text-[10px] text-white/50">
                          Add one more picture — two or more become the moving wall.
                        </p>
                      )}
                      {bgPhotos.length === 0 && (
                        <p className="mt-2 text-[10px] text-white/50">
                          JPG, PNG or WebP up to 10 MB each, {MAX_PHOTOS} pictures max.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Subtitle */}
                {selectedTemplate?.showSubtitle && (
                  <div className="mb-4">
                    <Label htmlFor="cover-subtitle" className="text-white/80 text-xs">
                      Subtitle
                    </Label>
                    <Textarea
                      id="cover-subtitle"
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value.slice(0, 120))}
                      placeholder="A short caption for your short video..."
                      className="border-white/20 bg-white/5 text-white text-sm"
                      rows={2}
                    />
                    <p className="mt-1 text-[10px] text-white/40 text-right">{subtitle.length}/120</p>
                  </div>
                )}

                {/* Product link */}
                {selectedTemplate?.showProductChip && (
                  <div className="mb-4 rounded-lg border border-brand-blue/20 bg-brand-blue/5 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Link2 className="h-4 w-4 text-brand-blue" />
                      <Label className="text-brand-blue text-xs font-semibold">Product link (optional)</Label>
                    </div>
                    <p className="text-[10px] text-white/50 mb-2">
                      Attach a product for shoppable Shorts — viewers tap the chip to buy.
                    </p>
                    <div className="space-y-2">
                      <Input
                        aria-label="Product label"
                        value={productLabel}
                        onChange={(e) => setProductLabel(e.target.value.slice(0, 60))}
                        placeholder="Shop now →"
                        className="border-white/20 bg-white/5 text-white text-sm"
                      />
                      <Input
                        aria-label="Product URL"
                        value={productUrl}
                        onChange={(e) => setProductUrl(e.target.value.slice(0, 2048))}
                        placeholder="https://champey.com/product/..."
                        className="border-white/20 bg-white/5 text-white text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* Speed + Duration */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-white/80 text-xs mb-2">Speed</Label>
                    <div role="group" aria-label="Speed" className="flex gap-1">
                      {SPEEDS.map(({ value, label }) => (
                        <FilterChip
                          key={value}
                          selected={speed === value}
                          surface="dark"
                          className="flex-1"
                          onClick={() => setSpeed(value)}
                        >
                          {label}
                        </FilterChip>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="cover-duration" className="text-white/80 text-xs mb-2">
                      Duration: {duration}s
                    </Label>
                    <input
                      id="cover-duration"
                      type="range"
                      min={5}
                      max={10}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="w-full accent-brand-blue"
                    />
                    <div className="flex justify-between text-[10px] text-white/40">
                      <span>5s</span>
                      <span>10s</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-3">
            <Card className={PANEL}>
              <CardContent className="space-y-3 p-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-purple">
                    Selected template
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-white">
                    {selectedTemplate?.name}
                  </h2>
                  <p className="text-xs text-white/50">{selectedTemplate?.description}</p>
                </div>
                <div
                  className="h-16 rounded-lg"
                  style={{
                    background: `linear-gradient(135deg, ${selectedTemplate?.colors.join(", ")})`,
                  }}
                />
                <div className="flex gap-2">
                  {selectedTemplate?.colors.map((c) => (
                    <span
                      key={c}
                      className="h-5 w-5 rounded-full border border-white/20 shadow"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <Eye className="h-3.5 w-3.5" />
                  <span>{selectedTemplate?.backgroundMode === "video" ? "Uses your video" : selectedTemplate?.backgroundMode === "photo" ? "Uses your pictures" : "Solid color"} background</span>
                </div>
                {selectedTemplate?.showSubtitle && (
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Subtitle supported</span>
                  </div>
                )}
                {selectedTemplate?.showProductChip && (
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <Link2 className="h-3.5 w-3.5" />
                    <span>Product chip included</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={PANEL}>
              <CardContent className="space-y-3 p-4">
                <p className="text-sm font-semibold text-white">Publish cover video</p>
                <p className="text-xs text-white/50 leading-relaxed">
                  The studio renders a {duration}-second video and sets it as your profile cover. The round centre stays
                  sharp while your pictures drift behind it.
                </p>
                <Button
                  className="w-full bg-brand-blue text-white hover:bg-brand-blue/90"
                  onClick={publishCoverVideo}
                  disabled={isPublishing || authLoading || !profilePhoto}
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Rendering {Math.round(renderProgress * 100)}%
                    </>
                  ) : saved ? (
                    "Published"
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Publish to profile
                    </>
                  )}
                </Button>
                <p className="text-[10px] text-white/40">
                  Publishing records the preview in this browser and uploads the finished video.
                </p>
              </CardContent>
            </Card>

            <Card className={PANEL}>
              <CardContent className="space-y-2 p-4">
                <p className="text-xs font-semibold text-white/80">How it works</p>
                <ol className="space-y-1.5 text-[10px] text-white/50">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-5 w-5 rounded-full bg-brand-blue/20 flex items-center justify-center text-[10px] font-bold text-brand-blue">1</span>
                    <span>Add your profile photo — it stays in the round centre</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-5 w-5 rounded-full bg-brand-blue/20 flex items-center justify-center text-[10px] font-bold text-brand-blue">2</span>
                    <span>Upload several pictures for the moving wall</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-5 w-5 rounded-full bg-brand-blue/20 flex items-center justify-center text-[10px] font-bold text-brand-blue">3</span>
                    <span>Pick a template for the colours and motion</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-5 w-5 rounded-full bg-brand-blue/20 flex items-center justify-center text-[10px] font-bold text-brand-blue">4</span>
                    <span>Publish — the video loops on your profile banner</span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
