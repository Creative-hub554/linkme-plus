"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { clientRequest } from "@/lib/client-request";
type Media = { url: string; type: string; altText?: string | null };
export function ProfileMediaGallery({
  userId,
  kind,
  onClose,
}: {
  userId: string | null;
  kind: "photos" | "videos" | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Media[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(
    async function load(
      next: string | null,
      signal?: AbortSignal,
      request = generation.current,
    ) {
      if (!userId || !kind) return;
      setBusy(true);
      setError("");
      try {
        const params = new URLSearchParams({ authorId: userId, limit: "20" });
        if (next) params.set("cursor", next);
        const result = await clientRequest<{
          data: { media?: Media[] }[];
          pagination: { nextCursor: string | null };
        }>(`/api/posts?${params}`, { signal });
        if (request !== generation.current || signal?.aborted) return;
        const media = result.data
          .flatMap((post) => post.media || [])
          .filter((item) =>
            kind === "photos"
              ? item.type.startsWith("image")
              : item.type.startsWith("video"),
          );
        setItems((previous) => [
          ...new Map(
            [...(next ? previous : []), ...media].map((item) => [
              item.url,
              item,
            ]),
          ).values(),
        ]);
        setCursor(result.pagination.nextCursor);
      } catch (err) {
        if (!signal?.aborted && request === generation.current)
          setError(
            err instanceof Error ? err.message : "Unable to load media.",
          );
      } finally {
        if (request === generation.current && !signal?.aborted) setBusy(false);
      }
    },
    [userId, kind],
  );
  useEffect(() => {
    const controller = new AbortController();
    const request = ++generation.current;
    setItems([]);
    setCursor(null);
    if (kind && userId) void load(null, controller.signal, request);
    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [kind, userId, load]);
  return (
    <Dialog
      open={Boolean(kind)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>All {kind || "media"}</DialogTitle>
          <DialogDescription>
            Browse shared media. Load more to include older posts.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <div className="grid max-h-[65vh] gap-3 overflow-auto sm:grid-cols-2">
          {items.map((item) =>
            kind === "photos" ? (
              <a
                key={item.url}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src={item.url}
                  alt={item.altText || "Shared photo"}
                  className="w-full rounded object-contain"
                />
              </a>
            ) : (
              <video
                key={item.url}
                src={item.url}
                controls
                aria-label={item.altText || "Shared video"}
                className="w-full rounded"
              />
            ),
          )}
        </div>
        {!items.length && !busy && !error && (
          <p>No matching media on the pages loaded so far.</p>
        )}
        {busy && <p role="status">Loading media…</p>}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void load(error && !items.length ? null : cursor)}
        >
          {error ? "Try again" : cursor ? "Load more media" : "Refresh gallery"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
