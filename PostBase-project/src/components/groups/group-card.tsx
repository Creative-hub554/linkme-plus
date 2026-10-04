"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Loader2 } from "lucide-react";

/** A uuid is a key, not a word: a category that still looks like one is an id nobody resolved. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GroupCardProps {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  memberCount?: number;
  /** The category's human name, joined in by the API. A uuid is not a name: no name, no badge. */
  category?: string;
  isMember?: boolean;
  onMembershipChange?: (groupId: string, isMember: boolean) => void;
}

export function GroupCard({ id, name, description, coverUrl, memberCount = 0, category, isMember = false, onMembershipChange }: GroupCardProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggleMembership() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/groups/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update membership");
      onMembershipChange?.(id, Boolean(payload.member));
    } catch (membershipError) {
      setError(membershipError instanceof Error ? membershipError.message : "Unable to update membership");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      {/* The card's own two doors into the group. Joining from here is not
          opening it, and a group whose posts nobody can reach is a group with a
          Join button and no conversation. */}
      <Link
        href={`/groups/${id}`}
        className="block h-28 bg-gradient-to-br from-brand-blue/20 via-brand-purple/15 to-surface-light-blue"
        aria-label={`Open ${name}`}
      >
        {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
      </Link>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar className="-mt-10 h-12 w-12 ring-2 ring-white">
            <AvatarFallback className="bg-brand-purple font-bold text-white">{name[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-navy-800">
              <Link href={`/groups/${id}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue">
                {name}
              </Link>
            </h3>
            <div className="mt-1 flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />{memberCount.toLocaleString()} members</span>
              {/* Same rule as the listing card: the badge names the shelf, and
                  only when there is a name to wear — a key renders nothing. */}
              {category && !UUID_SHAPE.test(category) && <Badge variant="secondary" className="text-[10px]">{category}</Badge>}
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{description || "A new LinkMe+ community waiting for its first conversations."}</p>
            <Button variant={isMember ? "outline" : "default"} size="sm" className="mt-3" onClick={toggleMembership} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{isMember ? "Leave group" : "Join group"}
            </Button>
            {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
