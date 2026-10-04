"use client";

import { useRef, useState } from "react";
import { MediaImage } from "@/components/ui/media";
import { DynamicCoverCanvas, type DynamicCoverConfig } from "@/components/profile/dynamic-cover-canvas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Camera,
  Volume2,
  VolumeX,
  Pause,
  Play,
  Pencil,
  Clapperboard,
} from "lucide-react";

export interface CoverMedia {
  coverUrl?: string | null;
  coverVideoUrl?: string | null;
  coverConfig?: DynamicCoverConfig | null;
}

interface ProfileCoverProps {
  media: CoverMedia;
  alt: string;
  username?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  isOwner: boolean;
  onEdit?: () => void;
  className?: string;
}

type VideoState = "playing" | "paused";

/**
 * Profile cover banner.
 *
 * - Photo covers render as a plain landscape image (no text overlay).
 * - Video covers (from Cover Studio) autoplay muted, looped, without
 *   native controls. Sound stays off until the visitor unmutes or plays.
 *   The round profile frame is drawn into that video by the studio, so nothing
 *   is overlaid here — a second avatar on top of the first was the only thing
 *   that did.
 * - Owners get an "Edit cover" control in the upper-right.
 */
export function ProfileCover({
  media,
  alt,
  username,
  bio,
  avatarUrl,
  isOwner,
  onEdit,
  className,
}: ProfileCoverProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [videoState, setVideoState] = useState<VideoState>("playing");

  const isDynamic = Boolean(media.coverConfig);
  const isVideo = Boolean(media.coverVideoUrl) && !isDynamic;
  const isAnimatedImage = Boolean(media.coverVideoUrl?.match(/\.svg(?:$|[?#])/i));
  const hasMedia = Boolean(media.coverVideoUrl || media.coverUrl);
  /** A published Cover Studio clip — what the studio button would replace. */
  const hasCoverVideo = Boolean(media.coverVideoUrl);

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setVideoState("playing");
    } else {
      video.pause();
      setVideoState("paused");
    }
  };

  return (
    <div
      className={cn(
        "relative aspect-[2.7/1] min-h-36 w-full overflow-hidden",
        className
      )}
    >
      {isDynamic ? (
        <DynamicCoverCanvas
          config={media.coverConfig!}
          label={alt}
          username={username}
          bio={bio}
          avatarUrl={avatarUrl}
        />
      ) : isVideo && !isAnimatedImage ? (
        <video
          ref={videoRef}
          src={media.coverVideoUrl ?? undefined}
          poster={media.coverUrl ?? undefined}
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          aria-label={`${alt} cover video`}
        />
      ) : hasMedia ? (
        <MediaImage
          src={isAnimatedImage ? media.coverVideoUrl ?? "" : media.coverUrl ?? ""}
          alt={`${alt} cover photo`}
          className="absolute inset-0 h-full w-full"
          loading="eager"
        />
      ) : (
        // Default cover: brand gradient keeps the photo-led feel without any text overlay.
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-br from-brand-blue via-brand-blue-light to-brand-purple"
        />
      )}

      {/* Video visitor controls: sound off unless the visitor unmutes. */}
      {isVideo && !isAnimatedImage && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute cover video" : "Mute cover video"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={videoState === "playing" ? "Pause cover video" : "Play cover video"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {videoState === "playing" ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
        </div>
      )}

      {isOwner && (
        <div className="absolute right-3 top-3 flex gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="border-white/70 bg-white/90 text-ink-800 shadow-sm backdrop-blur-sm hover:bg-white"
          >
            {/* The studio is a section of this very profile now, so the control
                that used to leave for it stays put and names the section. */}
            <a href="/profile?tab=cover">
              <Clapperboard className="h-4 w-4" />
              {hasCoverVideo ? "Replace cover video" : "Cover studio"}
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            className="border-white/70 bg-white/90 text-ink-800 shadow-sm backdrop-blur-sm hover:bg-white"
          >
            <Camera className="h-4 w-4" />
            Edit cover
          </Button>
        </div>
      )}
    </div>
  );
}

export { Camera as CoverCameraIcon, Pencil as CoverEditIcon };
