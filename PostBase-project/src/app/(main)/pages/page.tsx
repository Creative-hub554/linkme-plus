"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Flag, Loader2, Plus } from "lucide-react";

interface PageListItem {
  id: string;
  username: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  category?: string | null;
  followers: number;
}

/**
 * The Pages directory: the Pages you own and the Pages you follow.
 *
 * Scoped by the API rather than trimmed here, because a list that arrived whole
 * and was then hidden would still have been sent. Discovery is search's job — a
 * Page is found by name, followed from its own page, and listed here from then
 * on. What the list can never offer is a Page that would then refuse to open,
 * which is why it reads the same two edges the Page's own gate does.
 */
export default function PagesDirectory() {
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/pages");
        if (!response.ok) throw new Error("Failed to load Pages");
        const payload = await response.json();
        if (!cancelled) setPages(Array.isArray(payload?.pages) ? payload.pages : []);
      } catch {
        if (!cancelled) setError("We couldn't load the Pages directory. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy-800">Pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public accounts for a brand, a business or a community. Yours and the ones you follow
            are listed here — find others by name in Search.
          </p>
        </div>
        <Link href="/pages/new">
          <Button>
            <Plus className="mr-1.5 h-4 w-4" />
            Create a Page
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground" aria-busy="true">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Pages...
        </div>
      ) : error ? (
        <p role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : pages.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<Flag className="h-8 w-8" />}
          title="No Pages yet"
          description="Create one of your own, or follow a Page you have found and it will show up here."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/pages/new">
                <Button>Create a Page</Button>
              </Link>
              <Link href="/search">
                <Button variant="outline">Search for a Page</Button>
              </Link>
            </div>
          }
        />
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {pages.map((page) => (
            <li key={page.id}>
              <Link href={`/pages/${page.username}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue">
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="flex items-start gap-3 p-4">
                    <Avatar className="h-12 w-12 shrink-0 ring-2 ring-brand-blue/10">
                      <AvatarImage src={page.avatarUrl ?? undefined} alt={`${page.name} profile picture`} />
                      <AvatarFallback className="bg-brand-blue/10 font-semibold text-brand-blue">
                        {page.name[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate font-semibold text-navy-800">{page.name}</span>
                        {page.category && <Badge variant="secondary">{page.category}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        @{page.username} · {page.followers} follower{page.followers === 1 ? "" : "s"}
                      </p>
                      {page.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-navy-700">{page.description}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
