"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ListingCard } from "@/components/marketplace/listing-card";

/**
 * A row of the saved shelf, in the shape the saved-listings read answers.
 *
 * The flag contract is the marketplace grid's: every row carries `isSaved`,
 * and the card starts from the row rather than from a client guess. On this
 * shelf the flag is true by construction — these rows are the member's saved
 * pairs — but the card still reads the field, so a card cannot tell which
 * read fed it.
 */
interface SavedListing {
  id: string;
  title: string;
  priceMin?: number | null;
  priceMax?: number | null;
  condition?: string | null;
  location?: string | null;
  categoryName?: string | null;
  /** The same photo field the grid's rows carry, from the same subquery — a
   * listing keeps its picture when it moves between the two shelves. */
  imageUrl?: string | null;
  isSaved: boolean;
}

/** The page size the read defaults to; sent explicitly so the pages line up. */
const PAGE_SIZE = 20;

export default function SavedListingsPage() {
  const [listings, setListings] = useState<SavedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The shelf is deeper than one page: `hasMore` is the read's own word (the
  // pagination header the route computes under the same predicate the rows
  // were read under), and `page` is what the next press asks for.
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // A paging hiccup is not an empty shelf: the rows on screen stay put, and
  // the failure is named beside the control that can retry it.
  const [moreError, setMoreError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMoreError(null);
    try {
      const response = await fetch(`/api/marketplace/saved?page=1&limit=${PAGE_SIZE}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load saved listings");
      const payload = await response.json();
      setListings(Array.isArray(payload.data) ? payload.data : []);
      setHasMore(Boolean(payload.pagination?.hasMore));
      setPage(1);
    } catch {
      setError("We couldn't load your saved listings right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const response = await fetch(
        `/api/marketplace/saved?page=${page + 1}&limit=${PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Unable to load more saved listings");
      const payload = await response.json();
      const rows: SavedListing[] = Array.isArray(payload.data) ? payload.data : [];
      setListings((current) => {
        // Rows arrive once — the shelf is one member's pairs, and a repeat
        // would render one listing as two hearts — so an id already on the
        // shelf is skipped rather than appended twice.
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...rows.filter((row) => !seen.has(row.id))];
      });
      setHasMore(Boolean(payload.pagination?.hasMore));
      setPage(page + 1);
    } catch {
      setMoreError("We couldn't load more saved listings. Try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Saved listings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The marketplace picks you kept. Un-saving here is a real write — the card
          leaves the shelf when the server confirms it, not when you press.
        </p>
      </div>

      {loading ? (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          aria-label="Loading saved listings"
          aria-busy="true"
        >
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Saved listings unavailable"
          description={error}
          action={
            <Button variant="outline" onClick={() => void loadSaved()}>
              Try again
            </Button>
          }
        />
      ) : listings.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          description="Tap the heart on any listing and it will wait for you here."
          action={
            <Link href="/marketplace">
              <Button>Browse the marketplace</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                id={listing.id}
                title={listing.title}
                price={listing.priceMin ?? listing.priceMax ?? 0}
                image={listing.imageUrl ?? undefined}
                seller={{ name: "Community seller" }}
                location={listing.location || undefined}
                category={listing.categoryName || undefined}
                condition={listing.condition || undefined}
                liked={listing.isSaved}
                onSavedChange={(saved) => {
                  // The server's word removes the card: a press whose write did
                  // not happen (a refused save, a network error) rolls the heart
                  // back and leaves the shelf exactly as it was.
                  if (!saved) {
                    setListings((current) => current.filter((row) => row.id !== listing.id));
                    return;
                  }
                  // A confirmed save stays: the flag is rewritten in the row
                  // itself so the same card — same key, still mounted — wears
                  // the state the write settled, instead of a heart still lit
                  // from the mount-day read.
                  setListings((current) =>
                    current.map((row) =>
                      row.id === listing.id ? { ...row, isSaved: saved } : row,
                    ),
                  );
                }}
              />
            ))}
          </div>
          {/* The read's own word decides the button: it names what pressing it
              does, it is disabled while its fetch is in flight, and a paging
              failure is named here — where the retry control is — rather than
              swapping the whole shelf for an error page. */}
          {moreError && <p className="text-sm text-red-600">{moreError}</p>}
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more saved listings"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
