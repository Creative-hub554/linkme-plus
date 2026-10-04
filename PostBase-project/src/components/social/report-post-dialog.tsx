"use client";

import { useState } from "react";
import { Flag, Loader2, MoreHorizontal, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const reasons = [
  "Spam or scam",
  "Harassment or bullying",
  "Nudity or sexual content",
  "Hate or violence",
  "False or misleading information",
  "Other",
];

export function ReportPostDialog({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setReason("");
    setDescription("");
    setSubmitted(false);
    setError(null);
  };

  const submitReport = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/posts/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, targetId: postId, reason, description }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to submit report");
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit report");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="More post options" className="h-9 w-9 shrink-0">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        {submitted ? (
          <div className="py-5 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><ShieldAlert className="h-6 w-6" /></div>
            <DialogTitle className="mt-4">Thanks for reporting this</DialogTitle>
            <DialogDescription className="mt-2">Our safety team will review the post. You can close this window now.</DialogDescription>
            <Button className="mt-5" onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report this post</DialogTitle>
              <DialogDescription>Choose the reason that best describes the problem. Reports help keep LinkMe+ safe.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              {reasons.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setReason(item)}
                  className={`flex min-h-11 w-full items-center rounded-lg border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${reason === item ? "border-brand-blue bg-brand-blue/10 font-medium text-brand-blue" : "border-surface-border text-navy-700 hover:bg-surface-light-blue"}`}
                >
                  <Flag className="mr-2 h-4 w-4 shrink-0" />
                  {item}
                </button>
              ))}
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Add details (optional)"
                maxLength={1000}
                rows={3}
                className="mt-3 w-full resize-none rounded-lg border border-surface-border bg-card p-3 text-sm text-navy-800 outline-none placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
              />
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => void submitReport()} disabled={!reason || submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit report
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
