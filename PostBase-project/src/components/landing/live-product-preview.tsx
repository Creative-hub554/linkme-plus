"use client";

import { ChevronRight, Heart, MessageCircle, Search, ShieldCheck, Sparkles } from "lucide-react";
import { shortVideoTemplates } from "@/components/cover-studio/short-video-templates";
import { AmbientPlaybackButton } from "@/components/shared/ambient-playback-button";
import { SceneStrip } from "@/components/shared/scene-strip";
import { useAmbientCarousel } from "@/hooks/use-ambient-carousel";
import { cn } from "@/lib/utils";

const slides = [
  { name: "Sarah Chen", initials: "SC", text: "Small steps. Big ideas. Building something beautiful today.", colors: "from-brand-blue/70 via-brand-purple/70 to-fuchsia-400" },
  { name: "Marcus Rivera", initials: "MR", text: "The best work happens when great people find each other.", colors: "from-cyan-400 via-brand-blue/80 to-brand-purple" },
  { name: "Emma Watson", initials: "EW", text: "Sharing the things that inspire me this week ✨", colors: "from-amber-300 via-orange-400 to-rose-500" },
];

export function LiveProductPreview() {
  // The system's motion preference decides whether the preview opens moving, the
  // play control overrules it, and picking a slide stops it — one rule, shared with
  // the sign-in page's live visual, in `useAmbientCarousel`. The clock is shared
  // too: the preview supplies only its 3s beat and reads the beat back.
  const {
    index: slide,
    beats,
    select: selectSlide,
    playing,
    setPlaying,
  } = useAmbientCarousel(slides.length, { cadenceMs: 3000 });
  // One beat moves both: the slide above, and the template style drawn beside it.
  // The style is the beat's own count, wrapped — not a copy of the slide, which
  // would stop walking the styles once it had shown the third one. A pick stops
  // the beat, so `beats` holds and the style holds with it.
  const styleIndex = beats % shortVideoTemplates.length;
  const current = slides[slide];
  const currentStyle = shortVideoTemplates[styleIndex];

  return (
    <div className="relative mx-auto min-w-0 w-full max-w-xl lg:mx-0 md:max-w-none">
      <div className="absolute -inset-5 rounded-[2.5rem] bg-gradient-to-br from-brand-blue/20 via-transparent to-brand-purple/25 blur-2xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-surface-border bg-card p-3 shadow-2xl shadow-navy-900/10">
        <div className="overflow-hidden rounded-[1.4rem] bg-surface-light-blue">
          <div className="flex items-center justify-between border-b border-surface-border bg-card/80 px-4 py-3 backdrop-blur">
            <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue text-[10px] font-bold text-white">L+</span><span className="text-xs font-bold text-navy-800">LinkMe+</span></div>
            <div className="flex items-center gap-3 text-muted-foreground"><Search className="h-4 w-4" /><span className="flex h-6 items-center gap-1 rounded-full bg-emerald-50 px-2 text-[9px] font-semibold text-emerald-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Live</span><div className="h-6 w-6 rounded-full bg-brand-purple/20" /></div>
          </div>

          <div className="grid min-w-0 gap-3 overflow-hidden p-3 2xl:grid-cols-[minmax(0,1fr)_minmax(0,150px)]">
            <div className="space-y-3">
              <div className="rounded-xl bg-card p-4 shadow-sm transition-all duration-500">
                <div className="flex items-center gap-2"><div className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${current.colors} text-[10px] font-bold text-white transition-all duration-500`}>{current.initials}</div><div><p className="text-[11px] font-semibold text-navy-800">{current.name}</p><p className="text-[9px] text-muted-foreground">Just now · Community</p></div><AmbientPlaybackButton playing={playing} setPlaying={setPlaying} label="live preview" className="ml-auto h-8 w-8 bg-surface-light-blue text-[10px] text-brand-blue transition hover:bg-brand-blue/10 focus-visible:ring-brand-blue" /></div>
                <p className="mt-4 min-h-10 text-sm leading-5 text-navy-700 transition-all duration-500">{current.text}</p>
                <div className="mt-4 grid grid-cols-3 gap-1.5"><div className="h-14 rounded-lg transition-all duration-700" style={{ background: `linear-gradient(135deg, ${currentStyle.colors[0]}, ${currentStyle.colors[2]})` }} /><div className="h-14 rounded-lg transition-all duration-700" style={{ background: `linear-gradient(135deg, ${currentStyle.colors[1]}, ${currentStyle.colors[2]})` }} /><div className="h-14 rounded-lg transition-all duration-700" style={{ background: `linear-gradient(135deg, ${currentStyle.colors[2]}, ${currentStyle.colors[0]})` }} /></div>
                <div className="mt-4 flex items-center gap-4 border-t border-surface-border pt-3 text-muted-foreground"><Heart className="h-3.5 w-3.5 fill-rose-400 text-rose-400" /><MessageCircle className="h-3.5 w-3.5" /><span className="ml-auto text-[10px]">{slide + 12} likes · now</span></div>
              </div>
              <SceneStrip
                label="Live preview slides"
                count={slides.length}
                selected={slide}
                labelFor={(index) => `Show ${slides[index].name}'s preview`}
                onSelect={selectSlide}
                trackClassName="h-1.5 bg-navy-100 focus-visible:ring-brand-blue"
                fillClassName={(state) =>
                  cn(
                    "bg-brand-blue transition-all duration-500",
                    state === "selected" ? "w-full" : state === "seen" ? "w-full opacity-40" : "w-0",
                  )
                }
              />
            </div>
            <div className="relative min-w-0 overflow-hidden rounded-xl p-4 text-white shadow-sm transition-colors duration-700" style={{ background: `linear-gradient(135deg, ${currentStyle.colors[0]}, ${currentStyle.colors[1]}, ${currentStyle.colors[2]})` }}><div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/20 blur-xl" /><div className="relative flex items-center justify-between"><span className="text-[10px] font-semibold text-white/70">SHORT VIDEO STUDIO</span><Sparkles className="h-3.5 w-3.5 text-white/80" /></div><div className="relative mt-8 text-lg font-semibold leading-tight">{currentStyle.name}</div><div className="relative mt-3 h-1 w-12 rounded-full bg-card/80" /><div className="relative mt-3 text-[10px] text-white/70">Style {String(styleIndex + 1).padStart(2, "0")} / {shortVideoTemplates.length} · {currentStyle.id}</div><div className="relative mt-6 flex items-center gap-2 text-[10px] text-white/70">Explore Studio <ChevronRight className="h-3 w-3" /></div></div>
          </div>
          <div className="flex items-center justify-between border-t border-surface-border bg-card/70 px-4 py-3 text-[10px] text-navy-400"><span>Live preview · {currentStyle.name}</span><span className="flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-3 w-3" /> Built for trust</span></div>
        </div>
      </div>
      {/* A live region, not decoration: the card's text is swapped in place every
          three seconds, and a screen reader says nothing when a node's text changes
          underneath it. `role="status"` with `aria-live="polite"` is what turns
          "the preview moved" into words — where to and who is showing, not the whole
          post again, because re-reading the full text every three seconds is noise a
          reader cannot stop except by stopping the carousel itself. It is mounted
          from the start, since a live region announces only changes made *after* it
          exists, and it sits outside the card so it adds nothing to what is read in
          order. The strip beside it still carries each slide's own text, so nothing is
          lost — only the change is spoken. */}
      <span role="status" aria-live="polite" className="sr-only">
        {`Slide ${slide + 1} of ${slides.length}: ${current.name}`}
      </span>
    </div>
  );
}
