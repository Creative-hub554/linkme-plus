/**
 * Publishing a post: upload any attachment, then create the post.
 *
 * The two steps are inseparable and their order matters. `POST /api/posts`
 * stores whatever media URL it is handed, so a URL that only exists in this
 * browser — a `blob:` object URL, which is what a preview uses — would be
 * persisted and then be dead for everyone, including the author after a reload.
 * So the file is stored first (`POST /api/posts/media` puts it in R2 and answers
 * with its public URL, and that URL is what the post records).
 *
 * The upload goes through our own route rather than the presigned one at
 * `/api/uploads`, because a browser PUT to the media bucket is refused: the
 * bucket returns no CORS headers, so the preflight fails and the file never
 * leaves the page.
 *
 * Kept out of the composer because the composer deliberately knows nothing
 * about the network: it hands over the text and the file and clears itself, and
 * the page decides what to do with them — including putting the text back if
 * publishing fails.
 */
import type { PostAudience } from "@/lib/post-audiences";

/** Media as the API stores it. */
export interface PublishedMedia {
  url: string;
  type: string;
  altText: string | null;
}

export interface PublishedPost {
  id: string;
  content?: string | null;
  createdAt?: string;
  visibility?: string;
  author?: {
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
}

export interface PublishPostInput {
  content: string;
  /** Attachment chosen in the composer, if any. */
  file?: File | null;
  audience?: PostAudience;
}

export interface PublishPostResult {
  post: PublishedPost;
  /** The media that was attached and recorded, with persistent URLs. */
  media: PublishedMedia[];
}

function attachmentType(file: File): string {
  return file.type.startsWith("video/") ? "video" : "image";
}

/** Uploads one attachment and returns the URL that can be persisted. */
export async function uploadPostAttachment(file: File): Promise<{ url: string; type: string }> {
  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    response = await fetch("/api/posts/media", { method: "POST", body: formData });
  } catch {
    // A dropped connection or a blocked request — unreachable rather than
    // rejected. Say so instead of showing the browser's "Failed to fetch".
    throw new Error("We couldn't reach the server to upload that file.");
  }

  const payload = response.ok ? await response.json().catch(() => null) : null;
  if (!response.ok || !payload?.url) {
    throw new Error("We couldn't upload that file.");
  }

  return { url: payload.url as string, type: (payload.type as string) || file.type };
}

/**
 * Uploads the attachment (if any) and creates the post. Throws with a message
 * meant to be shown to the author; the caller is responsible for restoring what
 * they wrote.
 */
export async function publishPost({
  content,
  file,
  audience = "public",
}: PublishPostInput): Promise<PublishPostResult> {
  const trimmed = content.trim();
  if (!trimmed && !file) {
    throw new Error("Write something, or attach a photo or video.");
  }

  const media: PublishedMedia[] = [];
  if (file) {
    const uploaded = await uploadPostAttachment(file);
    media.push({
      url: uploaded.url,
      type: uploaded.type,
      altText: attachmentType(file) === "video" ? "Post video" : "Post image",
    });
  }

  const response = await fetch("/api/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: trimmed,
      type: file ? attachmentType(file) : "text",
      visibility: audience,
      media,
    }),
  });

  const payload = response.ok ? await response.json().catch(() => null) : null;
  if (!response.ok || !payload?.post?.id) {
    throw new Error("We couldn't publish your post. Please try again.");
  }

  return { post: payload.post as PublishedPost, media };
}
