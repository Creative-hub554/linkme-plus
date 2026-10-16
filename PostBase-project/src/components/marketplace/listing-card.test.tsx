// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { stubFetch, type StubEndpoint } from "@/test/stub-fetch";
import { ListingCard } from "./listing-card";

/**
 * The card's category badge, and the honesty of what it wears.
 *
 * The category arrives from the API as a *name* — the route left-joins
 * `categories` for it — but the card is the last line of defence: whatever a
 * caller hands it is what the badge renders, so a raw `categoryId` reaching a
 * prop would print a database key to the reader. A uuid-shaped category is
 * suppressed outright, and an absent one renders no badge at all — both are
 * quieter than a key pretending to be a word.
 */
const CARD = {
  id: "listing-1",
  title: "Vintage camera",
  price: 240,
  seller: { name: "Maya Chen" },
};

function badgeText(ui: string): string {
  // The outline badge wraps the category; its text is whatever was handed to
  // the prop, so a whole-markup read keeps the assertion off React's class
  // order and on the words the reader sees.
  const match = ui.match(/<div[^>]*class="[^\"]*outline[^\"]*"[^>]*>([^<]*)</);
  return match?.[1] ?? "";
}

describe("ListingCard's category badge", () => {
  test("renders the category name it is handed", () => {
    const html = renderToStaticMarkup(<ListingCard {...CARD} category="Electronics" />);
    expect(badgeText(html)).toBe("Electronics");
  });

  test("never renders a category id, however it arrives", () => {
    const html = renderToStaticMarkup(
      <ListingCard
        {...CARD}
        category="90000000-0000-4000-8000-000000000001"
      />,
    );
    expect(badgeText(html)).toBe("");
    expect(html).not.toContain("90000000");
  });

  test("renders no badge at all when no category name exists", () => {
    const html = renderToStaticMarkup(<ListingCard {...CARD} />);
    expect(badgeText(html)).toBe("");
    expect(html).not.toContain("90000000");
  });
});

/**
 * The heart's persistence, through the saved-listings route.
 *
 * A press is a write, not a wish: the card flips first (a press that waits on
 * the network reads as a dead control) and then takes the server's answer —
 * `{ saved }` — as what the state *is*. What each case pins: the save rides a
 * `POST` carrying the listing's id, the un-save a `DELETE` naming it in the
 * query, a refused write rolls the heart back to where the press found it, a
 * second press while one is in flight is dropped (two racing toggles can pair
 * and unpair in the wrong order), and the guard releases once the answer
 * lands, so the heart can be toggled back.
 */
const SAVED_LISTING_ID = "66666666-6666-4666-8666-666666666666";

function mountCard(
  endpoints: Record<string, StubEndpoint>,
  liked = false,
  onSavedChange?: (saved: boolean) => void,
) {
  const requests = stubFetch(endpoints);
  const ui = mountSurface(
    <ListingCard
      id={SAVED_LISTING_ID}
      title="Vintage camera"
      price={240}
      seller={{ name: "Maya Chen" }}
      liked={liked}
      onSavedChange={onSavedChange}
    />,
  );
  return { ui, requests };
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

describe("the heart's saved toggle", () => {
  test("saves with a POST carrying the listing's id, and holds the pressed state", async () => {
    const { ui, requests } = mountCard({
      "/api/marketplace/saved": (request) =>
        request.method === "POST"
          ? { saved: true, listingId: request.body?.listingId }
          : { saved: false },
    });

    await ui.click(ui.byName("Save listing"));

    await ui.waitFor(() => requests.calls.some((call) => call.method === "POST"), {
      description: "the save request",
    });
    const save = requests.calls.find((call) => call.method === "POST");
    expect(save?.pathname).toBe("/api/marketplace/saved");
    expect(save?.body).toEqual({ listingId: SAVED_LISTING_ID });
    // The server confirmed the press, so the filled state stands.
    expect(ui.container.querySelector('button[aria-label="Remove from saved"]')).toBeTruthy();
  });

  test("un-saves with a DELETE naming the listing in the query", async () => {
    const { ui, requests } = mountCard(
      {
        "/api/marketplace/saved": (request) => ({ saved: request.method !== "DELETE" }),
      },
      true,
    );

    await ui.click(ui.byName("Remove from saved"));

    await ui.waitFor(() => requests.calls.some((call) => call.method === "DELETE"), {
      description: "the un-save request",
    });
    const unsave = requests.calls.find((call) => call.method === "DELETE");
    expect(unsave?.pathname).toBe("/api/marketplace/saved");
    expect(unsave?.query.get("listingId")).toBe(SAVED_LISTING_ID);
    // Un-saving carries no body: the query is the whole request.
    expect(unsave?.body).toBeUndefined();
    expect(ui.container.querySelector('button[aria-label="Save listing"]')).toBeTruthy();
  });

  test("rolls the heart back when the save is refused", async () => {
    const { ui } = mountCard({
      "/api/marketplace/saved": () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    });

    await ui.click(ui.byName("Save listing"));

    // The press lit the heart optimistically; the refusal un-lights it. A
    // press whose write did not happen must not leave the state claiming it
    // did.
    await ui.waitFor(
      () =>
        ui.container.querySelector('button[aria-label="Save listing"]') !== null &&
        ui.container.querySelector('button[aria-label="Remove from saved"]') === null,
      { description: "the heart to roll back" },
    );
  });

  test("takes the server's word over the press's guess", async () => {
    // A 200 whose answer disagrees with the press is not a failure — it is
    // the server's truth, and the card reconciles to it rather than keeping
    // its optimistic flip.
    const { ui, requests } = mountCard({
      "/api/marketplace/saved": () => ({ saved: false }),
    });

    await ui.click(ui.byName("Save listing"));

    await ui.waitFor(() => requests.calls.length === 1, { description: "the save request" });
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Save listing"]') !== null,
      { description: "the heart to settle on the server's answer" },
    );
  });

  test("drops a second press while the first is in flight", async () => {
    // A request that never answers holds the guard shut: the press after it
    // reaches no fetch, because two racing toggles can pair and unpair in the
    // wrong order — and an unanswered first press means nobody knows which
    // order the server saw. Stubby fetch cannot hold a request open (every
    // handler is answered as soon as it returns), so this one stubs the
    // global with a request that never resolves.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return new Promise<Response>(() => {});
      }),
    );

    const ui = mountSurface(
      <ListingCard
        id={SAVED_LISTING_ID}
        title="Vintage camera"
        price={240}
        seller={{ name: "Maya Chen" }}
      />,
    );

    await ui.click(ui.byName("Save listing"));
    await ui.waitFor(() => calls === 1, { description: "the first save request" });

    const filled = ui.container.querySelector<HTMLElement>('button[aria-label="Remove from saved"]');
    expect(filled, "the press lit the heart optimistically").toBeTruthy();
    await ui.click(filled as HTMLElement);

    expect(calls).toBe(1);
  });

  test("a press after the answer toggles again — the guard releases", async () => {
    let savedOnServer = false;
    const { ui, requests } = mountCard({
      "/api/marketplace/saved": (request) => {
        savedOnServer = request.method === "POST";
        return { saved: savedOnServer };
      },
    });

    await ui.click(ui.byName("Save listing"));
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Remove from saved"]') !== null,
      { description: "the filled heart" },
    );

    const filled = ui.container.querySelector<HTMLElement>('button[aria-label="Remove from saved"]');
    await ui.click(filled as HTMLElement);
    await ui.waitFor(() => requests.calls.length === 2, { description: "the un-save request" });
    expect(requests.calls[1].method).toBe("DELETE");
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Save listing"]') !== null,
      { description: "the unfilled heart" },
    );
  });

  test("tells the page the server's answer, once — the shelf listens for the un-save", async () => {
    // The saved page removes a row when the server confirms the un-save, so
    // the card carries the answer out: `false` on a confirmed un-save, `true`
    // on a confirmed save, and nothing at all when the write did not happen —
    // a rollback is the row staying exactly where it was.
    const answers: boolean[] = [];
    const { ui, requests } = mountCard(
      {
        "/api/marketplace/saved": (request) => ({ saved: request.method === "POST" }),
      },
      true,
      (saved) => answers.push(saved),
    );

    const filled = ui.byName("Remove from saved");
    await ui.click(filled);
    await ui.waitFor(() => requests.calls.length === 1, { description: "the un-save request" });
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Save listing"]') !== null,
      { description: "the un-save to be confirmed" },
    );
    expect(answers).toEqual([false]);

    // The save that follows confirms `true` — and the refused-write case is
    // covered above: a rollback is silence on this line.
    const unfilled = ui.byName("Save listing");
    await ui.click(unfilled);
    await ui.waitFor(() => requests.calls.length === 2, { description: "the save request" });
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Remove from saved"]') !== null,
      { description: "the save to be confirmed" },
    );
    expect(answers).toEqual([false, true]);
  });

  test("recants the row's own flag when the parent repaints it — the mounted card does not wait on a refetch", async () => {
    // The state a row repaints under is the one `useState(initialLiked)` once
    // dropped: the prop reads once on the mount and the card keeps the
    // mount-day figure while the parent's rows move under it. So the case is
    // mounted like the pages mount it — the card inside a parent whose own
    // state repaints the `liked` prop in place — and the heart reads the
    // repainted row, not the press's history.
    function ShelfRow() {
      const [liked, setLiked] = useState(false);
      return (
        <ListingCard
          id={SAVED_LISTING_ID}
          title="Vintage camera"
          price={240}
          seller={{ name: "Maya Chen" }}
          liked={liked}
          onSavedChange={(saved) => setLiked(saved)}
        />
      );
    }
    const requests = stubFetch({
      "/api/marketplace/saved": (request) => ({ saved: request.method === "POST" }),
    });
    const ui = mountSurface(
      <ShelfRow />,
    );

    await ui.click(ui.byName("Save listing"));
    await ui.waitFor(() => requests.calls.some((call) => call.method === "POST"), {
      description: "the save request",
    });

    // The press lit the heart and the parent's confirmation (which the
    // component read as its prop) rewrote it; the same card must hold the
    // written state without a second read of the row.
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Remove from saved"]') !== null,
      { description: "the heart the confirmation re-lit" },
    );

    // And the reverse: when the parent's rows are rewritten under the card
    // with no press of this card's own, the card adopts the rewritten state —
    // the state its heart would have shown had it been mounted at the row.
    await ui.click(ui.byName("Remove from saved"));
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Save listing"]') !== null,
      { description: "the heart the parent's repaint un-lit" },
    );
  });
});
