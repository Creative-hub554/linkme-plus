"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

/** The same rule the API enforces, so the form can say it before a round trip. */
const PAGE_USERNAME = /^[a-z0-9_]{3,30}$/;

export default function NewPage() {
  // Generated, because the form can be mounted beside another one and a written
  // id that repeats breaks `label[for]` silently.
  const ids = { name: useId(), username: useId(), description: useId() };
  const router = useRouter();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating) return;

    const trimmedName = name.trim();
    const trimmedUsername = username.trim().toLowerCase();

    if (!trimmedName) {
      setError("Give the Page a name.");
      return;
    }
    if (!PAGE_USERNAME.test(trimmedUsername)) {
      setError("The username must be 3–30 characters using only letters, numbers, or underscores.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          username: trimmedUsername,
          description: description.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not create the Page");
      router.push(`/pages/${payload.page.username}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the Page");
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <h1 className="text-xl font-bold text-navy-800">Create a Page</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A Page is a public account for a brand, a business or a community. You become its admin.
      </p>

      <Card className="mt-4">
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={ids.name}>Page name</Label>
              <Input
                id={ids.name}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Northwind Studio"
                maxLength={100}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={ids.username}>Page username</Label>
              <Input
                id={ids.username}
                value={username}
                onChange={(event) => setUsername(event.target.value.replace(/\s/g, "").toLowerCase())}
                placeholder="northwind_studio"
                maxLength={30}
                required
              />
              <p className="text-xs text-muted-foreground">
                The Page lives at /pages/{username.trim().toLowerCase() || "your-username"}.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={ids.description}>Description</Label>
              <Textarea
                id={ids.description}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this Page about?"
                maxLength={500}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Create Page
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
