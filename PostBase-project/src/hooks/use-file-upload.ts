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
    // One step: the bytes ride the same request that declares them, stored by
    // the server through the app's storage binding. The old two-step contract
    // (presigned URL, then a browser PUT) could never run in a browser — the
    // bucket sends no CORS headers — and its signing needed S3 credentials the
    // platform binding has replaced.
    const formData = new FormData();
    formData.append("file", upload.file);
    formData.append("purpose", purpose);

    const response = await fetch("/api/uploads", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      // A refusal may carry no body at all, and reading one as JSON would throw
      // its own cryptic error over the fallback message — parse defensively.
      const message = await response
        .text()
        .then((text) => {
          try {
            return JSON.parse(text).error;
          } catch {
            return undefined;
          }
        })
        .catch(() => undefined);
      throw new Error(message || "Failed to upload file");
    }

    const { url, key } = await response.json();

    return { url, key };
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
