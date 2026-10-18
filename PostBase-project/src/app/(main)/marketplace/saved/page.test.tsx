// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder, type StubEndpoint } from "@/test/stub-fetch";

/**
 * The saved listings page, through the flag contract it renders from.
 *
 * The rows come from the shelf read in the same shape the marketplace grid
 * reads — every row carrying `isSaved` — so a card here starts lit from the
 * row exactly as a grid card does, and the heart it wears is the same write
 * the grid's hearts make. What this page adds is the listening half: when the
 * server confirms an un-save, the row leaves the shelf — on the server's word,
 * not on the press — and the confirmation is written into the row the cards
 * are painted from, so a mounted card wears the answer the moment it lands
 * instead of waiting on a refetch to discover it. And because the shelf can
 * be deeper than one page, the read's `hasMore` decides the Load-more
 * control: it names what pressing it does, asks for the next page, appends
 * without duplicating a row, hides once the read says the shelf is exhausted,
 * and sits disabled while a page is in flight.
 */
const SAVED_PHOTO = "https://cdn.example.com/seed/listings/listing-01.jpg";

const savedListing = {
  id: "77777777-7777-4777-8777-777777777777",
  title: "Vintage camera",
  priceMin: 240,
  priceMax: 240,
  condition: "Good",
  location: "Singapore",
  categoryName: "Electronics",
  imageUrl: SAVED_PHOTO,
  isSaved: true,
};

const secondListing = {
  ...savedListing,
  id: "55555555-5555-4555-8555-555555555555",
  title: "Desk lamp",
  imageUrl: null,
};

const PAGINATION = { total: 2, page: 1, limit: 20, totalPages: 1, hasMore: false };

function shelfResponse(rows: unknown[], hasMore: boolean) {
  return { data: rows, pagination: { ...PAGINATION, total: rows.length, totalPages: hasMore ? 2 : 1, hasMore } };
}

async function mountSaved(
  endpoints: Record<string, StubEndpoint> = {},
): Promise<{ ui: MountedSurface; requests: FetchRecorder }> {
  const requests = stubFetch({
    "/api/marketplace/saved": shelfResponse([savedListing], false),
    ...endpoints,
  });
  const { default: SavedListingsPage } = await import("./page");
  const ui = mountSurface(<SavedListingsPage />, { providers: "tooltip" });
  return { ui, requests };
}

/** The control, found by the words it is named by. */
function loadMoreButton(ui: MountedSurface): HTMLButtonElement | null {
  return (
    ([...ui.container.querySelectorAll("button")].find(
      (button) =>
        (button.textContent ?? "").trim() === "Load more saved listings" ||
        (button.textContent ?? "").trim() === "Loading…",
    ) as HTMLButtonElement | undefined) ?? null
  );
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the saved listings page", () => {
  test("renders the member's saved rows with the hearts their flags light", async () => {
    const { ui } = await mountSaved();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Vintage camera") ?? false,
      { description: "the saved rows" },
    );
    // The flag contract, kept on the shelf: the row's own `isSaved` lights the
    // heart, so a saved listing loads named "Remove from saved" — the same
    // lit state the grid's saved cards wear.
    expect(ui.container.querySelector('button[aria-label="Remove from saved"]')).toBeTruthy();
    expect(ui.container.querySelector('button[aria-label="Save listing"]')).toBeNull();
  });

  test("shows the photo the shelf read resolved, and names the placeholder when there is none", async () => {
    const { ui } = await mountSaved();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Vintage camera") ?? false,
      { description: "the saved rows" },
    );
    // The shelf reads the same `imageUrl` the grid does, so a listing does not
    // lose its picture on the way from one shelf to the other.
    expect(ui.container.querySelector("img[alt='Vintage camera']")?.getAttribute("src")).toBe(
      SAVED_PHOTO,
    );
  });

  test("a confirmed un-save removes the row; the write rides the same DELETE the grid's hearts make", async () => {
    const { ui, requests } = await mountSaved({
      "/api/marketplace/saved": (request) =>
        request.method === "DELETE" ? { saved: false } : shelfResponse([savedListing], false),
    });
    await ui.waitFor(
      () => ui.container.textContent?.includes("Vintage camera") ?? false,
      { description: "the saved rows" },
    );

    const heart = ui.byName("Remove from saved");
    await ui.click(heart);

    await ui.waitFor(
      () => requests.calls.some((call) => call.method === "DELETE"),
      { description: "the un-save request" },
    );
    // The card leaves the shelf on the server's confirmation — not on the
    // press, which has already been known to be wrong.
    await ui.waitFor(
      () => !ui.container.textContent?.includes("Vintage camera"),
      { description: "the row to leave the shelf" },
    );
  });

  test("a confirmed un-save reaches the mounted heart through the rows, not only the shelf", async () => {
    // The stale-heart shape, written down: the shelf's rows are the one state
    // a mounted card reads its flag from, so a parent that filtered its list
    // on a confirmation was the only half that reached the heart. With the
    // row itself rewritten (`isSaved: false`) before it is dropped, the heart
    // has been told twice over — once by the parent's repaint, once by the
    // card's own reconciliation — and the row the shelf briefly still holds
    // can never come back reading saved.
    const { ui, requests } = await mountSaved({
      "/api/marketplace/saved": (request) =>
        request.method === "DELETE" ? { saved: false } : shelfResponse([savedListing], false),
    });
    await ui.waitFor(
      () => ui.container.textContent?.includes("Vintage camera") ?? false,
      { description: "the saved rows" },
    );

    const heart = ui.byName("Remove from saved");
    await ui.click(heart);

    await ui.waitFor(
      () => requests.calls.some((call) => call.method === "DELETE"),
      { description: "the un-save request" },
    );
    // The row leaves the shelf on the server's word — unchanged behaviour.
    await ui.waitFor(
      () => !ui.container.textContent?.includes("Vintage camera"),
      { description: "the row to leave the shelf" },
    );
    // And nothing is left behind: neither row nor heart anywhere on the shelf.
    expect(ui.container.querySelector('button[aria-label="Remove from saved"]')).toBeNull();
    expect(ui.container.querySelector('button[aria-label="Save listing"]')).toBeNull();
  });

  test("a save's `{ saved: true }` answer re-lights the row through the rows, not the press", async () => {
    // The exact shape that once stranded a heart: a row that arrives reading
    // unsaved (a stale shelf read) is saved by a press, and the confirmation
    // — `{ saved: true }` — used to live only in the card's own state. The
    // row is rewritten in the same commit now, so the repainted rows answer
    // the same truth the card holds: the heart reads lit because the row says
    // so, not because the press painted it.
    const unlitRow = { ...savedListing, isSaved: false };
    const { ui, requests } = await mountSaved({
      "/api/marketplace/saved": (request) =>
        request.method === "POST" ? { saved: true } : shelfResponse([unlitRow], false),
    });
    await ui.waitFor(
      () => ui.container.textContent?.includes("Vintage camera") ?? false,
      { description: "the saved rows" },
    );
    // The row the shelf read answered, faithfully rendered unsaved.
    expect(ui.container.querySelector('button[aria-label="Save listing"]')).toBeTruthy();

    await ui.click(ui.byName("Save listing"));
    await ui.waitFor(() => requests.calls.some((call) => call.method === "POST"), {
      description: "the save request",
    });

    // The row stayed on the shelf, and the heart it wears now reads lit —
    // carried by the repainted row, not by a state the press painted.
    expect(ui.container.textContent).toContain("Vintage camera");
    expect(ui.container.querySelector('button[aria-label="Remove from saved"]')).toBeTruthy();
    expect(ui.container.querySelector('button[aria-label="Save listing"]')).toBeNull();
  });

  test("an answer with no rows renders the empty state, not a broken grid", async () => {
    // The payload shape the stubs answer when nothing is canned (`{}`) is the
    // one a links-audit mount sees too: no `data` at all reads as no rows.
    const { ui } = await mountSaved({ "/api/marketplace/saved": {} });
    await ui.waitFor(
      () => ui.container.textContent?.includes("Nothing saved yet") ?? false,
      { description: "the empty state" },
    );
    // The way out is named: the empty state points back at the browse surface.
    expect(ui.container.textContent).toContain("Browse the marketplace");
  });
});

describe("the shelf's Load more", () => {
  test("asks for the next page, appends it, and hides once the read says the shelf is exhausted", async () => {
    // The second page repeats the first page's listing id — a save pressed
    // twice across a page boundary is still one pair, so the append dedupes
    // by id rather than rendering one listing as two hearts.
    const { ui, requests } = await mountSaved({
      "/api/marketplace/saved": (request) => {
        if (request.method !== "GET") return { saved: false };
        const pageNumber = Number(request.query.get("page") ?? "1");
        return pageNumber === 1
          ? shelfResponse([savedListing], true)
          : shelfResponse([savedListing, secondListing], false);
      },
    });
    await ui.waitFor(
      () => ui.container.textContent?.includes("Vintage camera") ?? false,
      { description: "the first page" },
    );

    const more = loadMoreButton(ui);
    expect(more, "the read said hasMore, so the control is there").toBeTruthy();
    await ui.click(more as HTMLElement);

    await ui.waitFor(
      () => requests.calls.filter((call) => call.method === "GET").length === 2,
      { description: "the second page's read" },
    );
    // The next page is asked for by number — the read's own pagination.
    const secondRead = requests.calls.filter((call) => call.method === "GET")[1];
    expect(secondRead?.query.get("page")).toBe("2");
    await ui.waitFor(
      () => ui.container.textContent?.includes("Desk lamp") ?? false,
      { description: "the appended rows" },
    );
    // The duplicate id arrived again and rendered once.
    const occurrences = (ui.container.textContent ?? "").split("Vintage camera").length - 1;
    expect(occurrences).toBe(1);
    // The read said the shelf is exhausted, so the control is gone.
    await ui.waitFor(() => loadMoreButton(ui) === null, {
      description: "the exhausted control to hide",
    });
  });

  test("no control when the read says the shelf fits on one page", async () => {
    const { ui } = await mountSaved();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Vintage camera") ?? false,
      { description: "the saved rows" },
    );
    expect(loadMoreButton(ui), "hasMore: false means nothing to load").toBeNull();
  });

  test("a page in flight disables the control until the answer lands", async () => {
    // The stub cannot hold a request open, so this one stubs the global with
    // a second page that resolves only when the test releases it — the way
    // the control behaves while a real page is on the wire.
    let calls = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answer = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        calls += 1;
        const url = String(input);
        if (url.includes("page=2")) {
          return held.then(() => answer(shelfResponse([secondListing], false)));
        }
        return Promise.resolve(answer(shelfResponse([savedListing], true)));
      }),
    );

    const { default: SavedListingsPage } = await import("./page");
    const ui = mountSurface(<SavedListingsPage />, { providers: "tooltip" });
    await ui.waitFor(
      () => ui.container.textContent?.includes("Vintage camera") ?? false,
      { description: "the first page" },
    );

    await ui.click(loadMoreButton(ui) as HTMLElement);
    await ui.waitFor(() => calls === 2, { description: "the second page's read to start" });

    // In flight: the control is disabled and renamed — a second press lands
    // on a button that is not taking presses.
    const inFlight = loadMoreButton(ui);
    expect(inFlight, "the control stays while its fetch is open").toBeTruthy();
    expect((inFlight as HTMLButtonElement).disabled).toBe(true);
    expect((inFlight as HTMLButtonElement).textContent?.trim()).toBe("Loading…");

    release?.();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Desk lamp") ?? false,
      { description: "the appended row" },
    );
    // hasMore is now false: the guard released into the state the read named.
    expect(loadMoreButton(ui)).toBeNull();
  });
});
