"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Ban, Loader2 } from "lucide-react";

interface BlockButtonProps {
  userId: string;
  subjectName: string;
  initialBlocked?: boolean;
  onChange?: (blocked: boolean, counts?: { followers: number; following: number }) => void;
}

/** Block or unblock the member whose profile is open. */
export function BlockButton({ userId, subjectName, initialBlocked = false, onChange }: BlockButtonProps) {
  const [blocked, setBlocked] = useState(initialBlocked);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBlocked(initialBlocked);
  }, [initialBlocked, userId]);

  const updateBlock = async (next: boolean) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/users/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok || payload?.blocked !== next) throw new Error("Block request failed");
      setBlocked(next);
      setConfirmOpen(false);
      onChange?.(
        next,
        typeof payload.followers === "number" && typeof payload.following === "number"
          ? { followers: payload.followers, following: payload.following }
          : undefined,
      );
    } catch {
      setError("We couldn't update that block. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={blocked ? "outline" : "ghost"}
        size="sm"
        onClick={() => {
          setError(null);
          if (blocked) void updateBlock(false);
          else setConfirmOpen(true);
        }}
        disabled={pending}
        aria-busy={pending}
        aria-label={`${blocked ? "Unblock" : "Block"} ${subjectName}`}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
        {blocked ? "Unblock" : "Block"}
      </Button>
      {error && !confirmOpen && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}
      <span role="status" aria-live="polite" className="sr-only">{error ?? ""}</span>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Block {subjectName}?</DialogTitle>
            <DialogDescription>
              Blocking removes your follow connections both ways and prevents further follows or messages. Existing follows will not be restored if you unblock later.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void updateBlock(true)} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Block {subjectName}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
