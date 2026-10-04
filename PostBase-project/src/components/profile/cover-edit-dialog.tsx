"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Film, Loader2, Trash2, Upload, ImageIcon, Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeCoverVideo } from "@/lib/cover-video";

export interface CoverSelection {
  /** New uploaded photo URL, the existing URL to keep, or null for the gradient. */
  coverUrl: string | null;
  /**
   * True when a freshly uploaded photo is taking the cover over, which is what
   * tells the caller to drop a published video and the animated-cover config
   * along with it.
   */
  replacedCover: boolean;
}

interface CoverEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCoverUrl?: string | null;
  currentCoverVideoUrl?: string | null;
  /** Template the published cover video was made with, when it was recorded. */
  coverVideoTemplateName?: string | null;
  /** How many pictures the published cover video was built from. */
  coverVideoPictureCount?: number | null;
  /** Existing upload to keep, or null to clear the cover. */
  initialCoverUrl?: string | null;
  onSave: (selection: CoverSelection) => Promise<void> | void;
  /** Clears just the published cover video, leaving a photo cover in place. */
  onRemoveVideo?: () => Promise<void>;
  /** Clears the whole cover — photo, video and animated config. */
  onClearCover?: () => Promise<void>;
}

const gradientOptions = [
  {
    id: "aurora",
    label: "Aurora",
    className: "bg-gradient-to-br from-brand-blue via-brand-blue-light to-brand-purple",
  },
  {
    id: "navy",
    label: "Deep Navy",
    className: "bg-gradient-to-br from-ink-800 via-ink-600 to-brand-blue",
  },
  {
    id: "sunset",
    label: "Sunset",
    className: "bg-gradient-to-br from-orange-400 via-pink-500 to-purple-600",
  },
  {
    id: "ocean",
    label: "Ocean",
    className: "bg-gradient-to-br from-sky-400 via-cyan-500 to-blue-600",
  },
  {
    id: "meadow",
    label: "Meadow",
    className: "bg-gradient-to-br from-emerald-400 via-teal-500 to-green-600",
  },
  {
    id: "orchid",
    label: "Orchid",
    className: "bg-gradient-to-br from-fuchsia-500 via-purple-500 to-indigo-500",
  },
];

export function CoverEditDialog({
  open,
  onOpenChange,
  currentCoverUrl,
  currentCoverVideoUrl,
  coverVideoTemplateName,
  coverVideoPictureCount,
  initialCoverUrl,
  onSave,
  onRemoveVideo,
  onClearCover,
}: CoverEditDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [removingVideo, setRemovingVideo] = useState(false);
  const [clearingCover, setClearingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasVideo = Boolean(currentCoverVideoUrl);
  const isAnimatedImage = Boolean(currentCoverVideoUrl?.match(/\.svg(?:$|[?#])/i));

  const resetPending = () => {
    setPendingFile(null);
    setPendingPreview(null);
    setRemovingVideo(false);
    setClearingCover(false);
    setError(null);
  };

  /**
   * Takes the published cover video down straight away instead of staging the
   * removal behind Save. Removing a video is one self-contained decision, and
   * having to save afterwards is part of what made publishing another one over
   * the top look like the only way to get rid of it.
   */
  const handleRemoveVideo = async () => {
    if (!onRemoveVideo) return;
    setRemovingVideo(true);
    setError(null);
    try {
      await onRemoveVideo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove the cover video.");
    } finally {
      setRemovingVideo(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetPending();
    onOpenChange(nextOpen);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file for the cover.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Cover images must be 10 MB or smaller.");
      return;
    }
    setError(null);
    setPendingFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPendingPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  /**
   * Removes the whole cover — photo, published video and animated config —
   * straight away rather than staging it behind Save.
   *
   * Staging it was actively misleading: the preview dropped to the gradient the
   * moment the button was pressed, so the cover looked removed while it was
   * still live, and closing the dialog instead of saving brought it back.
   */
  const handleClearCover = async () => {
    if (!onClearCover) return;
    setClearingCover(true);
    setError(null);
    try {
      setPendingFile(null);
      setPendingPreview(null);
      await onClearCover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove the cover.");
    } finally {
      setClearingCover(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let nextCoverUrl: string | null = initialCoverUrl ?? null;
      let replacedCover = false;

      if (pendingFile) {
        const body = new FormData();
        body.append("file", pendingFile);
        const response = await fetch("/api/profile/cover", { method: "POST", body });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to upload cover image.");
        }
        nextCoverUrl = data.coverUrl as string;
        // A fresh photo takes the cover over, so a published video goes with it.
        replacedCover = true;
      }

      await onSave({ coverUrl: nextCoverUrl, replacedCover });
      resetPending();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save cover.");
    } finally {
      setSaving(false);
    }
  };

  const showUploadHint = !pendingPreview && !hasVideo && !currentCoverUrl;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit cover</DialogTitle>
          <DialogDescription>
            Upload a landscape photo, or publish a cover video from Cover Studio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Live preview */}
          <div>
            <Label>Cover preview</Label>
            <div className="mt-2 aspect-[2.7/1] w-full overflow-hidden rounded-md border border-surface-border bg-surface-light-blue">
              {hasVideo && !isAnimatedImage ? (
                <video
                  src={currentCoverVideoUrl ?? undefined}
                  className="h-full w-full object-cover"
                  muted
                  loop
                  autoPlay
                  playsInline
                />
              ) : hasVideo && isAnimatedImage ? (
                <img
                  src={currentCoverVideoUrl ?? undefined}
                  alt="Current animated cover"
                  className="h-full w-full object-cover"
                />
              ) : pendingPreview ? (
                <img
                  src={pendingPreview}
                  alt="Cover preview"
                  className="h-full w-full object-cover"
                />
              ) : currentCoverUrl ? (
                <img
                  src={currentCoverUrl}
                  alt="Current cover"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-blue via-brand-blue-light to-brand-purple text-xs text-white/90">
                  Brand gradient
                </div>
              )}
            </div>
          </div>

          {hasVideo && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-surface-border bg-surface-light-blue p-3">
              <div className="flex min-w-0 items-start gap-2">
                <Film className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy-800">Cover video</p>
                  <p className="text-xs text-muted-foreground">
                    {describeCoverVideo(coverVideoTemplateName, coverVideoPictureCount)}
                  </p>
                </div>
              </div>
              {onRemoveVideo && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRemoveVideo}
                  disabled={removingVideo || saving}
                  className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {removingVideo ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Remove video
                </Button>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Upload photo
            </Button>
            <Button asChild variant="outline">
              {/* The studio's own section of the profile rather than a page of
                  its own — the member lands back where this dialog lives. */}
              <a href="/profile?tab=cover">
                <Clapperboard className="h-4 w-4" />
                {hasVideo ? "Replace cover video" : "Create cover video"}
              </a>
            </Button>
          </div>

          {showUploadHint && (
            <p className="text-xs text-muted-foreground">
              Landscape images around 1200 × 480 work best. JPG, PNG or WebP up to 10 MB.
            </p>
          )}

          {/* Gradient presets — a quick starting point before uploading a photo */}
          <div>
            <Label className="text-xs text-muted-foreground">
              Gradient presets
            </Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {gradientOptions.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  title={g.label}
                  aria-label={`Preview ${g.label} gradient`}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "h-8 w-12 rounded-md border border-surface-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    g.className
                  )}
                />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Tap a preset to start a fresh upload sized to that look.
            </p>
          </div>

          {(currentCoverUrl || hasVideo) && (
            <Button
              variant="ghost"
              onClick={handleClearCover}
              disabled={clearingCover || saving}
              className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {clearingCover ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Remove cover
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save cover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ImageIcon as CoverImageIcon };
