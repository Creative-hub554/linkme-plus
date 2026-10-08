"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterChip } from "@/components/shared/filter-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, SlidersHorizontal } from "lucide-react";

const categories = [
  "All", "Electronics", "Fashion", "Home & Garden", "Sports", "Vehicles", "Toys", "Collectibles", "Art",
];

interface ListingResult {
  id: string;
  title: string;
  priceMin?: number | null;
  priceMax?: number | null;
  condition?: string | null;
  location?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  /** The listing's first photo, resolved by the read; null when it has none, in
   * which case the card shows its named placeholder rather than an empty frame. */
  imageUrl?: string | null;
  createdAt: string;
  /** The viewer's own flag, answered per row by the list read for a signed-in
   * member and `false` for a visitor — the same contract the single-listing
   * read has always had. */
  isSaved: boolean;
}

export default function MarketplacePage() {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [listings, setListings] = useState<ListingResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (selectedCategory !== "All") params.set("category", selectedCategory);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const response = await fetch(`/api/marketplace?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load listings");
      const payload = await response.json();
      setListings(Array.isArray(payload.data) ? payload.data : []);
    } catch { setError("We couldn't load marketplace listings right now."); }
    finally { setLoading(false); }
  }, [searchQuery, selectedCategory]);

  useEffect(() => { void loadListings(); }, [loadListings]);

  // The server's word settles a row's flag: when a confirmed write answers —
  // from this card or the saved shelf's — the flag is rewritten *in the row
  // itself*, the same row the grid's cards painted from, so a card's heart is
  // the row's state the moment it changes. The rows are what the cards read;
  // this is how a repainted parent reaches a mounted card.
  const handleSavedChange = useCallback((listingId: string, saved: boolean) => {
    setListings((current) =>
      current.map((row) => (row.id === listingId ? { ...row, isSaved: saved } : row)),
    );
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Marketplace</h1>
          <p className="text-sm text-muted-foreground mt-1">Buy and sell items in your community</p>
        </div>
        <Button>Sell Item</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search listings"
            placeholder="Search listings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void loadListings(); }}
            className="pl-9 bg-card"
          />
        </div>
        <Button variant="outline">
          <SlidersHorizontal className="h-4 w-4 mr-2" />
          Filters
        </Button>
      </div>

      <div
        role="group"
        aria-label="Filter listings by category"
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide"
      >
        {categories.map((cat) => (
          <FilterChip
            key={cat}
            selected={selectedCategory === cat}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </FilterChip>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-label="Loading listings" aria-busy="true">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="aspect-square rounded-xl" />)}</div>
      ) : error ? (
        <EmptyState title="Marketplace unavailable" description={error} action={<Button variant="outline" onClick={() => void loadListings()}>Try again</Button>} />
      ) : listings.length === 0 ? (
        <EmptyState title="No listings found" description="There are no active listings here yet. Check back when the community adds something new." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{listings.map((listing) => <ListingCard key={listing.id} id={listing.id} title={listing.title} price={listing.priceMin ?? listing.priceMax ?? 0} image={listing.imageUrl ?? undefined} seller={{ name: "Community seller" }} location={listing.location || undefined} category={listing.categoryName || undefined} condition={listing.condition || undefined} liked={listing.isSaved} onSavedChange={(saved) => handleSavedChange(listing.id, saved)} />)}</div>
      )}
    </div>
  );
}
