"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, X, Image, FileText, Video } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadFile {
  id: string;
  file: File;
  preview?: string;
  status: "pending" | "uploading" | "complete" | "error";
  progress?: number;
  url?: string;
  key?: string;
  error?: string;
}

interface FileUploadProps {
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  purpose?: "avatar" | "cover" | "cover-video" | "post" | "listing" | "document";
  onUploadComplete?: (files: { url: string; key: string }[]) => void;
  onUploadError?: (error: string) => void;
  className?: string;
}

export function FileUpload({
  accept = "image/*,video/*,.pdf",
  multiple = false,
  maxFiles = 10,
  purpose = "post",
  onUploadComplete,
  onUploadError,
  className,
}: FileUploadProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const fileArray = Array.from(newFiles);
      const remainingSlots = maxFiles - files.length;

      if (fileArray.length > remainingSlots) {
        onUploadError?.(`Can only upload ${remainingSlots} more files`);
        return;
      }

      const uploadFiles: UploadFile[] = fileArray.map((file) => ({
        id: Math.random().toString(36).substring(7),
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        status: "pending",
      }));

      setFiles((prev) => [...prev, ...uploadFiles]);
    },
    [files.length, maxFiles, onUploadError]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  const uploadFile = async (uploadFile: UploadFile): Promise<{ url: string; key: string }> => {
    // Step 1: Get presigned URL
    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: uploadFile.file.name,
        contentType: uploadFile.file.type,
        purpose,
        size: uploadFile.file.size,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to get upload URL");
    }

    const { uploadUrl, key, publicUrl } = await response.json();

    // Step 2: Upload to R2
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: uploadFile.file,
      headers: {
        "Content-Type": uploadFile.file.type,
      },
    });

    if (!uploadResponse.ok) {
      throw new Error("Failed to upload file");
    }

    return { url: publicUrl, key };
  };

  const uploadAll = async () => {
    const pendingFiles = files.filter((f) => f.status === "pending");
    const results: { url: string; key: string }[] = [];

    for (const file of pendingFiles) {
      // Update status to uploading
      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, status: "uploading" } : f))
      );

      try {
        const result = await uploadFile(file);
        results.push(result);

        // Update status to complete
        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id ? { ...f, status: "complete", url: result.url, key: result.key } : f
          )
        );
      } catch (err) {
        // Update status to error
        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id
              ? { ...f, status: "error", error: err instanceof Error ? err.message : "Upload failed" }
              : f
          )
        );
      }
    }

    if (results.length > 0) {
      onUploadComplete?.(results);
    }
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return Image;
    if (type.startsWith("video/")) return Video;
    return FileText;
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
          dragActive
            ? "border-brand-blue bg-brand-blue/5"
            : "border-surface-border hover:border-brand-blue/50"
        )}
      >
        <Upload className="h-10 w-10 text-muted-foreground mb-4" />
        <p className="text-sm font-medium">Click to upload or drag and drop</p>
        <p className="text-xs text-muted-foreground mt-1">
          {purpose === "avatar" && "JPG, PNG, WebP. Max 10MB. Square recommended."}
          {purpose === "cover" && "JPG, PNG, WebP. Max 10MB. 1200x480 recommended."}
          {purpose === "cover-video" && "MP4, WebM. Max 100MB. 6-10 seconds."}
          {purpose === "post" && "JPG, PNG, GIF, WebP, MP4, WebM. Max 10MB images, 100MB video."}
          {purpose === "listing" && "JPG, PNG, WebP. Max 10MB. Up to 10 images."}
          {purpose === "document" && "PDF. Max 20MB."}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => {
            const Icon = getFileIcon(file.file.type);
            return (
              <Card key={file.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  {file.preview ? (
                    <img
                      src={file.preview}
                      alt={file.file.name}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
                      <Icon className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    {file.status === "uploading" && (
                      <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-brand-blue animate-pulse" style={{ width: "60%" }} />
                      </div>
                    )}
                    {file.status === "error" && (
                      <p className="text-xs text-red-500 mt-1">{file.error}</p>
                    )}
                    {file.status === "complete" && (
                      <p className="text-xs text-green-600 mt-1">Uploaded</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(file.id)}
                    disabled={file.status === "uploading"}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}

          {/* Upload Button */}
          {files.some((f) => f.status === "pending") && (
            <Button onClick={uploadAll} className="w-full">
              <Upload className="h-4 w-4 mr-2" />
              Upload {files.filter((f) => f.status === "pending").length} file(s)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
