"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { UserProfile } from "@/types/linkme";

export const spring = { type: "spring", stiffness: 320, damping: 28 } as const;
export const mediaPoster = "/design-media/ambient.webp";

const motionPreference = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(notify: () => void) {
  const query = window.matchMedia(motionPreference);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

export function useDesignReducedMotion() {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(motionPreference).matches,
    () => true,
  );
}

export function coverMedia(theme: UserProfile["coverStudioTheme"]) {
  const asset = theme === "terracotta-glow" ? "terracotta" : "ambient";
  return {
    src: `/design-media/${asset}.webm`,
    poster: `/design-media/${asset}.webp`,
  };
}

export function Avatar({
  name,
  url,
  large = false,
}: {
  name: string;
  url?: string;
  large?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={large ? "ld-avatar ld-avatar-large" : "ld-avatar"}
    >
      {url ? (
        <Media src={url} alt="" />
      ) : (
        name
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
      )}
    </span>
  );
}

export function Media({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // The seed images use local files and need no image loader or remote allowlist.
  return (
    <img
      src={failed || !src ? mediaPoster : src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export function Video({
  src,
  poster = mediaPoster,
  label,
  className,
}: {
  src: string;
  poster?: string;
  label: string;
  className?: string;
}) {
  const reduce = useDesignReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (reduce) element.pause();
    else void element.play().catch(() => undefined);
  }, [reduce, src]);
  return (
    <div className={"ld-video " + (className || "")}>
      <video
        ref={video}
        src={src}
        poster={poster}
        aria-label={label}
        playsInline
        muted={muted}
        loop
        autoPlay={!reduce}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="ld-video-controls">
        <button
          type="button"
          onClick={() => {
            if (playing) video.current?.pause();
            else void video.current?.play().catch(() => setPlaying(false));
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={() => setMuted(!muted)}>
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
    </div>
  );
}

export function Overlay({
  open,
  onClose,
  title,
  children,
  drawer = false,
  fullscreen = false,
  layoutId,
  titleLayoutId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  drawer?: boolean;
  fullscreen?: boolean;
  layoutId?: string;
  titleLayoutId?: string;
}) {
  const reduce = useDesignReducedMotion();
  const trigger = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount key="overlay">
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="ld-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={() => {
                trigger.current =
                  document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                trigger.current?.focus();
              }}
            >
              <motion.section
                layoutId={reduce ? undefined : layoutId}
                className={
                  "ld-dialog " +
                  (drawer ? "ld-drawer" : fullscreen ? "ld-fullscreen" : "")
                }
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
                transition={spring}
              >
                <header className="ld-row ld-between">
                  <Dialog.Title asChild>
                    <motion.h2 layoutId={reduce ? undefined : titleLayoutId}>
                      {title}
                    </motion.h2>
                  </Dialog.Title>
                  <Dialog.Close
                    type="button"
                    className="ld-icon"
                    aria-label="Close dialog"
                  >
                    <X size={19} />
                  </Dialog.Close>
                </header>
                {children}
              </motion.section>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export const stagger = {
  show: { transition: { staggerChildren: 0.05 } },
  hidden: {},
};
export const card = {
  hidden: { opacity: 0, y: 9 },
  show: { opacity: 1, y: 0 },
};
