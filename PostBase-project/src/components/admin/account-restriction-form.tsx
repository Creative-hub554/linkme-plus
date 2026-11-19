"use client";
import { useState, type FormEvent } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function AccountRestrictionForm({
  userId,
  onSaved,
}: {
  userId: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await clientRequest(
        "/api/admin/users",
        jsonBody(
          {
            userId,
            action: form.get("action"),
            reason: form.get("reason"),
            days: Number(form.get("days")),
          },
          "PUT",
        ),
      );
      setMessage("Account restriction updated.");
      setOpen(false);
      onSaved?.();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Unable to update account.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((value) => !value)}
      >
        Account restrictions
      </Button>
      {message && <p role="status">{message}</p>}
      {open && (
        <form onSubmit={submit} className="space-y-2 rounded border p-3">
          <Label htmlFor={`restriction-${userId}`}>Action</Label>
          <select
            id={`restriction-${userId}`}
            name="action"
            className="w-full rounded border bg-background p-2"
          >
            <option value="suspend">Suspend temporarily</option>
            <option value="ban">Ban account</option>
            <option value="restore">Restore access</option>
          </select>
          <Label htmlFor={`days-${userId}`}>Suspension days</Label>
          <Input
            id={`days-${userId}`}
            name="days"
            type="number"
            min="1"
            max="365"
            defaultValue="7"
          />
          <Label htmlFor={`reason-${userId}`}>Reason</Label>
          <Input
            id={`reason-${userId}`}
            name="reason"
            required
            maxLength={2000}
          />
          <p className="text-xs text-muted-foreground">
            Bans last until an administrator restores access. Saving takes
            effect on the member’s next request.
          </p>
          <Button type="submit" disabled={busy}>
            Save account decision
          </Button>
        </form>
      )}
    </div>
  );
}
