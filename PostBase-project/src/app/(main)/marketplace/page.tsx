"use client";
import { SponsoredPlacement } from "@/components/advertising/sponsored-placement";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterChip } from "@/components/shared/filter-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, SlidersHorizontal } from "lucide-react";

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
  createdAt: string;
  image?: string | null;
  imageType?: "image" | "video" | "short_video" | null;
  sellerName?: string | null;
  /** The viewer's own flag, answered per row by the list read for a signed-in
   * member and `false` for a visitor — the same contract the single-listing
   * read has always had. */
  isSaved: boolean;
}

export default function MarketplacePage() {
  const [categoryOptions, setCategoryOptions] = useState(categories);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketplace/categories", { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (Array.isArray(payload?.categories) && payload.categories.length) {
          setCategoryOptions(["All", ...payload.categories.map((category: { name: string }) => category.name)]);
        }
      })
      .catch(() => { /* Keep the existing category choices if the directory is unavailable. */ });
    return () => controller.abort();
  }, []);
  const requestRef = useRef(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [location, setLocation] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [listings, setListings] = useState<ListingResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadListings = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "24", page: String(page) });
      if (selectedCategory !== "All") params.set("category", selectedCategory);
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);
      if (location.trim()) params.set("location", location.trim());
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const response = await fetch(`/api/marketplace?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load listings");
      const payload = await response.json();
      if (request !== requestRef.current) return;
      setListings(Array.isArray(payload.data) ? payload.data : []);
      setHasMore(Boolean(payload.pagination?.hasMore));
    } catch { if (request === requestRef.current) setError("We couldn't load marketplace listings right now."); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [searchQuery, selectedCategory, minPrice, maxPrice, location, page]);

  useEffect(() => { void loadListings(); }, [loadListings]);
  useEffect(() => { setPage(1); }, [searchQuery, selectedCategory, minPrice, maxPrice, location]);

  return (
    <div className="commerce-page space-y-5">
      <header className="commerce-heading">
        <div>
          <h1 className="commerce-title">Marketplace</h1>
          <p className="text-sm text-muted-foreground mt-1">Buy and sell items in your community</p>
        </div>
        <Button asChild className="commerce-create"><Link href="/marketplace/new"><Plus aria-hidden="true" className="size-4" />List item</Link></Button>
      </header>
      <nav className="commerce-links" aria-label="Marketplace"><Link href="/marketplace/saved">Saved listings</Link><Link href="/marketplace/inventory">Selling &amp; inventory</Link></nav>

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
        <Button variant="outline" onClick={() => setShowFilters(value => !value)} aria-expanded={showFilters} aria-controls="listing-filters">
          <SlidersHorizontal className="h-4 w-4 mr-2" />
          Filters
        </Button>
      </div>

      {showFilters && <div id="listing-filters" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="minPrice">Minimum price (USD)</Label><Input id="minPrice" type="number" min="0" value={minPrice} onChange={event => setMinPrice(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="maxPrice">Maximum price (USD)</Label><Input id="maxPrice" type="number" min="0" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="listingLocation">Location</Label><Input id="listingLocation" value={location} onChange={event => setLocation(event.target.value)} /></div>
        <Button variant="outline" onClick={() => { setMinPrice(""); setMaxPrice(""); setLocation(""); }}>Clear filters</Button>
      </div>}
      <div
        role="group"
        aria-label="Filter listings by category"
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide"
      >
        {categoryOptions.map((cat) => (
          <FilterChip
            key={cat}
            selected={selectedCategory === cat}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </FilterChip>
        ))}
      </div>

      {!searchQuery.trim() && !minPrice && !maxPrice && !location.trim() && <SponsoredPlacement location="marketplace" category={selectedCategory === "All" ? undefined : selectedCategory} />}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4" aria-label="Loading listings" aria-busy="true">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="aspect-square rounded-xl" />)}</div>
      ) : error ? (
        <EmptyState title="Marketplace unavailable" description={error} action={<Button variant="outline" onClick={() => void loadListings()}>Try again</Button>} />
      ) : listings.length === 0 ? (
        <EmptyState title="No listings found" description="There are no active listings here yet. Check back when the community adds something new." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">{listings.map((listing) => <ListingCard key={listing.id} id={listing.id} title={listing.title} price={listing.priceMin ?? listing.priceMax ?? 0} image={listing.image || undefined} imageType={listing.imageType || undefined} seller={{ name: listing.sellerName || "Community seller" }} location={listing.location || undefined} category={listing.categoryName || undefined} condition={listing.condition || undefined} liked={listing.isSaved} />)}</div>
      )}
      <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!hasMore || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div>
    </div>
  );
}
