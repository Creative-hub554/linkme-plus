"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Heart, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A uuid is a key, not a word: a category that still looks like one is an id nobody resolved. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ListingCardProps {
  id: string;
  title: string;
  price: number;
  currency?: string;
  image?: string;
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
  seller,
  location,
  category,
  condition,
  liked: initialLiked = false,
  onSavedChange,
}: ListingCardProps) {
  // The heart is the row's state the card holds in escrow: `useState` reads the
  // prop once, and while the card stays mounted — same key, stable identity —
  // the parent's rows can move under it without the heart hearing. So while a
  // write is in flight the card keeps what it is writing (its deferred
  // confirmation is still landing), and whenever the row's own data moves —
  // parent rows repainted, same card still mounted — the heart adopts it.
  const [liked, setLiked] = useState(initialLiked);
  const saving = useRef(false);
  useEffect(() => {
    if (saving.current) return;
    setLiked(initialLiked);
  }, [initialLiked]);

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
    <Card className="overflow-hidden hover:shadow-md transition-shadow group">
      <div className="relative aspect-square bg-surface-light-blue">
        {image ? (
          <img src={image} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No image
          </div>
        )}
        {condition && (
          <Badge className="absolute top-2 left-2" variant="secondary">
            {condition}
          </Badge>
        )}
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
          className="absolute top-2 right-2 rounded-full bg-white/80 p-1.5 hover:bg-white transition-colors"
        >
          <Heart
            aria-hidden="true"
            className={cn("h-4 w-4", liked ? "fill-red-500 text-red-500" : "text-gray-600")}
          />
        </button>
      </div>
      <CardContent className="p-3">
        <h3 className="font-medium text-sm line-clamp-1">{title}</h3>
        <p className="text-lg font-bold text-brand-blue mt-1">
          {currency === "USD" ? "$" : currency}{price.toFixed(2)}
        </p>
        <div className="flex items-center justify-between mt-2">
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
