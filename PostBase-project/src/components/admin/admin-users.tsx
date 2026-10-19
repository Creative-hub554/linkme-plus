"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One row of the listing, as `GET /api/admin/roles` reports it. */
interface MemberRow {
  id: string;
  username: string;
  email: string;
  role: string;
  createdAt: string;
}

interface MembersPagination {
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

const ROLE_FILTERS = ["all", "member", "moderator", "admin"] as const;
type RoleFilter = (typeof ROLE_FILTERS)[number];

/**
 * The members the dashboard manages, and the two moves it may make on them.
 *
 * What the buttons can do is exactly what the route's ladder allows and no
 * more: a member may be promoted to moderator and a moderator demoted back.
 * An admin row carries its badge and carries no buttons — the admin role is
 * the owner console's (`npm run admin:grant`), and no dashboard control gets
 * to imply otherwise. The search and the role filter are how a growing
 * platform finds the member it means to move.
 */
export function AdminUsers() {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [pagination, setPagination] = useState<MembersPagination | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (status: RoleFilter, search: string, page: number) => {
    setError(null);
    try {
      const params = new URLSearchParams({ role: status, page: String(page), limit: "20" });
      if (search.trim() !== "") params.set("q", search.trim());
      const response = await fetch(`/api/admin/roles?${params}`, { cache: "no-store" });
      if (!response.ok) {
        setError("The member list could not be loaded. Refresh to try again.");
        setLoaded(true);
        return;
      }
      const payload = (await response.json()) as { data?: MemberRow[]; pagination?: MembersPagination };
      setRows(payload.data ?? []);
      setPagination(payload.pagination ?? null);
      setLoaded(true);
    } catch {
      setError("The member list could not be loaded. Refresh to try again.");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load(roleFilter, query, page);
  }, [load, roleFilter, query, page]);

  const move = async (userId: string, action: "promote" | "demote") => {
    setBusy(userId);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setActionError(body?.error ?? "That role change could not be recorded");
        return;
      }
      await load(roleFilter, query, page);
    } finally {
      setBusy(null);
    }
  };

  const searchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    void load(roleFilter, query, 1);
  };

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Loading members…</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div role="group" aria-label="Filter members by role" className="flex flex-wrap gap-2">
        {ROLE_FILTERS.map((filter) => (
          <Button
            key={filter}
            size="sm"
            variant={roleFilter === filter ? "default" : "outline"}
            aria-pressed={roleFilter === filter}
            onClick={() => {
              setRoleFilter(filter);
              setPage(1);
            }}
          >
            {filter[0].toUpperCase() + filter.slice(1)}
          </Button>
        ))}
      </div>

      {/* The search is a form, so pressing Enter finds rather than reloads;
          the button is its one control and it is named like one. */}
      <form onSubmit={searchSubmit} className="flex max-w-md gap-2">
        <label htmlFor="admin-user-search" className="sr-only">
          Find a member by username or email
        </label>
        <Input
          id="admin-user-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a member by username or email"
          className="h-9 flex-1"
        />
        <Button type="submit" size="sm" variant="outline" disabled={query.trim() === ""}>
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.trim() !== "" ? `No member matches “${query.trim()}”.` : "No members in this view yet."}
        </p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {rows.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy-800">
                  {member.username}
                  {/* The role is written out, not just coloured — the badge is
                      visible, the line under it is what is announced. */}
                  <span className="ml-2 rounded-full bg-surface-light-blue px-2 py-0.5 text-xs font-medium text-navy-700">
                    <span className="sr-only">Role: </span>
                    {member.role}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {member.email} · joined {new Date(member.createdAt).toLocaleDateString()}
                </p>
              </div>
              {/* The admin row has no buttons, by design: the owner console
                  owns that role and nothing in-app implies otherwise. */}
              {member.role === "member" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === member.id}
                  onClick={() => void move(member.id, "promote")}
                >
                  Promote to moderator
                </Button>
              )}
              {member.role === "moderator" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === member.id}
                  onClick={() => void move(member.id, "demote")}
                >
                  Demote to member
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {actionError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total.toLocaleString()} total
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!pagination.hasMore}
              onClick={() => setPage(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
