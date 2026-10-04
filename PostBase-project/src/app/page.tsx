"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Briefcase, Globe2, ShoppingBag, Sparkles } from "lucide-react";
import { LiveProductPreview } from "@/components/landing/live-product-preview";

const features = [
  { icon: Globe2, title: "Social, without the noise", description: "A calmer feed for ideas, updates, and conversations that matter." },
  { icon: ShoppingBag, title: "Buy and sell with confidence", description: "Find great products and connect directly with people you trust." },
  { icon: Briefcase, title: "Move your career forward", description: "Discover roles, share your work, and meet your next collaborator." },
  { icon: Sparkles, title: "Make your profile yours", description: "Create a presence with Cover Studio and expressive profile tools." },
];

export default function LandingPage() {
  return (
    <div className="page-enter overflow-hidden">
      <section className="relative mx-auto max-w-7xl px-4 pb-14 pt-8 sm:px-6 sm:pt-12 md:pb-16 md:pt-10 lg:px-8 lg:pb-28 lg:pt-24">
        <div className="ambient-pulse pointer-events-none absolute -right-32 top-0 h-[34rem] w-[34rem] rounded-full bg-brand-blue/10 blur-3xl" />
        <div className="ambient-pulse motion-delay-200 pointer-events-none absolute -left-32 bottom-0 h-80 w-80 rounded-full bg-brand-purple/10 blur-3xl" />
        <div className="relative grid items-center gap-10 md:grid-cols-[0.92fr_1.08fr] md:gap-8 lg:gap-16">
          <div>
            <Badge variant="secondary" className="mb-6 rounded-full border border-brand-blue/10 bg-brand-blue/5 px-3 py-1 text-brand-blue"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />A better place to be social</Badge>
            <h1 className="max-w-2xl text-4xl font-bold leading-[1.02] tracking-[-0.04em] text-navy-800 sm:text-6xl lg:text-7xl">Your people.<br /><span className="bg-gradient-to-r from-brand-blue to-brand-purple bg-clip-text text-transparent">Your next move.</span></h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">LinkMe+ brings your community, creativity, marketplace, and career into one beautifully simple place.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="pressable shimmer-on-hover h-12 rounded-xl px-6 shadow-lg shadow-brand-blue/20"><Link href="/register">Create your account <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <Button asChild variant="outline" size="lg" className="pressable h-12 rounded-xl bg-card/70 px-6"><Link href="/login">Sign in to LinkMe+</Link></Button>
            </div>
            <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground"><div className="flex -space-x-2"><Avatar className="h-7 w-7 border-2 border-[#f3f7fc]"><AvatarFallback className="bg-brand-purple text-[10px] text-white">SC</AvatarFallback></Avatar><Avatar className="h-7 w-7 border-2 border-[#f3f7fc]"><AvatarFallback className="bg-brand-blue text-[10px] text-white">MR</AvatarFallback></Avatar><Avatar className="h-7 w-7 border-2 border-[#f3f7fc]"><AvatarFallback className="bg-amber-500 text-[10px] text-white">EW</AvatarFallback></Avatar></div><span>Join 50,000+ people building what is next.</span></div>
          </div>

          <LiveProductPreview />
        </div>
      </section>

      <section className="border-y border-surface-border bg-card/60"><div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-7 sm:grid-cols-4 sm:px-6 lg:px-8">{[{ value: "50K+", label: "members" }, { value: "10K+", label: "posts every day" }, { value: "2K+", label: "communities" }, { value: "4.9/5", label: "community rating" }].map((stat) => <div key={stat.label} className="text-center"><p className="text-2xl font-bold tracking-tight text-navy-800">{stat.value}</p><p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p></div>)}</div></section>

      <section className="page-enter motion-delay-200 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28"><div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-purple">One platform, more possibility</p><h2 className="mt-4 text-3xl font-bold tracking-tight text-navy-800 sm:text-4xl">A more useful kind of social.</h2><p className="mt-4 text-base leading-7 text-muted-foreground">The tools you need to stay connected, discover opportunities, and show up as yourself.</p></div><div className="mt-12 grid gap-4 md:grid-cols-2">{features.map((feature, index) => <Card key={feature.title} className="hover-lift group border-surface-border/80 bg-card/80 shadow-none"><CardContent className="p-6 sm:p-8"><div className="flex items-start justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue"><feature.icon className="h-5 w-5" /></div><span className="text-sm font-bold text-navy-200">0{index + 1}</span></div><h3 className="mt-7 text-lg font-semibold text-navy-800">{feature.title}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{feature.description}</p><div className="mt-6 flex items-center text-sm font-semibold text-brand-blue opacity-0 transition-opacity group-hover:opacity-100">Learn more <ArrowRight className="ml-2 h-4 w-4" /></div></CardContent></Card>)}</div></section>

      <section className="page-enter motion-delay-300 mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28"><div className="relative overflow-hidden rounded-[2rem] bg-ink-800 px-6 py-12 text-white sm:px-12 lg:px-16"><div className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-l from-brand-purple/20 to-transparent" /><div className="relative grid items-center gap-10 lg:grid-cols-[1fr_auto]"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-purple-light">Your people are here</p><h2 className="mt-4 max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">Bring your next good idea to life.</h2><p className="mt-4 max-w-lg text-sm leading-7 text-navy-200">Create your free profile and start building your corner of LinkMe+ today.</p></div><Button asChild size="lg" className="relative h-12 rounded-xl bg-white px-6 text-ink-800 hover:bg-ink-100"><Link href="/register">Get started <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div></div></section>
    </div>
  );
}
