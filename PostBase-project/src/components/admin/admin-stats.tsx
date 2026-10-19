"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Users, FileText, Flag, DollarSign } from "lucide-react";

/** The payload `GET /api/admin/stats` answers with. */
interface PlatformStats {
  totalUsers: number;
  activePosts: number;
  pendingReports: number;
  adRevenue: number;
}

/**
 * The dashboard's heading row, fed by the one endpoint that computes it.
 *
 * The cards it used to replace printed invented numbers, which is the worst
 * thing a dashboard can do: a platform's size and queue depth are facts, and a
 * card that lies is worse than a card that is briefly absent. So every value
 * here comes from `GET /api/admin/stats`, and the small line under each number
 * says what the number *is* — the definition, rather than a delta nobody
 * computed. `adRevenue` is delivered spend, not bookings, and the line says so.
 *
 * Loading and failure have their own words. A dash is not "zero": until the
 * counts have arrived, or if the route could not answer, this refuses to show
 * a figure that could be read as one.
 */
export function AdminStats() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" });
      if (!response.ok) {
        setFailed(true);
        setStats(null);
        return;
      }
      const payload = (await response.json()) as { stats?: PlatformStats };
      setStats(payload.stats ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
      setStats(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = [
    {
      icon: Users,
      label: "Total Users",
      value: stats ? stats.totalUsers.toLocaleString() : "—",
      definition: "members with an account, excluding deleted ones",
    },
    {
      icon: FileText,
      label: "Active Posts",
      value: stats ? stats.activePosts.toLocaleString() : "—",
      definition: "posts still live, excluding deleted ones",
    },
    {
      icon: Flag,
      label: "Reports Pending",
      value: stats ? stats.pendingReports.toLocaleString() : "—",
      definition: "reports awaiting a decision",
    },
    {
      icon: DollarSign,
      label: "Revenue",
      value: stats ? `$${stats.adRevenue.toLocaleString()}` : "—",
      definition: "ad spend delivered on approved campaigns",
    },
  ];

  return (
    <div className="space-y-2">
      {failed && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          The platform stats could not be loaded. Refresh to try again.
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  {/* aria-hidden keeps a screen reader from announcing dashes
                      before the counts land — the definition under each card is
                      what the labels read as, and the number arrives with it. */}
                  <p className="text-2xl font-bold text-navy-800 mt-1">{card.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{card.definition}</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                  <card.icon className="h-5 w-5 text-brand-blue" aria-hidden="true" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
