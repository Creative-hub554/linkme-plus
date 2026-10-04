"use client";

import { useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, Upload } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

interface ProfileAvatarUploadProps {
  name: string;
  avatarUrl?: string | null;
  onUploaded?: (avatarUrl: string) => void;
}

export function ProfileAvatarUpload({ name, avatarUrl, onUploaded }: ProfileAvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const choosePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Profile photos must be 10 MB or smaller.");
      return;
    }

    setError(null);
    setNotice(null);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    void uploadPhoto(file, objectUrl);
  };

  const uploadPhoto = async (file: File, objectUrl: string) => {
    setSaving(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body, credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) throw new Error("Your session expired. Please sign in again and retry.");
        if (response.status === 503) throw new Error(payload.error || "Photo storage is temporarily unavailable. Please try again.");
        throw new Error(payload.error || "Unable to save profile photo");
      }
      if (typeof payload.avatarUrl !== "string" || !payload.avatarUrl) throw new Error("Upload completed without a photo URL");
      onUploaded?.(payload.avatarUrl);
      // Refresh the client session so the shared top navigation immediately
      // receives the new Auth metadata avatar without a full page reload.
      try {
        await createClient().auth.refreshSession();
      } catch {
        // The uploaded URL is already persisted; a later page refresh can
        // reload the session if the refresh request is temporarily unavailable.
      }
      setPreview(payload.avatarUrl);
      setNotice("Profile photo updated.");
    } catch (uploadError) {
      setPreview(null);
      setError(uploadError instanceof Error ? uploadError.message : "Unable to save profile photo");
    } finally {
      URL.revokeObjectURL(objectUrl);
      setSaving(false);
    }
  };

  const displayedUrl = preview || avatarUrl || undefined;
  const initials = name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U";

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div className="relative">
        <Avatar className="h-24 w-24 border-4 border-white shadow-lg sm:h-28 sm:w-28">
          <AvatarImage src={displayedUrl} alt={`${name} profile photo`} />
          <AvatarFallback className="bg-brand-blue/10 text-2xl font-bold text-brand-blue">{initials}</AvatarFallback>
        </Avatar>
        {saving && <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      </div>
      <div className="space-y-2 text-center sm:text-left">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={choosePhoto} />
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {saving ? "Uploading..." : "Upload profile photo"}
        </Button>
        <p className="text-xs text-muted-foreground">JPG, PNG, GIF, or WebP · maximum 10 MB</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}
      </div>
    </div>
  );
}
