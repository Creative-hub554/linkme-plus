"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Heart, MapPin, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A uuid is a key, not a word: a category that still looks like one is an id nobody resolved. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One swipeable media frame on the card tile. */
export interface ListingCardMedia {
  url: string;
  type: "image" | "video" | "short_video";
}

/** How long one swipe frame holds before advancing while hovered. */
const SWIPE_STEP_MS = 1200;

interface ListingCardProps {
  id: string;
  title: string;
  price: number;
  currency?: string;
  image?: string;
  /** The first media row's kind — `short_video` puts a short badge on the tile. */
  imageType?: "image" | "video" | "short_video";
  /**
   * Full media list for the hover swipe preview. Falls back to `[image]`
   * when absent, so a card without the batched read still renders.
   */
  media?: ListingCardMedia[];
  seller: { name: string; avatar?: string };
  location?: string;
  /** The category's human name. A uuid is not a name: no name, no badge. */
  category?: string;
  condition?: string;
  liked?: boolean;
  /** Told the server's answer once a write is confirmed — `false` when the
   * un-save landed, `true` when the save did. A rollback calls nothing: the
   * write did not happen, so the row the card sits on is where it was. */
  onSavedChange?: (saved: boolean) => void;
}

export function ListingCard({
  id,
  title,
  price,
  currency = "USD",
  image,
  imageType,
  media: mediaProp,
  seller,
  location,
  category,
  condition,
  liked: initialLiked = false,
  onSavedChange,
}: ListingCardProps) {
  const [liked, setLiked] = useState(initialLiked);
  const saving = useRef(false);

  // ── Hover swipe preview ─────────────────────────────────────────
  // Hovering walks the tile through its media, one frame at a time —
  // photos slide first, and a short or video frame plays muted while it
  // is the active one. Leaving the tile returns it to the first frame.
  const media = useMemo<ListingCardMedia[]>(
    () =>
      mediaProp && mediaProp.length > 0
        ? mediaProp
        : image
          ? [{ url: image, type: imageType ?? "image" }]
          : [],
    [mediaProp, image, imageType],
  );
  const [frame, setFrame] = useState(0);
  // Hover is state, not a ref: the advance timer exists only while the pointer
  // rests on the tile, and re-running the effect on this state is what starts
  // and stops it.
  const [hovering, setHovering] = useState(false);
  // Only auto-advance when motion is welcome; prefers-reduced-motion keeps
  // the tile pinned on its first frame (the video still shows a poster).
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(query.matches);
  }, []);
  useEffect(() => {
    if (!hovering || reduceMotion || media.length <= 1) return;
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % media.length);
    }, SWIPE_STEP_MS);
    return () => window.clearInterval(timer);
  }, [hovering, reduceMotion, media.length, media]);
  const active = media[frame] ?? media[0];
  const hasShort = media.some((m) => m.type === "short_video");

  /**
   * The heart persists: a press writes the state it asks for through the
   * saved-listings route, and only the server's answer settles what the state
   * *is* — the card reconciles from `{ saved }`, not from its own guess.
   *
   * Optimistic and guarded: the flip paints first (a press that waits on the
   * network reads as a dead control), a second press while one is in flight is
   * dropped (two racing toggles can pair and unpair in the wrong order), and a
   * refused save rolls the heart back — a press whose write did not happen
   * must not leave the state claiming it did.
   */
  const toggleSaved = async () => {
    if (saving.current) return;
    saving.current = true;
    const previousLiked = liked;
    const nextLiked = !previousLiked;
    setLiked(nextLiked);
    try {
      // The save rides a POST body; the un-save names the listing in the
      // query, the way the route's DELETE reads it — a delete carries no
      // body of its own.
      const response = await fetch(
        nextLiked ? "/api/marketplace/saved" : `/api/marketplace/saved?listingId=${id}`,
        {
          method: nextLiked ? "POST" : "DELETE",
          ...(nextLiked
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ listingId: id }),
              }
            : {}),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Save failed");
      // The server's word, not the press's: the answer is what the state is.
      setLiked(Boolean(payload.saved));
      onSavedChange?.(Boolean(payload.saved));
    } catch {
      setLiked(previousLiked);
    } finally {
      saving.current = false;
    }
  };

  return (
    <Card className="commerce-listing-card overflow-hidden hover:shadow-md transition-shadow group">
      <div
        className="relative aspect-square overflow-hidden bg-surface-light-blue"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => {
          setHovering(false);
          setFrame(0);
        }}
      >
        {active ? (
          <div
            className="flex h-full w-full transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${(media.length > 1 ? frame : 0) * 100}%)` }}
          >
            {media.map((item, index) =>
              (item.type === "video" || item.type === "short_video") && index === frame ? (
                <video
                  key={`${item.url}-${index}`}
                  src={item.url}
                  // The preview speaks without sound: autoplaying muted keeps
                  // the hover preview a glance, not an interruption.
                  muted
                  autoPlay
                  loop
                  playsInline
                  className="h-full w-full flex-none object-cover"
                />
              ) : (
                <img
                  key={`${item.url}-${index}`}
                  src={item.url}
                  alt={index === 0 ? title : ""}
                  className="h-full w-full flex-none object-cover"
                />
              ),
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No image
          </div>
        )}
        {/* Price rides the image as the design mock's dark pill, top-right —
            the card's most scannable fact lives on its most scannable spot. */}
        <span className="mk-price-pill">
          {currency === "USD" ? "$" : currency}{price.toFixed(2)}
        </span>
        {/* Swipe dots: one per frame, the filled dot marks the active frame —
            the same convention as a carousel pager, so the position reads
            without counting slides. */}
        {media.length > 1 && (
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1" aria-hidden="true">
            {media.map((item, index) => (
              <span
                key={`${item.url}-${index}`}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  index === frame ? "bg-white" : "bg-white/50",
                )}
              />
            ))}
          </div>
        )}
        {condition && (
          <Badge className="absolute top-2 left-2" variant="secondary">
            {condition}
          </Badge>
        )}
        {imageType === "short_video" || hasShort ? (
          <Badge className="absolute bottom-2 left-2 gap-1" variant="secondary">
            <Play aria-hidden="true" className="h-3 w-3" /> Short
          </Badge>
        ) : null}
        {/* Named, and named with what pressing it does rather than only what
            the state is: the filled heart is a picture of the state, and a
            picture is what a screen reader cannot see. Same convention as the
            post card's bookmark — the name follows the state. */}
        <button
          type="button"
          onClick={() => {
            void toggleSaved();
          }}
          aria-label={liked ? "Remove from saved" : "Save listing"}
          className="absolute bottom-2 right-2 rounded-full bg-white/80 p-1.5 hover:bg-white transition-colors"
        >
          <Heart
            aria-hidden="true"
            className={cn("h-4 w-4", liked ? "fill-red-500 text-red-500" : "text-gray-600")}
          />
        </button>
      </div>
      <CardContent className="p-3">
        <h3 className="font-medium text-sm line-clamp-1"><Link href={`/marketplace/${id}`} className="hover:underline">{title}</Link></h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[10px]">{seller.name[0]}</AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground">{seller.name}</span>
          </div>
          {location && (
            <div className="flex items-center text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 mr-0.5" />
              {location}
            </div>
          )}
        </div>
        {/* The badge names the shelf the listing sits on, and only when there
            is a name to wear: an absent name — or one that is still the uuid
            key it came from — renders nothing, because a key is not a word,
            and this card is the last place a key could be dressed up as one. */}
        {category && !UUID_SHAPE.test(category) && (
          <Badge variant="outline" className="mt-2 text-[10px]">{category}</Badge>
        )}
      </CardContent>
    </Card>
  );
}
