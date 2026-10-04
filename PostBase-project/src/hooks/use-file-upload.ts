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
    // Get presigned URL
    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: upload.file.name,
        contentType: upload.file.type,
        purpose,
        size: upload.file.size,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to get upload URL");
    }

    const { uploadUrl, key, publicUrl } = await response.json();

    // Upload to R2
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: upload.file,
      headers: { "Content-Type": upload.file.type },
    });

    if (!uploadResponse.ok) {
      throw new Error("Failed to upload file");
    }

    return { url: publicUrl, key };
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
