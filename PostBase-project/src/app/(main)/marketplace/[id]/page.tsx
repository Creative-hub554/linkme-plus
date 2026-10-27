"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface ListingDetail {
  listing: {
    id: string;
    sellerId: string;
    title: string;
    description: string | null;
    priceMin: number | null;
    priceMax: number | null;
    location: string | null;
    condition: string | null;
    status: string;
  };
  media: { id: string; url: string; altText: string | null }[];
  inventory?: { quantity: number | null } | null;
}
export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const [data, setData] = useState<ListingDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<ListingDetail>(
      `/api/marketplace?id=${encodeURIComponent(id)}`,
      { signal: controller.signal },
    )
      .then(setData)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [id]);
  async function contact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await clientRequest<{ conversationId: string }>(
        "/api/messages",
        jsonBody({
          recipientId: data.listing.sellerId,
          content: `Regarding ${data.listing.title}: ${String(form.get("message")).trim()}`,
        }),
      );
      router.push(`/messages?c=${encodeURIComponent(result.conversationId)}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to contact seller.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function markSold() {
    setBusy(true);
    setError("");
    try {
      await clientRequest(
        "/api/marketplace",
        jsonBody({ id, status: "sold" }, "PUT"),
      );
      setData(
        (prev) =>
          prev && { ...prev, listing: { ...prev.listing, status: "sold" } },
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update listing.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/marketplace" className="text-brand-blue">
        ← Marketplace
      </Link>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {!data ? (
        !error && <p role="status">Loading listing…</p>
      ) : (
        <>
          <h1 className="text-2xl font-bold">{data.listing.title}</h1>
          <p className="text-xl font-semibold">
            ${data.listing.priceMin ?? data.listing.priceMax ?? 0} ·{" "}
            {data.listing.status}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.media.map((item) => (
              <img
                key={item.id}
                src={item.url}
                alt={item.altText || data.listing.title}
                className="w-full rounded-xl object-contain"
              />
            ))}
          </div>
          <p className="whitespace-pre-wrap">{data.listing.description}</p>
          <p>
            {data.listing.condition} ·{" "}
            {data.listing.location || "Location not specified"}
          </p>
          {session?.user.id === data.listing.sellerId ? (
            <Button
              onClick={markSold}
              disabled={busy || data.listing.status !== "active"}
            >
              Mark as sold
            </Button>
          ) : data.listing.status !== "active" ? (
            <p>This listing is no longer available.</p>
          ) : (
            <form
              onSubmit={contact}
              className="space-y-3 rounded-xl border bg-card p-5"
            >
              <Label htmlFor="message">Message the seller</Label>
              <Textarea
                id="message"
                name="message"
                required
                maxLength={5000}
                defaultValue="Hi, is this still available?"
              />
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send message"}
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
