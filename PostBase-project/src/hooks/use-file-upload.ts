"use client";

import { useState, useCallback } from "react";

interface UploadProgress {
  id: string;
  file: File;
  status: "pending" | "uploading" | "complete" | "error";
  progress?: number;
  url?: string;
  key?: string;
  error?: string;
}

interface UseFileUploadOptions {
  purpose?: "avatar" | "cover" | "cover-video" | "post" | "listing" | "document";
  onComplete?: (files: { url: string; key: string }[]) => void;
  onError?: (error: string) => void;
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { purpose = "post", onComplete } = options;
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const addFiles = useCallback(
    (files: File[]) => {
      const newUploads: UploadProgress[] = files.map((file) => ({
        id: Math.random().toString(36).substring(7),
        file,
        status: "pending",
      }));

      setUploads((prev) => [...prev, ...newUploads]);
      return newUploads.map((u) => u.id);
    },
    []
  );

  const uploadFile = useCallback(async (upload: UploadProgress): Promise<{ url: string; key: string }> => {
    // One request: the server reads the bytes, decides the type and size for
    // itself, and answers with the URL it stored. There is no second step and
    // nothing the browser says about the file is taken on trust.
    const body = new FormData();
    body.append("file", upload.file);
    body.append("purpose", purpose);

    const response = await fetch("/api/uploads", { method: "POST", body });
    const data = (await response.json().catch(() => null)) as
      | { url?: string; key?: string; error?: string }
      | null;

    if (!response.ok || !data?.url || !data.key) {
      throw new Error(data?.error || "Failed to upload file");
    }

    return { url: data.url, key: data.key };
  }, [purpose]);

  const uploadAll = useCallback(async () => {
    const pendingUploads = uploads.filter((u) => u.status === "pending");
    if (pendingUploads.length === 0) return;

    setIsUploading(true);
    const results: { url: string; key: string }[] = [];

    for (const upload of pendingUploads) {
      setUploads((prev) =>
        prev.map((u) => (u.id === upload.id ? { ...u, status: "uploading" } : u))
      );

      try {
        const result = await uploadFile(upload);
        results.push(result);

        setUploads((prev) =>
          prev.map((u) =>
            u.id === upload.id ? { ...u, status: "complete", url: result.url, key: result.key } : u
          )
        );
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === upload.id
              ? { ...u, status: "error", error: err instanceof Error ? err.message : "Upload failed" }
              : u
          )
        );
      }
    }

    setIsUploading(false);

    if (results.length > 0) {
      onComplete?.(results);
    }

    return results;
  }, [uploads, onComplete, uploadFile]);

  const removeUpload = useCallback((id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const clearUploads = useCallback(() => {
    setUploads([]);
  }, []);

  const successfulUploads = uploads.filter((u) => u.status === "complete");
  const hasPendingUploads = uploads.some((u) => u.status === "pending");
  const hasErrors = uploads.some((u) => u.status === "error");

  return {
    uploads,
    isUploading,
    addFiles,
    uploadAll,
    removeUpload,
    clearUploads,
    successfulUploads,
    hasPendingUploads,
    hasErrors,
  };
}
