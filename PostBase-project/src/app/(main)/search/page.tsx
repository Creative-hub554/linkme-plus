"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Suspense } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Search } from "lucide-react";
import { FollowButton } from "@/components/social/follow-button";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchBar } from "@/components/shared/search-bar";
import { normalizeSearchQuery } from "@/lib/search-query";

interface SearchPerson {
  id: string;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  isFollowing?: boolean;
}

/**
 * The people a query found.
 *
 * It owns the "nothing to show" copy as well as the rows, because the reason
 * there is nothing to show differs: no query yet, still searching, or a search
 * that came back empty. Only the last of those is a result.
 */
function PeopleList({
  query,
  people,
  loading,
}: {
  query: string;
  people: SearchPerson[];
  loading: boolean;
}) {
  if (!query) {
    return <EmptyState title="No people found" description="Enter a name or username to find people." />;
  }
  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Searching people...</p>;
  }
  if (people.length === 0) {
    return <EmptyState title="No people found" description="No members match your search query." />;
  }

  return (
    <div className="space-y-3">
      {people.map((person) => {
        const name = person.displayName || person.username || "Member";
        return (
          <Card key={person.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-brand-blue/10 font-bold text-brand-blue">
                    {name[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">@{person.username || "member"}</p>
                </div>
              </div>
              <FollowButton userId={person.id} initialFollowing={Boolean(person.isFollowing)} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function SearchResults() {
  const searchParams = useSearchParams();
  // Through the shared rule rather than `|| ""`: a bare `?q=%20` used to read as
  // a query of one space, which the API's `%…%` match answers with everything.
  const query = normalizeSearchQuery(searchParams.get("q"));
  const [people, setPeople] = useState<SearchPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  useEffect(() => {
    if (!query) { setPeople([]); return; }
    let cancelled = false;
    setPeopleLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(query)}&type=users`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Search failed")))
      .then((payload) => { if (!cancelled) setPeople(Array.isArray(payload.results?.users) ? payload.results.users : []); })
      .catch(() => { if (!cancelled) setPeople([]); })
      .finally(() => { if (!cancelled) setPeopleLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">
          {query ? `Results for "${query}"` : "Search"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Find people, posts, groups, jobs, and marketplace listings
        </p>
      </div>

      {/* The bar every empty state on this page points at ("use the search bar
          above"). It existed as a component nothing imported, on a page that
          read `?q=` and offered no way to write it. Prefilled so refining a
          search starts from what was searched for. */}
      <SearchBar defaultValue={query} className="max-w-xl" />

      <Tabs defaultValue="all">
        {/* Named for the same reason the marketplace's filter row is: the tabs
            say what each one shows, and nothing on the page says what the set
            of them is choosing between. */}
        <TabsList aria-label="Result type">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4 mt-4">
          {query ? (
            // People is the one kind of result this page searches, so it is what
            // "All" currently has to show. Sections for the other kinds join it
            // here as each is wired up.
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-navy-700">People</h2>
              <PeopleList query={query} people={people} loading={peopleLoading} />
            </section>
          ) : (
            <EmptyState
              icon={<Search className="h-12 w-12" />}
              title="Start searching"
              description="Use the search bar above to find people, posts, groups, jobs, and more."
            />
          )}
        </TabsContent>

        <TabsContent value="people" className="mt-4">
          <PeopleList query={query} people={people} loading={peopleLoading} />
        </TabsContent>

        <TabsContent value="posts" className="mt-4">
          <EmptyState
            title="No posts found"
            description="No posts match your search query."
          />
        </TabsContent>

        <TabsContent value="groups" className="mt-4">
          <EmptyState
            title="No groups found"
            description="No groups match your search query."
          />
        </TabsContent>

        <TabsContent value="jobs" className="mt-4">
          <EmptyState
            title="No jobs found"
            description="No jobs match your search query."
          />
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <EmptyState
            title="No listings found"
            description="No marketplace listings match your search query."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-muted-foreground">Loading search...</div>}>
      <SearchResults />
    </Suspense>
  );
}
