"use client";
import { useId, useState } from "react";
import { clientRequest } from "@/lib/client-request";
export function PrivateEvidenceUpload({ purpose, value, onChange }: { purpose: "national_id" | "office"; value: string[]; onChange(ids: string[]): void }) {
  const id = useId(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const max = purpose === "national_id" ? 2 : 5;
  return <div className="space-y-2 rounded border p-3">
    <label htmlFor={id} className="block font-medium">{purpose === "national_id" ? "National ID images (private)" : "Office photos (required, private)"}</label>
    <p className="text-xs text-muted-foreground">Only you and authorized reviewers can access these images. JPEG, PNG or WebP, up to 10 MB each.</p>
    <input id={id} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || value.length >= max} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      const input = event.currentTarget;
      setBusy(true); setError("");
      try {
        const form = new FormData(); form.set("file", file); form.set("purpose", purpose);
        const result = await clientRequest<{ evidence: { id: string } }>("/api/evidence", { method: "POST", body: form });
        onChange([...value, result.evidence.id]); input.value = "";
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to upload evidence"); }
      finally { setBusy(false); }
    }} />
    <p role="status" className="text-sm">{busy ? "Processing private image…" : `${value.length} / ${max} images uploaded`}</p>
    {value.map((item, index) => <div key={item} className="flex items-center gap-2 text-sm"><span>Image {index + 1}</span><button type="button" disabled={busy} className="underline" onClick={() => onChange(value.filter(id => id !== item))}>Remove image {index + 1}</button></div>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
export function PrivateEvidencePreview({ id }: { id: string }) {
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  return <div className="space-y-2"><button type="button" className="text-sm underline" onClick={async () => {
    setError("");
    try { const result = await clientRequest<{ url: string }>(`/api/evidence?id=${encodeURIComponent(id)}`); setUrl(result.url); }
    catch { setError("Evidence unavailable or access expired"); }
  }}>View private evidence</button>{url && <img src={url} alt="Private evidence for authorized review" className="max-h-80 rounded object-contain" onError={() => { setUrl(""); setError("Evidence link expired. Request a new view."); }} />}{error && <p role="alert" className="text-sm">{error}</p>}</div>;
}
