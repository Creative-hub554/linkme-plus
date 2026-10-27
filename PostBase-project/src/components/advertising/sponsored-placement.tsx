"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { clientRequest, jsonBody } from "@/lib/client-request";
type Ad = {
  id: string;
  headline: string;
  imageUrl: string | null;
  destinationUrl: string;
  altText: string | null;
};
export function SponsoredPlacement({
  location,
  category,
}: {
  location: "feed" | "jobs" | "marketplace";
  category?: string;
}) {
  const [ad, setAd] = useState<Ad | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setAd(null);
    clientRequest<{ ads: Ad[] }>(
      `/api/advertising/serve?location=${location}${category ? `&category=${encodeURIComponent(category)}` : ""}`,
      { signal: controller.signal },
    )
      .then(({ ads }) => {
        const selected = (Array.isArray(ads) ? ads : []).find((item) => {
          try {
            return (
              !localStorage.getItem(`hidden-ad:${item.id}`) &&
              Number(
                sessionStorage.getItem(
                  `ad-views:${item.id}:${new Date().toISOString().slice(0, 13)}`,
                ) || 0,
              ) < 3
            );
          } catch {
            return false;
          }
        });
        if (!selected || controller.signal.aborted) return;
        const key = `ad-views:${selected.id}:${new Date().toISOString().slice(0, 13)}`;
        try {
          sessionStorage.setItem(
            key,
            String(Number(sessionStorage.getItem(key) || 0) + 1),
          );
        } catch {
          return;
        }
        setAd(selected);
        void clientRequest(
          "/api/advertising/events",
          jsonBody({ campaignId: selected.id, event: "impression" }),
        ).catch(() => {});
      })
      .catch(() => {});
    return () => controller.abort();
  }, [location, category]);
  if (!ad) return null;
  const hide = () => {
    try {
      localStorage.setItem(`hidden-ad:${ad.id}`, "1");
    } catch {}
    setAd(null);
  };
  return (
    <aside
      aria-label="Sponsored placement"
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          Sponsored
        </span>
        <Button size="sm" variant="ghost" onClick={hide}>
          Hide ad
        </Button>
      </div>
      <a
        href={ad.destinationUrl}
        onClick={() => {
          void clientRequest(
            "/api/advertising/events",
            jsonBody({ campaignId: ad.id, event: "click" }),
          ).catch(() => {});
        }}
        className="block space-y-2"
      >
        {ad.imageUrl && (
          <img
            src={ad.imageUrl}
            alt={ad.altText || ad.headline}
            className="max-h-64 w-full rounded object-contain"
          />
        )}
        <span className="font-semibold">{ad.headline}</span>
      </a>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          try {
            await clientRequest(
              "/api/advertising/events",
              jsonBody({
                campaignId: ad.id,
                event: "report",
                reason: data.get("reason"),
              }),
            );
            hide();
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Unable to report ad.",
            );
          }
        }}
        className="flex flex-wrap gap-2"
      >
        <select
          name="reason"
          aria-label="Advertising report reason"
          className="rounded border bg-background p-2 text-xs"
        >
          <option value="spam">Spam</option>
          <option value="scam">Scam</option>
          <option value="misleading">Misleading</option>
          <option value="inappropriate">Inappropriate</option>
        </select>
        <Button type="submit" size="sm" variant="outline">
          Report ad
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </aside>
  );
}
