"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function NewListingPage() {
  const router = useRouter();
  const draftId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<{ categories: { id: string; name: string }[] }>(
      "/api/marketplace/categories",
      { signal: controller.signal },
    )
      .then((data) => setCategories(data.categories))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      // Keep a created draft on a failed publish, so retrying does not duplicate it.
      if (!draftId.current) {
        const file = form.get("image") as File | null;
        const video = form.get("video") as File | null;
        let media: { url: string; altText: string; type: string }[] = [];
        if (file?.size) {
          // The server checks the image's bytes and size; the form declares
          // nothing about the file but the purpose it is for.
          const body = new FormData();
          body.append("file", file);
          body.append("purpose", "listing");
          const upload = await clientRequest<{ url: string }>("/api/uploads", {
            method: "POST",
            body,
          });
          media = [
            { url: upload.url, altText: String(form.get("title")), type: "image" },
          ];
        }
        if (video?.size) {
          // A vertical clip is a marketplace short: same listing, its own media
          // type, rendered with vertical playback on the detail page.
          const body = new FormData();
          body.append("file", video);
          body.append("purpose", "listing");
          const upload = await clientRequest<{ url: string }>("/api/uploads", {
            method: "POST",
            body,
          });
          media.push({
            url: upload.url,
            altText: `${String(form.get("title"))} video`,
            type: "short_video",
          });
        }
        const result = await clientRequest<{ listing: { id: string } }>(
          "/api/marketplace",
          jsonBody({
            title: form.get("title"),
            description: form.get("description"),
            categoryId: form.get("categoryId") || undefined,
            priceMin: Number(form.get("price")),
            location: form.get("location"),
            condition: form.get("condition"),
            media,
          }),
        );
        draftId.current = result.listing.id;
      }
      await clientRequest(
        "/api/marketplace",
        jsonBody({ id: draftId.current, status: "active" }, "PUT"),
      );
      router.push(`/marketplace/${draftId.current}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to publish listing.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="commerce-page mk-dark commerce-detail mx-auto max-w-2xl space-y-5">
      <Link href="/marketplace" className="text-brand-blue">
        ← Marketplace
      </Link>
      <h1 className="text-2xl font-bold">Sell an item</h1>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <form
        onSubmit={submit}
        className="space-y-4 rounded-xl border bg-card p-5"
      >
        <fieldset
          disabled={busy || Boolean(draftId.current)}
          className="space-y-4"
        >
          <Label htmlFor="image">Photo (optional)</Label>
          <Input
            id="image"
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
          />
          <Label htmlFor="video">Short video (optional)</Label>
          <Input
            id="video"
            name="video"
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
          />
          <p className="text-xs text-muted-foreground">
            Vertical clips play as a short on the listing page.
          </p>
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required maxLength={200} />
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            required
            maxLength={20000}
          />
          <Label htmlFor="categoryId">Category</Label>
          <select
            id="categoryId"
            name="categoryId"
            className="w-full rounded border bg-background p-2"
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <Label htmlFor="price">Price (USD)</Label>
          <Input
            id="price"
            name="price"
            type="number"
            min="0"
            max="2147483647"
            step="1"
            required
          />
          <p className="text-xs text-muted-foreground">
            Prices currently use whole dollars.
          </p>
          <Label htmlFor="condition">Condition</Label>
          <select
            id="condition"
            name="condition"
            className="w-full rounded border bg-background p-2"
          >
            <option>New</option>
            <option>Like new</option>
            <option>Good</option>
            <option>Fair</option>
          </select>
          <Label htmlFor="location">Location</Label>
          <Input id="location" name="location" maxLength={100} />
        </fieldset>
        <Button disabled={busy} type="submit">
          {busy
            ? "Publishing…"
            : draftId.current
              ? "Retry publishing draft"
              : "Publish listing"}
        </Button>
      </form>
    </div>
  );
}
