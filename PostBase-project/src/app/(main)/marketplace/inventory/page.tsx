"use client";
import Link from "next/link";
import { SellerPlanUsage } from "@/components/marketplace/seller-plan-usage";
import { useEffect, useState, type FormEvent } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Inventory = {
  id: string;
  quantity: number;
  sku: string | null;
  unitCost: number | null;
  lowStockThreshold: number;
};
type Movement = {
  id: string;
  type: string;
  quantity: number;
  reason: string | null;
  createdAt: string;
};
export default function InventoryPage() {
  const [listings, setListings] = useState<
    { id: string; title: string; status: string }[]
  >([]);
  const [selected, setSelected] = useState("");
  const [stock, setStock] = useState<Inventory | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    clientRequest<{ data: typeof listings; pagination: { hasMore: boolean } }>(
      `/api/marketplace?mine=true&page=${page}&q=${encodeURIComponent(search)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setListings(result.data);
        setHasMore(result.pagination.hasMore);
        setSelected((previous) =>
          result.data.some((item) => item.id === previous)
            ? previous
            : result.data[0]?.id || "",
        );
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, search]);
  useEffect(() => {
    if (!selected) {
      setStock(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setStock(null);
    setMovements([]);
    setNotice("");
    clientRequest<{ inventory: Inventory; movements: Movement[] }>(
      `/api/marketplace/inventory?listingId=${encodeURIComponent(selected)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setStock(result.inventory);
        setMovements(result.movements);
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.message !== "Inventory not found")
          setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected, reload]);
  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await clientRequest<{ inventory: Inventory }>(
        "/api/marketplace/inventory",
        jsonBody(
          {
            listingId: selected,
            sku: form.get("sku"),
            unitCost:
              form.get("unitCost") === "" ? null : Number(form.get("unitCost")),
            lowStockThreshold: Number(form.get("threshold")),
          },
          "PUT",
        ),
      );
      setStock(result.inventory);
      setNotice("Inventory settings saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save inventory.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stock) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await clientRequest(
        "/api/marketplace/inventory",
        jsonBody({
          inventoryId: stock.id,
          type: form.get("type"),
          quantity: Number(form.get("quantity")),
          reason: form.get("reason"),
        }),
      );
      setReload((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to adjust stock.");
    } finally {
      setBusy(false);
    }
  }
  const availability = !stock
    ? "Not tracked"
    : stock.quantity === 0
      ? "Out of stock"
      : stock.quantity <= stock.lowStockThreshold
        ? "Low stock"
        : "In stock";
  return (
    <div className="commerce-page commerce-detail mx-auto max-w-3xl space-y-5">
      <Link href="/marketplace" className="text-brand-blue">
        ← Marketplace
      </Link>
      <SellerPlanUsage />
      <h1 className="text-2xl font-bold">Inventory manager</h1>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Label htmlFor="productSearch">Search your listings</Label>
      <Input
        id="productSearch"
        disabled={busy}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {loading && <p role="status">Loading stock…</p>}
      {!loading && !listings.length && (
        <p>
          No listings found.{" "}
          <Link className="text-brand-blue underline" href="/marketplace/new">
            Sell an item
          </Link>{" "}
          first.
        </p>
      )}
      {listings.length > 0 && (
        <>
          <Label htmlFor="product">Product</Label>
          <select
            id="product"
            disabled={busy}
            className="w-full rounded border bg-background p-2"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {listings.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.status}
              </option>
            ))}
          </select>
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={page === 1 || loading || busy}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous listings
            </Button>
            <Button
              variant="outline"
              disabled={!hasMore || loading || busy}
              onClick={() => setPage((value) => value + 1)}
            >
              Next listings
            </Button>
          </div>
          {!loading && (
            <>
              <p className="text-lg font-semibold">
                {availability}
                {stock ? ` · ${stock.quantity} units` : ""}
              </p>
              <form
                key={`${selected}-${stock?.id || "new"}`}
                onSubmit={configure}
                className="space-y-3 rounded-xl border bg-card p-5"
              >
                <h2 className="font-semibold">
                  {stock ? "Stock settings" : "Start tracking stock"}
                </h2>
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  name="sku"
                  defaultValue={stock?.sku || ""}
                  maxLength={50}
                />
                <Label htmlFor="unitCost">
                  Unit cost in USD (private, whole dollars)
                </Label>
                <Input
                  id="unitCost"
                  name="unitCost"
                  type="number"
                  min="0"
                  max="2147483647"
                  step="1"
                  defaultValue={stock?.unitCost ?? ""}
                />
                <Label htmlFor="threshold">Low-stock threshold</Label>
                <Input
                  id="threshold"
                  name="threshold"
                  type="number"
                  min="0"
                  max="2147483647"
                  step="1"
                  defaultValue={stock?.lowStockThreshold ?? 5}
                  required
                />
                <Button disabled={busy} type="submit">
                  Save stock settings
                </Button>
              </form>
              {stock && (
                <form
                  onSubmit={adjust}
                  className="space-y-3 rounded-xl border bg-card p-5"
                >
                  <h2 className="font-semibold">Record a stock movement</h2>
                  <Label htmlFor="movement">Movement</Label>
                  <select
                    id="movement"
                    name="type"
                    className="w-full rounded border bg-background p-2"
                  >
                    {[
                      "added",
                      "sold",
                      "returned",
                      "damaged",
                      "expired",
                      "adjusted",
                    ].map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                  <Label htmlFor="quantity">
                    Quantity (for “adjusted”, enter the new total)
                  </Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    min="0"
                    step="1"
                    max="2147483647"
                    required
                  />
                  <Label htmlFor="reason">Reason</Label>
                  <Input id="reason" name="reason" required maxLength={100} />
                  <Button disabled={busy} type="submit">
                    Save movement
                  </Button>
                </form>
              )}
              <h2 className="text-lg font-semibold">Recent movements</h2>
              {movements.map((item) => (
                <div key={item.id} className="border-b py-2">
                  {item.type} · {item.quantity} · {item.reason} ·{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              ))}
              {!movements.length && <p>No movements recorded yet.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
