"use client";

import { Heart, MessageCircle, Radio, Users } from "lucide-react";
import { AmbientPlaybackButton } from "@/components/shared/ambient-playback-button";
import { SceneStrip } from "@/components/shared/scene-strip";
import { useAmbientCarousel } from "@/hooks/use-ambient-carousel";
import { cn } from "@/lib/utils";

const moments = [
  { title: "New ideas are taking shape.", subtitle: "A community built around your next move.", gradient: "from-brand-blue via-indigo-500 to-brand-purple" },
  { title: "Find your people.", subtitle: "The best conversations are already happening.", gradient: "from-brand-purple via-fuchsia-500 to-rose-500" },
  { title: "Make something meaningful.", subtitle: "Share the work that moves you forward.", gradient: "from-cyan-400 via-brand-blue to-indigo-600" },
];

export function LoginLiveVisual() {
  // The system's motion preference decides whether the visual opens cycling, the
  // play control overrules it, and picking a scene stops it — one rule, shared with
  // the landing page's live preview, in `useAmbientCarousel`. The clock is shared
  // too: the visual supplies only its 4.2s beat, and nothing but the scene moves.
  const {
    index: moment,
    select: selectMoment,
    playing,
    setPlaying,
  } = useAmbientCarousel(moments.length, { cadenceMs: 4200 });
  const active = moments[moment];

  return (
    <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/10 p-3 shadow-2xl shadow-black/10 backdrop-blur-md">
      <div className={`relative min-h-40 overflow-hidden rounded-xl bg-gradient-to-br ${active.gradient} p-4 transition-colors duration-1000`}>
        <div className="absolute -right-10 -top-16 h-44 w-44 animate-pulse rounded-full bg-white/20 blur-2xl" />
        <div className="absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-black/20 blur-2xl" />
        <div className="relative flex items-center justify-between text-[10px] font-semibold text-white/80"><span className="flex items-center gap-1.5"><Radio className="h-3 w-3 text-rose-300" /> LIVE PREVIEW</span><AmbientPlaybackButton playing={playing} setPlaying={setPlaying} label="live visual" className="h-7 w-7 border border-white/25 bg-white/15 text-[9px] text-white hover:bg-white/25 focus-visible:ring-white" /></div>
        <div className="relative mt-7 max-w-[230px]"><p className="text-xl font-semibold leading-tight text-white transition-all duration-500">{active.title}</p><p className="mt-2 text-xs leading-5 text-white/75">{active.subtitle}</p></div>
        <div className="relative mt-5 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-[9px] font-bold text-white">L+</span><div className="h-1.5 w-20 rounded-full bg-white/25"><span className="block h-full w-2/3 rounded-full bg-white/80" /></div><span className="text-[10px] text-white/70">0{moment + 1}/03</span></div>
      </div>
      <div className="flex items-center justify-between px-1 pt-3 text-[10px] text-navy-200"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> 12,480 people online</span><span className="flex items-center gap-2"><Heart className="h-3 w-3" /><MessageCircle className="h-3 w-3" /><Users className="h-3 w-3" /></span></div>
      {/* Each dot is named by the scene it switches to rather than by its place in
          the row, which is how the landing page's strip names its dots too — a
          positional name tells a reader nothing about what they would be choosing.
          The quotes are the typographic ones deliberately: a straight `"` inside an
          accessible name breaks any selector built from that name, `ui.byName`
          included, and a scene's headline is a sentence that needs quoting. */}
      <SceneStrip
        label="Live visual scenes"
        count={moments.length}
        selected={moment}
        labelFor={(index) => `Show “${moments[index].title}”`}
        onSelect={selectMoment}
        className="mt-3"
        trackClassName="h-1 focus-visible:ring-white"
        fillClassName={(state) =>
          cn("w-full transition-colors", state === "selected" ? "bg-brand-purple-light" : "bg-white/20")
        }
      />
      {/* A live region, not decoration: the card swaps its title and subtitle in
          place every 4.2 seconds, and a screen reader says nothing when a node's
          text changes underneath it. `role="status"` with `aria-live="polite"` is
          what turns "the visual moved" into words — where to, not the whole scene
          again, because re-reading the copy every few seconds is noise a reader
          cannot stop except by stopping the cycle itself. It is mounted from the
          start, since a live region announces only changes made *after* it exists,
          and it sits outside the card so it adds nothing to what is read in order.
          The strip beside it still carries each scene's own words, so nothing is
          lost — only the change is spoken, and a paused cycle changes nothing and
          so says nothing. The landing page's live preview says this about its
          slides in the same shape. */}
      <span role="status" aria-live="polite" className="sr-only">
        {`Scene ${moment + 1} of ${moments.length}: ${active.title}`}
      </span>
    </div>
  );
}
