"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Placement = {
  id: string;
  name: string;
  location: string;
  dailyRate: number;
  currency: string;
  maxActive: number;
};
type CampaignRow = {
  campaign: {
    id: string;
    type: string;
    budget: number;
    currency: string;
    status: string;
    startDate: string;
    endDate: string;
  };
  creative: {
    headline: string;
    destinationUrl: string;
    imageUrl: string | null;
  };
  payment: {
    status: string;
    reference: string | null;
    payerName: string | null;
    note: string | null;
    merchantName: string;
    qrImageUrl: string;
  };
  impressions: number;
  clicks: number;
  sourceEligible: boolean;
};
type Data = {
  paymentSettings?: { merchantName: string; qrImageUrl: string; currency: string }[];
  campaigns: CampaignRow[];
  placements: Placement[];
  settings: {
    merchantName: string;
    qrImageUrl: string;
    currency: string;
  } | null;
  isAdmin: boolean;
  hasMore: boolean;
};
export default function AdvertisingManagerPage() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [review, setReview] = useState(false);
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [type, setType] = useState("banner");
  const [sources, setSources] = useState<{
    listings: { id: string; title: string }[];
    posts: { id: string; content: string | null; pageName: string | null }[];
  }>({ listings: [], posts: [] });
  const [sourcePage, setSourcePage] = useState(1);
  const [paymentCurrency, setPaymentCurrency] = useState("KHR");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("type") === "boost")
      setType("boost");
  }, []);
  const merchantSettings = data?.paymentSettings || (data?.settings ? [data.settings] : []);
  const selectedSettings = merchantSettings.find((item) => item.currency === paymentCurrency);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    clientRequest<Data>(`/api/advertising?page=${page}&admin=${review}`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, review, reload]);
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<typeof sources>(
      `/api/advertising/sources?page=${sourcePage}&limit=100`,
      { signal: controller.signal },
    )
      .then((result) =>
        setSources({
          listings: result.listings || [],
          posts: result.posts || [],
        }),
      )
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [sourcePage, reload]);
  async function write(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await clientRequest(url, jsonBody(body, method));
      setNotice("Saved successfully.");
      setReload((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startDate = new Date(String(form.get("startDate")) + "T00:00:00");
    const endDate = new Date(String(form.get("endDate")) + "T00:00:00");
    endDate.setDate(endDate.getDate() + 1);
    await write("/api/advertising", {
      type,
      placementId: form.get("placementId"),
      headline: form.get("headline"),
      imageUrl: form.get("imageUrl"),
      destinationUrl: form.get("destinationUrl"),
      sourceId: form.get("sourceId"),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
  }
  async function settings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      let qrImageUrl = String(form.get("qrImageUrl") || "");
      const image = form.get("qrFile") as File | null;
      if (image?.size) {
        // The route inspects the image itself, so a file renamed to `.png` is
        // refused here rather than stored and served as one.
        const body = new FormData();
        body.append("file", image);
        body.append("purpose", "post");
        const upload = await clientRequest<{ url: string }>("/api/uploads", {
          method: "POST",
          body,
        });
        qrImageUrl = upload.url;
      }
      await clientRequest(
        "/api/admin/advertising",
        jsonBody({
          action: "settings",
          merchantName: form.get("merchantName"),
          currency: form.get("currency"),
          qrImageUrl,
        }),
      );
      setNotice("KHQR payment details saved.");
      setReload((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save KHQR details.",
      );
    } finally {
      setBusy(false);
    }
  }
  const placements =
    data?.placements.filter(
      (item) =>
        merchantSettings.some((setting) => setting.currency === item.currency) &&
        item.dailyRate > 0 &&
        (type === "boost"
          ? item.location === "feed"
          : type === "promotion"
            ? item.location === "marketplace"
            : true),
    ) || [];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/ads" className="text-brand-blue">
        ← Advertising information
      </Link>
      <h1 className="text-2xl font-bold">Advertising manager</h1>
      <p className="text-sm text-muted-foreground">
        KHQR payments are checked manually against the merchant’s bank records.
        Campaigns run only after payment verification and content approval.
        Rates use whole KHR or USD units.
      </p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading campaigns…</p>}
      {data && (
        <>
          {data.isAdmin && (
            <Button
              variant="outline"
              onClick={() => {
                setReview((value) => !value);
                setPage(1);
              }}
            >
              {review ? "My campaigns" : "Review all campaigns"}
            </Button>
          )}
          {!review && (
            <section className="space-y-4 rounded-xl border bg-card p-5">
              <h2 className="text-xl font-semibold">Create a campaign</h2>
              {!data.settings && (
                <p>
                  Campaign payments are not configured yet. An administrator
                  must add the merchant KHQR below before bookings can begin.
                </p>
              )}
              <form onSubmit={create} className="space-y-3">
                <Label htmlFor="campaignType">Campaign type</Label>
                <select
                  id="campaignType"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="w-full rounded border bg-background p-2"
                >
                  <option value="banner">Banner</option>
                  <option value="promotion">Promoted listing</option>
                  <option value="boost">Post boost (Feed)</option>
                </select>
                <Label htmlFor="placement">Placement and daily rate</Label>
                <select
                  id="placement"
                  name="placementId"
                  required
                  className="w-full rounded border bg-background p-2"
                >
                  {placements.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.dailyRate.toLocaleString()}{" "}
                      {item.currency}/day
                    </option>
                  ))}
                </select>
                {!placements.length && (
                  <p>No paid placements configured for this campaign type.</p>
                )}
                {type === "banner" ? (
                  <>
                    <Label htmlFor="headline">Headline</Label>
                    <Input
                      id="headline"
                      name="headline"
                      required
                      maxLength={200}
                    />
                    <Label htmlFor="imageUrl">Banner image URL</Label>
                    <Input id="imageUrl" name="imageUrl" type="url" required />
                    <Label htmlFor="destinationUrl">Destination URL</Label>
                    <Input
                      id="destinationUrl"
                      name="destinationUrl"
                      type="url"
                      required
                    />
                  </>
                ) : (
                  <>
                    <Label htmlFor="source">
                      {type === "promotion"
                        ? "Your listing"
                        : "Your public post or a post from a Page you administer"}
                    </Label>
                    <select
                      id="source"
                      name="sourceId"
                      required
                      className="w-full rounded border bg-background p-2"
                    >
                      {type === "promotion"
                        ? sources.listings.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.title}
                            </option>
                          ))
                        : sources.posts.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.pageName || "Personal post"}:{" "}
                              {item.content?.slice(0, 80) || "Media post"}
                            </option>
                          ))}
                    </select>
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={sourcePage === 1}
                        onClick={() => setSourcePage((value) => value - 1)}
                      >
                        Newer sources
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSourcePage((value) => value + 1)}
                      >
                        Older sources
                      </Button>
                    </div>
                  </>
                )}
                <Label htmlFor="startDate">First day</Label>
                <Input id="startDate" name="startDate" type="date" required />
                <Label htmlFor="endDate">Last day</Label>
                <Input id="endDate" name="endDate" type="date" required />
                <Button
                  type="submit"
                  disabled={busy || !data.settings || !placements.length}
                >
                  Create booking and view payment amount
                </Button>
                <p className="text-xs text-muted-foreground">
                  The server calculates your total from the placement rate and
                  booked days. Dates are reserved only on approval; verify
                  availability with the administrator before paying.
                </p>
              </form>
            </section>
          )}
          <h2 className="text-xl font-semibold">
            {review ? "Campaign review" : "My campaigns"}
          </h2>
          {!data.campaigns.length && <p>No campaigns on this page.</p>}
          {data.campaigns.map((row) => (
            <article
              key={row.campaign.id}
              className="space-y-4 rounded-xl border bg-card p-5"
            >
              <h3 className="font-semibold">
                {row.creative?.headline || "Campaign"}
              </h3>
              <p>
                {row.campaign.budget.toLocaleString()} {row.campaign.currency} ·{" "}
                {new Date(row.campaign.startDate).toLocaleDateString()} –{" "}
                {new Date(row.campaign.endDate).toLocaleDateString()}
              </p>
              <p>
                Status:{" "}
                {new Date(row.campaign.endDate) <= new Date() &&
                !["cancelled", "refunded", "rejected"].includes(
                  row.campaign.status,
                )
                  ? "completed"
                  : row.campaign.status}{" "}
                · Payment: {row.payment?.status || "awaiting"}
              </p>
              {["active", "scheduled", "approved"].includes(
                row.campaign.status,
              ) &&
                !row.sourceEligible && (
                  <p role="status">
                    Delivery is stopped because the source changed or became
                    unavailable. Request a new review after resolving the source
                    issue.
                  </p>
                )}
              <p className="text-sm text-muted-foreground">
                {row.impressions} member views · {row.clicks} member clicks
                (deduplicated per member per day)
              </p>
              {row.creative?.imageUrl && (
                <img
                  src={row.creative.imageUrl}
                  alt="Campaign creative"
                  className="max-h-48 rounded object-contain"
                />
              )}
              <a
                href={row.creative?.destinationUrl}
                className="text-brand-blue underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Review campaign destination
              </a>
              {row.payment?.note && <p>Review note: {row.payment.note}</p>}
              {review ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void write("/api/admin/advertising", {
                      id: row.campaign.id,
                      action: form.get("action"),
                      note: form.get("note"),
                    });
                  }}
                  className="space-y-3"
                >
                  <p>
                    Bank reference: {row.payment?.reference || "Not submitted"}{" "}
                    · Payer: {row.payment?.payerName || "Not submitted"}
                  </p>
                  <Label htmlFor={`decision-${row.campaign.id}`}>
                    Decision
                  </Label>
                  <select
                    id={`decision-${row.campaign.id}`}
                    name="action"
                    className="w-full rounded border bg-background p-2"
                  >
                    <option value="verify">
                      I checked the bank: payment received
                    </option>
                    <option value="approve">
                      Approve content and reserve placement
                    </option>
                    <option value="reject">Reject with reason</option>
                    <option value="refund">
                      I completed a bank refund: record it
                    </option>
                  </select>
                  <Label htmlFor={`note-${row.campaign.id}`}>
                    Decision note / bank reconciliation reference
                  </Label>
                  <Input
                    id={`note-${row.campaign.id}`}
                    name="note"
                    required
                    maxLength={2000}
                  />
                  <p className="text-xs text-muted-foreground">
                    Screenshots or submitted references alone do not prove
                    payment. Check the actual bank credit and amount. Refunds
                    must be made in your bank before recording them here.
                  </p>
                  <Button type="submit" disabled={busy}>
                    Save reviewed decision
                  </Button>
                </form>
              ) : (
                <>
                  {row.payment &&
                    ["awaiting", "rejected"].includes(row.payment.status) && (
                      <div className="space-y-3">
                        <p>
                          Pay exactly {row.campaign.budget.toLocaleString()}{" "}
                          {row.campaign.currency} to {row.payment.merchantName}.
                          Verify the merchant and currency in your banking app.
                        </p>
                        <img
                          src={row.payment.qrImageUrl}
                          alt={`Merchant KHQR for ${row.payment.merchantName}`}
                          className="h-64 w-64 object-contain"
                        />
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            void write(
                              "/api/advertising",
                              {
                                id: row.campaign.id,
                                action: "payment",
                                reference: form.get("reference"),
                                payerName: form.get("payerName"),
                              },
                              "PUT",
                            );
                          }}
                          className="space-y-3"
                        >
                          <Label htmlFor={`reference-${row.campaign.id}`}>
                            Bank transaction reference
                          </Label>
                          <Input
                            id={`reference-${row.campaign.id}`}
                            name="reference"
                            required
                            minLength={4}
                            maxLength={100}
                          />
                          <Label htmlFor={`payer-${row.campaign.id}`}>
                            Payer name shown in bank records
                          </Label>
                          <Input
                            id={`payer-${row.campaign.id}`}
                            name="payerName"
                            required
                            maxLength={100}
                          />
                          <Button type="submit" disabled={busy}>
                            Submit payment for manual verification
                          </Button>
                        </form>
                      </div>
                    )}
                  {!["cancelled", "refunded", "completed"].includes(
                    row.campaign.status,
                  ) && (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void write(
                            "/api/advertising",
                            { id: row.campaign.id, action: "pause" },
                            "PUT",
                          )
                        }
                      >
                        Pause
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || row.payment?.status !== "verified"}
                        onClick={() =>
                          void write(
                            "/api/advertising",
                            { id: row.campaign.id, action: "resume" },
                            "PUT",
                          )
                        }
                      >
                        Request review / resume
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void write(
                            "/api/advertising",
                            { id: row.campaign.id, action: "cancel" },
                            "PUT",
                          )
                        }
                      >
                        Cancel campaign
                      </Button>
                    </div>
                  )}
                  {row.campaign.status === "cancelled" &&
                    row.payment?.status === "verified" && (
                      <p>
                        Contact the administrator to arrange any refund.
                        Cancellation does not transfer money back automatically.
                      </p>
                    )}
                </>
              )}
            </article>
          ))}
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={page === 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous campaigns
            </Button>
            <Button
              variant="outline"
              disabled={!data.hasMore || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Next campaigns
            </Button>
          </div>
          {data.isAdmin && (
            <section className="space-y-5 rounded-xl border bg-card p-5">
              <h2 className="text-xl font-semibold">
                Merchant KHQR and placement setup
              </h2>
              <form
                onSubmit={settings}
                key={`${paymentCurrency}-${selectedSettings?.qrImageUrl || "setup"}`}
                className="space-y-3"
              >
                <Label htmlFor="merchantName">Merchant name</Label>
                <Input
                  id="merchantName"
                  name="merchantName"
                  required
                  maxLength={100}
                  defaultValue={selectedSettings?.merchantName || ""}
                />
                <Label htmlFor="qrFile">
                  Upload your existing merchant KHQR image
                </Label>
                <Input
                  id="qrFile"
                  name="qrFile"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
                <Label htmlFor="qrImageUrl">Or use a KHQR image URL</Label>
                <Input
                  id="qrImageUrl"
                  name="qrImageUrl"
                  type="url"
                  defaultValue={selectedSettings?.qrImageUrl || ""}
                />
                <Label htmlFor="currency">KHQR currency</Label>
                <select
                  id="currency"
                  name="currency"
                  value={paymentCurrency}
                  onChange={(event) => setPaymentCurrency(event.target.value)}
                  className="w-full rounded border bg-background p-2"
                >
                  <option>KHR</option>
                  <option>USD</option>
                </select>
                <p className="text-sm text-muted-foreground">
                  Save KHR and USD separately using the correct merchant QR for each currency.
                  Saving one currency preserves the other.
                </p>
                <Button type="submit" disabled={busy}>
                  Save merchant KHQR
                </Button>
              </form>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void write("/api/admin/advertising", {
                    action: "placement",
                    name: form.get("name"),
                    location: form.get("location"),
                    dailyRate: Number(form.get("dailyRate")),
                    currency: form.get("currency"),
                    maxActive: Number(form.get("maxActive")),
                  });
                }}
                className="space-y-3"
              >
                <h3 className="font-semibold">Add a paid placement</h3>
                <Label htmlFor="placementName">Placement name</Label>
                <Input
                  id="placementName"
                  name="name"
                  required
                  maxLength={100}
                />
                <Label htmlFor="placementLocation">Surface</Label>
                <select
                  id="placementLocation"
                  name="location"
                  className="w-full rounded border bg-background p-2"
                >
                  <option value="feed">Social feed</option>
                  <option value="marketplace">Marketplace</option>
                  <option value="jobs">Jobs</option>
                </select>
                <Label htmlFor="dailyRate">Daily price (whole units)</Label>
                <Input
                  id="dailyRate"
                  name="dailyRate"
                  type="number"
                  min="1"
                  max="10000000"
                  required
                />
                <Label htmlFor="rateCurrency">Currency</Label>
                <select
                  id="rateCurrency"
                  name="currency"
                  className="w-full rounded border bg-background p-2"
                >
                  <option>KHR</option>
                  <option>USD</option>
                </select>
                <Label htmlFor="capacity">Concurrent bookings allowed</Label>
                <Input
                  id="capacity"
                  name="maxActive"
                  type="number"
                  min="1"
                  max="20"
                  defaultValue="1"
                  required
                />
                <Button type="submit" disabled={busy}>
                  Create placement
                </Button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
