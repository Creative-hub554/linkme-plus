// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { ProfileQrCard } from "@/components/profile/profile-qr-card";

/**
 * The card's job is to hand out one link in whatever way the reader's browser
 * allows — the Web Share API when it exists, the clipboard when it does not —
 * and to surface the QR itself only when something asks for it. Each of those
 * routes is a different promise to the reader, so each gets driven here rather
 * than asserted from the idle markup.
 */

const urlFor = (username: string) =>
  `${window.location.origin}/profile?username=${encodeURIComponent(username)}`;

function stubClipboard() {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function buttonReading(container: ParentNode, text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes(text),
  );
  if (!element) throw new Error(`no button reading "${text}" was rendered`);
  return element as HTMLButtonElement;
}

afterEach(() => {
  cleanupSurfaces();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  delete (navigator as { share?: unknown }).share;
});

describe("the card at rest", () => {
  test("shows the profile link it is about to share", () => {
    const markup = renderToStaticMarkup(
      <ProfileQrCard name="Ada Lovelace" username="ada.lovelace" />,
    );
    expect(markup).toContain(urlFor("ada.lovelace"));
    // React re-escapes the apostrophe in the source as `&#x27;`.
    expect(markup).toContain("open Ada Lovelace&#x27;s QR code");
    expect(markup).toContain("Share");
    expect(markup).toContain("Copy link");
    expect(markup).toContain("Download");
    // Nothing asked for the code yet — the overlay is the response to a
    // signal, not part of the resting card.
    expect(markup).not.toContain('id="linkme-profile-qr"');
  });

  test("encodes the username into the link rather than pasting it raw", () => {
    const markup = renderToStaticMarkup(
      <ProfileQrCard name="Ada" username="ada lovelace/?" />,
    );
    expect(markup).toContain("username=ada%20lovelace%2F%3F");
  });
});

describe("the QR overlay", () => {
  test("opens when a signal arrives, carrying a QR for the profile link", async () => {
    const ui = mountSurface(
      <ProfileQrCard name="Ada Lovelace" username="ada" openSignal={1} />,
      { providers: "none" },
    );
    await ui.waitFor(() => ui.container.querySelector('[role="dialog"]') !== null);

    const dialog = ui.container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("Ada Lovelace's profile QR code");
    const svg = ui.container.querySelector("#linkme-profile-qr");
    expect(svg).not.toBeNull();
    // qrcode.react renders the title as a `<title>` child of the svg, which is
    // what a screen reader announces — not a `title` attribute on the element.
    expect(svg?.querySelector("title")?.textContent).toBe(
      "QR code for Ada Lovelace's LinkMe+ profile",
    );
    expect(ui.container.textContent).toContain("Scan to connect with Ada Lovelace");
  });

  test("closes from its own Close button", async () => {
    const ui = mountSurface(
      <ProfileQrCard name="Ada" username="ada" openSignal={1} />,
      { providers: "none" },
    );
    await ui.waitFor(() => ui.container.querySelector("#linkme-profile-qr") !== null);

    await ui.click(buttonReading(ui.container, "Close"));
    expect(ui.container.querySelector("#linkme-profile-qr")).toBeNull();
  });

  test("closes when the backdrop is clicked, but not from a click inside the panel", async () => {
    const ui = mountSurface(
      <ProfileQrCard name="Ada" username="ada" openSignal={1} />,
      { providers: "none" },
    );
    await ui.waitFor(() => ui.container.querySelector("#linkme-profile-qr") !== null);

    // A click that lands in the panel must not count as "elsewhere" —
    // it is where the reader's pointer ends up while reading the code.
    const panel = ui.container.querySelector('[role="dialog"] > div');
    if (!panel) throw new Error("the overlay rendered no panel");
    await ui.click(panel as HTMLElement);
    expect(ui.container.querySelector("#linkme-profile-qr")).not.toBeNull();

    const overlay = ui.container.querySelector('[role="dialog"]');
    await ui.click(overlay as HTMLElement);
    expect(ui.container.querySelector("#linkme-profile-qr")).toBeNull();
  });
});

describe("sharing the link", () => {
  test("copies it when the browser offers no share API, and says so", async () => {
    const writeText = stubClipboard();
    const ui = mountSurface(<ProfileQrCard name="Ada" username="ada" />, {
      providers: "none",
    });

    // The copy button is the one that reports the outcome: after the share
    // fallback it reads "Copied", which no longer matches a "Copy" lookup.
    const copyButton = buttonReading(ui.container, "Copy link");
    await ui.click(buttonReading(ui.container, "Share"));
    await ui.waitFor(() => (copyButton.textContent ?? "").includes("Copied"));

    expect(writeText).toHaveBeenCalledWith(urlFor("ada"));
    expect(copyButton.textContent).toContain("Copied");
  });

  test("uses the share sheet when the browser has one, leaving the clipboard alone", async () => {
    const writeText = stubClipboard();
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    const ui = mountSurface(<ProfileQrCard name="Ada" username="ada" />, {
      providers: "none",
    });
    await ui.click(buttonReading(ui.container, "Share"));
    await ui.waitFor(() => share.mock.calls.length > 0);

    expect(share).toHaveBeenCalledWith({
      title: "Ada on LinkMe+",
      text: "Connect with Ada on LinkMe+",
      url: urlFor("ada"),
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  test("copies straight from the Copy link button", async () => {
    const writeText = stubClipboard();
    const ui = mountSurface(<ProfileQrCard name="Ada" username="ada.ada" />, {
      providers: "none",
    });

    const copyButton = buttonReading(ui.container, "Copy link");
    await ui.click(copyButton);
    await ui.waitFor(() => (copyButton.textContent ?? "").includes("Copied"));

    expect(writeText).toHaveBeenCalledWith(urlFor("ada.ada"));
    expect(copyButton.textContent).toContain("Copied");
  });
});

describe("downloading the code", () => {
  test("serializes the rendered SVG and names the file for the member", async () => {
    stubClipboard();
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:profile-qr"),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    let downloaded: { download?: string } | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function click(this: HTMLAnchorElement) {
        downloaded = { download: this.download };
      });

    const ui = mountSurface(
      <ProfileQrCard name="Ada" username="ada" openSignal={1} />,
      { providers: "none" },
    );
    await ui.waitFor(() => ui.container.querySelector("#linkme-profile-qr") !== null);

    await ui.click(buttonReading(ui.container, "Download"));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/svg+xml;charset=utf-8");
    expect(downloaded).toEqual({ download: "ada-linkme-qr.svg" });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:profile-qr");
  });
});
