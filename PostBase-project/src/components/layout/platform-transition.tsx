"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * How long the veil stays at full strength before it leaves, and how long the
 * leave takes. 360 + 260 is the 620ms the sweep in `globals.css` runs for, so
 * the bar crosses the top edge once and lands as the veil finishes fading —
 * neither is left running over a page that has already settled.
 */
const RAISE_MS = 360;
const LEAVE_MS = 260;

/** Where the veil is in its own life: at rest, up, or on its way out. */
type Phase = "raised" | "leaving";

/**
 * The name a section is announced under: the route's first segment, dashes read
 * as words and the first letter capitalised — `cover-studio` becomes "Cover
 * studio". Written as a transformation rather than a label per section so a new
 * section arrives already named; a map would be one more list of the app's
 * routes to keep in step with the routes themselves.
 */
function sectionLabel(segment: string): string {
  const words = segment.replace(/-/g, " ").trim();
  if (words === "") return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether the reader has asked for less motion, read at the moment a change
 * arrives rather than tracked: the veil is raised once per navigation, so a
 * preference read then is the whole of what the decision needs. Under it the
 * sections still switch — they simply switch without being covered.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The veil that covers a move from one section of the platform to another.
 *
 * Navigating between sections used to be an instant swap: the page under the
 * header was simply a different one, with whatever loading seam it happened to
 * have on show. This covers that swap instead — a wash over the page, the
 * destination's name on it, a bar across the top edge — and then leaves, so the
 * move reads as the app turning to a section rather than a page being replaced.
 *
 * Two decisions are worth stating because both look like accidents otherwise.
 *
 * It is keyed on the route's *first* segment, so moving within a section
 * (marketplace to its saved listings, a profile's tabs) changes nothing here:
 * a veil on every click would be a curtain over navigation that already reads
 * as continuous. And it raises on a *change* rather than on mount — the ref
 * holds the section the reader is already on, which is where this component
 * finds it, so the first render covers nothing. What is drawn is decorative: it
 * is `aria-hidden`, it never holds a control, and it does not intercept the
 * pointer, so the page underneath stays exactly as reachable as it was.
 *
 * It is always mounted, even at rest, and the resting veil is transparent
 * rather than absent. One effect of that is deliberate: a surface that renders
 * nothing at all is a surface the a11y audit cannot judge, and this one has
 * something to be judged on — the name it carries — even before any change
 * asks it to show.
 */
export function PlatformTransition() {
  const pathname = usePathname();
  const segment = (pathname ?? "").split("/").filter(Boolean)[0] ?? "";
  const label = sectionLabel(segment);

  // The section the veil has already answered for. A ref rather than state: the
  // first render is not a transition, it is where the reader already was, and
  // state would have to be seeded from the same value it is compared against.
  const settled = useRef(segment);
  const [phase, setPhase] = useState<Phase | null>(null);

  // A section the reader has arrived in from another one.
  useEffect(() => {
    if (settled.current === segment) return;
    settled.current = segment;
    if (segment === "" || prefersReducedMotion()) return;
    setPhase("raised");
  }, [segment]);

  // Held for the length of the sweep, then let go.
  useEffect(() => {
    if (phase !== "raised") return;
    const timer = window.setTimeout(() => setPhase("leaving"), RAISE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // And gone, so nothing stays over a reader who has stopped navigating.
  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => setPhase(null), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 z-[60] flex items-center justify-center overflow-hidden",
        phase === null
          ? "opacity-0"
          : cn(
              phase === "raised" ? "platform-transition-raise" : "platform-transition-leave",
              "bg-card/70 backdrop-blur-[2px]"
            )
      )}
    >
      <span className="platform-transition-sweep absolute left-0 top-0 h-1 w-2/5 bg-gradient-to-r from-brand-blue via-brand-purple to-brand-blue-light" />
      <span className="px-6 text-center text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {label}
      </span>
    </div>
  );
}
