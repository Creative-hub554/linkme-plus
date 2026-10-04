// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { FileUpload } from "@/components/ui/file-upload";

/**
 * The upload widget, driven as a reader drives it.
 *
 * Two subjects that fail differently. The *choosing* half — a click, a drop, the
 * slot limit, removing a row — is markup and state, and it is checked by what
 * the list shows. The *uploading* half talks to two endpoints in sequence (a
 * presigned URL, then the object store itself), so it is checked by what the
 * widget says when each step succeeds, answers non-`2xx`, or says something in
 * its body.
 *
 * `URL.createObjectURL` does not exist in jsdom: a real object URL is a handle
 * to bytes a browser holds, and the only thing the widget does with it is set it
 * as an `src` and later revoke it, so both are stubbed to record what they were
 * handed.
 */
function file(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** The drop zone is the only dashed area, so it is found by that class. */
function dropZone(ui: MountedSurface): HTMLElement {
  const zone = ui.container.querySelector('[class*="border-dashed"]');
  if (!zone) throw new Error("the widget rendered no drop zone");
  return zone as HTMLElement;
}

/** The upload button, by the label it carries for a given number of files. */
function uploadButton(ui: MountedSurface): HTMLElement {
  const button = [...ui.container.querySelectorAll("button")].find((candidate) =>
    (candidate.textContent ?? "").includes("Upload "),
  );
  if (!button) throw new Error("the widget rendered no upload button");
  return button as HTMLElement;
}

/** The first row's remove control: the icon-only button, which carries no text. */
function removeButton(ui: MountedSurface): HTMLElement {
  const button = [...ui.container.querySelectorAll("button")].find(
    (candidate) => !(candidate.textContent ?? "").includes("Upload"),
  );
  if (!button) throw new Error("the widget rendered no remove control");
  return button as HTMLElement;
}

/**
 * A drag event with a `dataTransfer`.
 *
 * jsdom has no `DragEvent`, and the widget only reads `type` plus
 * `dataTransfer.files`, so a plain bubbling `Event` carrying the fields the
 * handler reads is what a real drag delivers here.
 */
async function drag(zone: HTMLElement, type: string, files: File[] = []) {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files } });
    zone.dispatchEvent(event);
  });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createObjectURL = vi.fn(() => "blob:preview-1");
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

describe("FileUpload", () => {
  test("explains what each purpose accepts", () => {
    const hints: Array<[Parameters<typeof FileUpload>[0]["purpose"], string]> = [
      ["avatar", "Square recommended"],
      ["cover", "1200x480 recommended"],
      ["cover-video", "6-10 seconds"],
      ["post", "Max 10MB images"],
      ["listing", "Up to 10 images"],
      ["document", "PDF. Max 20MB"],
    ];
    for (const [purpose, hint] of hints) {
      const ui = mountSurface(<FileUpload purpose={purpose} />, { providers: "none" });
      expect(ui.container.textContent, `the ${purpose} hint`).toContain(hint);
      ui.unmount();
    }
  });

  test("lists a chosen image with a preview and counts it for upload", async () => {
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    await ui.chooseFiles(input, [file("photo.png", "image/png")]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const preview = ui.container.querySelector("img");
    expect(preview?.getAttribute("src")).toBe("blob:preview-1");
    expect(ui.container.textContent).toContain("photo.png");
    expect(ui.container.textContent).toContain("Upload 1 file(s)");
  });

  test("draws a type icon rather than a preview for a non-image", async () => {
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    await ui.chooseFiles(input, [file("clip.mp4", "video/mp4"), file("brief.pdf", "application/pdf")]);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(ui.container.querySelector("img")).toBeNull();
    expect(ui.container.textContent).toContain("clip.mp4");
    expect(ui.container.textContent).toContain("brief.pdf");
  });

  test("refuses more files than the remaining slots allow", async () => {
    const onUploadError = vi.fn();
    const ui = mountSurface(<FileUpload maxFiles={1} onUploadError={onUploadError} />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    await ui.chooseFiles(input, [file("a.png", "image/png"), file("b.png", "image/png")]);
    expect(onUploadError).toHaveBeenCalledWith("Can only upload 1 more files");
    expect(ui.container.textContent).not.toContain("a.png");
  });

  test("opens the file picker from the drop zone", async () => {
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await ui.click(dropZone(ui));
    expect(click).toHaveBeenCalledTimes(1);
  });

  test("accepts a drop and highlights while a drag is over", async () => {
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    const zone = dropZone(ui);

    await drag(zone, "dragenter");
    expect(zone.className).toContain("border-brand-blue");

    await drag(zone, "dragover");
    expect(zone.className).toContain("border-brand-blue");

    await drag(zone, "dragleave");
    expect(zone.className).toContain("border-surface-border");

    await drag(zone, "drop", [file("dropped.png", "image/png")]);
    expect(ui.container.textContent).toContain("dropped.png");
  });

  test("ignores a drop that carries no files", async () => {
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    await drag(dropZone(ui), "drop", []);
    expect(ui.container.textContent).not.toContain("Upload ");
  });

  test("removes a row and revokes its preview", async () => {
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    await ui.chooseFiles(input, [file("photo.png", "image/png")]);
    await ui.click(removeButton(ui));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(ui.container.textContent).not.toContain("photo.png");
  });

  test("uploads through both steps and reports the completed file", async () => {
    const completed = vi.fn();
    const put = vi.fn(async () => new Response("", { status: 200 }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/uploads")) {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({ uploadUrl: "https://r2.example/put/1", key: "key-1", publicUrl: "https://cdn.example/1.png" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return put();
    });
    vi.stubGlobal("fetch", fetchMock);

    const ui = mountSurface(<FileUpload onUploadComplete={completed} />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    await ui.chooseFiles(input, [file("photo.png", "image/png")]);
    await ui.click(uploadButton(ui));

    await ui.waitFor(() => ui.container.textContent?.includes("Uploaded") ?? false, {
      description: "the row to report the upload finished",
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith([{ url: "https://cdn.example/1.png", key: "key-1" }]);
  });

  test("shows the server's reason when the presigned step is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Storage is full" }), { status: 500 })),
    );
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    await ui.chooseFiles(input, [file("photo.png", "image/png")]);
    await ui.click(uploadButton(ui));
    await ui.waitFor(() => ui.container.textContent?.includes("Storage is full") ?? false, {
      description: "the error to be shown",
    });
  });

  test("falls back to a generic message when a refusal names no reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 502 })),
    );
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    await ui.chooseFiles(input, [file("photo.png", "image/png")]);
    await ui.click(uploadButton(ui));
    await ui.waitFor(() => ui.container.textContent?.includes("Failed to get upload URL") ?? false, {
      description: "the fallback error to be shown",
    });
  });

  test("reports a failed object-store step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/uploads")) {
          return new Response(
            JSON.stringify({ uploadUrl: "https://r2.example/put/1", key: "key-1", publicUrl: "https://cdn.example/1.png" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("", { status: 403 });
      }),
    );
    const ui = mountSurface(<FileUpload />, { providers: "none" });
    const input = ui.container.querySelector("input[type=file]") as HTMLInputElement;
    await ui.chooseFiles(input, [file("photo.png", "image/png")]);
    await ui.click(uploadButton(ui));
    await ui.waitFor(() => ui.container.textContent?.includes("Failed to upload file") ?? false, {
      description: "the upload failure to be shown",
    });
  });
});
