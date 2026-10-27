"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { clientRequest } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountRestrictionForm } from "./account-restriction-form";
type Member = {
  id: string;
  username: string;
  role: string;
  restrictionKind: string | null;
  restrictedUntil: string | null;
};
export function AdminMemberDirectory() {
  const [members, setMembers] = useState<Member[]>([]),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [hasMore, setHasMore] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    clientRequest<{ data: Member[]; hasMore: boolean }>(
      `/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setMembers(Array.isArray(result.data) ? result.data : []);
        setHasMore(Boolean(result.hasMore));
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [query, page, reload]);
  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Member directory</h2>
      <Label htmlFor="adminMemberSearch">Search by username</Label>
      <Input
        id="adminMemberSearch"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
      />
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {busy && <p role="status">Loading members…</p>}
      {!busy && !members.length && <p>No matching members.</p>}
      {members.map((member) => (
        <article key={member.id} className="space-y-3 rounded-lg border p-4">
          <Link
            className="font-semibold text-brand-blue"
            href={`/profile?user=${member.id}`}
          >
            @{member.username}
          </Link>
          <p>
            {member.role} ·{" "}
            {member.restrictionKind === "ban"
              ? "Banned"
              : member.restrictedUntil &&
                  new Date(member.restrictedUntil) > new Date()
                ? `Suspended until ${new Date(member.restrictedUntil).toLocaleString()}`
                : "Active"}
          </p>
          {member.role !== "admin" && (
            <AccountRestrictionForm
              userId={member.id}
              onSaved={() => setReload((value) => value + 1)}
            />
          )}
        </article>
      ))}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={page === 1 || busy}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous members
        </Button>
        <span>Page {page}</span>
        <Button
          variant="outline"
          disabled={!hasMore || busy}
          onClick={() => setPage((value) => value + 1)}
        >
          Next members
        </Button>
      </div>
    </section>
  );
}
