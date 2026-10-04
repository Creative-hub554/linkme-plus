"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The fields the Page's own view can change. */
export interface PageEdit {
  name?: string;
  description?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
}

interface PageEditDialogProps {
  pageId: string;
  /** The Page as it currently reads; the form starts from this every time. */
  name: string;
  description: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A change the server has already stored — the saved text, or a photo the
   * upload route wrote on its own. Reported as it happens rather than batched,
   * because these are two different writes and neither waits for the other.
   */
  onSaved: (patch: PageEdit) => void;
}

/**
 * One image, with its own preview and its own file input.
 *
 * The input is hidden and the button drives it, which is what every upload in
 * this app does. The visible label is a plain line of text rather than a
 * `<label for>`, because the control it would name is the one nobody can focus:
 * what a reader reaches is the button, and its own words ("Change Page photo")
 * are what name it.
 */
function PageImageRow({
  label,
  hint,
  url,
  previewClassName,
  busy,
  disabled,
  onFile,
}: {
  label: string;
  hint: string;
  url: string | null;
  /** How the preview is framed: a Page's photo is square, its cover is wide. */
  previewClassName: string;
  busy: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium leading-none">{label}</p>
      <div className="flex items-center gap-3">
        <div className={`shrink-0 overflow-hidden rounded-lg bg-surface-light-blue ${previewClassName}`}>
          {url ? (
            // Decorative: the hint beside the button is what says whether the
            // Page has a photo.
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0 space-y-1">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice in a row still fires.
              event.target.value = "";
              if (file) onFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => input.current?.click()}
            disabled={disabled || busy}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            {busy ? "Uploading…" : `Change ${label.toLowerCase()}`}
          </Button>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Edits a Page from the Page itself.
 *
 * The name and the description are one write (`PUT /api/pages`, which accepts
 * exactly these fields); the photo and the cover are one each, because an image
 * is uploaded rather than described and the upload route stores the url as soon
 * as the file arrives — so those change on screen immediately, the way a
 * member's own photo does, rather than waiting for Save. The error line says
 * which of the writes failed, and the notice says which succeeded.
 *
 * The username is deliberately not here. It is the Page's address (`/pages/…`),
 * so changing it is a redirect question rather than a field in a form — and
 * every post and follow row points at the Page by id, not by name.
 */
export function PageEditDialog({
  pageId,
  name: currentName,
  description: currentDescription,
  avatarUrl: currentAvatarUrl,
  coverUrl: currentCoverUrl,
  open,
  onOpenChange,
  onSaved,
}: PageEditDialogProps) {
  // Generated, because these ids live in the same document as the rest of the
  // app and a written one that repeats breaks `label[for]` silently.
  const ids = { name: useId(), description: useId() };

  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription ?? "");
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [coverUrl, setCoverUrl] = useState(currentCoverUrl);
  const [saving, setSaving] = useState(false);
  /** Which image is mid-upload, so only its own row says it is busy. */
  const [uploading, setUploading] = useState<"avatar" | "cover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Seeded when the dialog *opens*, and deliberately not on every change of
   * what it was seeded from.
   *
   * Both halves of that are load-bearing. Seeding on mount would be wrong
   * because the Page stays on screen behind this dialog and a reopened one must
   * not show what the Page used to be — the card is not remounted between
   * edits. Seeding on every render is worse: an uploaded photo is reported back
   * to the view as it is stored, which changes `currentAvatarUrl` under this
   * form, so a form that reseeded then would wipe the notice that said the photo
   * had been saved **and** any name or description typed but not yet saved. That
   * is not hypothetical — it is what the live check caught.
   */
  const wasOpen = useRef(open);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setName(currentName);
    setDescription(currentDescription ?? "");
    setAvatarUrl(currentAvatarUrl);
    setCoverUrl(currentCoverUrl);
    setError(null);
    setNotice(null);
  }, [open, currentName, currentDescription, currentAvatarUrl, currentCoverUrl]);

  const trimmedName = name.trim();
  const busy = saving || uploading !== null;

  const upload = async (kind: "avatar" | "cover", file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    setError(null);
    setNotice(null);
    setUploading(kind);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("pageId", pageId);
      body.append("kind", kind);
      const response = await fetch("/api/pages/image", { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "We couldn't save that image.");
      }
      if (typeof payload?.url !== "string" || !payload.url) {
        throw new Error("The upload finished without an image url.");
      }

      // The server has it, so the Page is told now: there is nothing left for
      // Save to do about an image, and pretending otherwise would let somebody
      // close the dialog believing their choice had been discarded.
      if (kind === "avatar") {
        setAvatarUrl(payload.url);
        onSaved({ avatarUrl: payload.url });
        setNotice("Page photo updated.");
      } else {
        setCoverUrl(payload.url);
        onSaved({ coverUrl: payload.url });
        setNotice("Cover photo updated.");
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "We couldn't save that image.");
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!trimmedName || busy) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // An empty description is `null`, not `""`: the two read the same, and
        // one of them leaves a blank line on the Page for good.
        body: JSON.stringify({
          id: pageId,
          name: trimmedName,
          description: description.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "We couldn't save your changes.");

      const saved = payload?.page;
      onSaved({
        name: typeof saved?.name === "string" ? saved.name : trimmedName,
        description: typeof saved?.description === "string" ? saved.description : null,
      });
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't save your changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Held shut while a write is in flight: two clicks would otherwise fire
        // two saves off one form.
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {currentName}</DialogTitle>
          <DialogDescription>
            Change the name, the description and the photos everybody sees. The Page&apos;s address
            and its posts stay as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={ids.name}>Page name</Label>
            <Input
              id={ids.name}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Northwind Studio"
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={ids.description}>Description</Label>
            <Textarea
              id={ids.description}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this Page about?"
              maxLength={500}
              rows={3}
            />
          </div>

          <PageImageRow
            label="Page photo"
            hint={avatarUrl ? "This is the Page's current photo." : "No photo yet."}
            url={avatarUrl}
            previewClassName="h-16 w-16"
            busy={uploading === "avatar"}
            disabled={busy}
            onFile={(file) => void upload("avatar", file)}
          />

          <PageImageRow
            label="Cover photo"
            hint={coverUrl ? "This is the Page's current cover." : "No cover yet."}
            url={coverUrl}
            previewClassName="h-16 w-28"
            busy={uploading === "cover"}
            disabled={busy}
            onFile={(file) => void upload("cover", file)}
          />

          <p className="text-xs text-muted-foreground">
            JPG, PNG, GIF or WebP. A photo or cover is saved as soon as it is chosen.
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          )}
          {notice && (
            <p role="status" aria-live="polite" className="text-sm text-emerald-600">
              {notice}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!trimmedName || busy}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
