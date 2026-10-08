// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { stubFetch, type StubEndpoint } from "@/test/stub-fetch";
import { PostCard } from "./post-card";

/**
 * The post card's action row, through the state its writes settle in.
 *
 * A reaction is a write, not a wish: the card flips first and then takes the
 * server's answer — `{ type }` — as what the state *is*. What each case pins:
 * the reaction rides a `POST` carrying the post's id and the type, a confirmed
 * write is told to the parent through `onReactionSettled` (which is how the
 * rows the cards paint from are kept in step), a refused write rolls the
 * reaction back and tells the parent *nothing* (a rollback is the rows staying
 * exactly where they were), and the card adopts a row the parent has repainted
 * — the same reconciliation the listing card's heart holds — without a second
 * press or a refetch. One asymmetry the listing card does not have: a row's
 * boolean cannot name a sticker, so a repaint that is the echo of this card's
 * own confirmed write is skipped rather than adopted — adopting it would
 * re-derive the reaction type from the boolean and clobber a confirmed 🔥.
 */
const POST_ID = "55555555-5555-4555-8555-555555555555";

const CARD = {
  id: POST_ID,
  author: { name: "Maya Chen", username: "maya_designs" },
  content: "Colour study for a client refresh.",
  time: "just now",
  likes: 4,
  comments: 2,
  shares: 0,
};

function mountParentCard(
  endpoints: Record<string, StubEndpoint>,
  initialLiked = false,
) {
  /**
   * The parent, shaped like the feed's: it holds the rows, patches the one a
   * confirmation names, and repaints the card from the patched row — which is
   * the reconciliation path that reaches a card that never unmounted.
   */
  function FeedRow() {
    const [liked, setLiked] = useState(initialLiked);
    return (
      <PostCard
        {...CARD}
        liked={liked}
        onReactionSettled={(type) => setLiked(type === "like")}
      />
    );
  }
  const requests = stubFetch(endpoints);
  const ui = mountSurface(<FeedRow />);
  return { ui, requests };
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

describe("the post card's reaction", () => {
  test("likes with a POST carrying the post's id and the type, and takes the server's answer", async () => {
    const { ui, requests } = mountParentCard({
      "/api/posts/reactions": (request) => ({
        reacted: true,
        type: request.body?.type ?? "like",
      }),
    });

    await ui.click(ui.byName("React to post"));
    await ui.waitFor(() => requests.calls.some((call) => call.method === "POST"), {
      description: "the reaction request",
    });

    const save = requests.calls.find((call) => call.method === "POST");
    expect(save?.pathname).toBe("/api/posts/reactions");
    expect(save?.body).toEqual({
      targetType: "post",
      targetId: POST_ID,
      type: "like",
    });

    // The confirmed colour, named after the state it settled in.
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Remove reaction"]') !== null,
      { description: "the lit reaction" },
    );
  });

  test("tells the parent the confirmed state, and the repainted row re-lights the mounted card", async () => {
    const { ui, requests } = mountParentCard({
      "/api/posts/reactions": () => ({ reacted: true, type: "like" }),
    });

    await ui.click(ui.byName("React to post"));
    await ui.waitFor(
      () => requests.calls.some((call) => call.method === "POST"),
      { description: "the reaction request" },
    );

    // The parent was told `like`, wrote the row, and repainted the card from
    // it: the confirmation reaches the card's colour through the row the card
    // was painted from, not only through the press's own state.
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Remove reaction"]') !== null,
      { description: "the heart the confirmed row re-lit" },
    );
  });

  test("keeps a confirmed sticker when the swap's own repaint lands through the boolean row", async () => {
    /**
     * The regression: a row's boolean (`viewerLiked: type === "like"`) cannot
     * name a sticker, so the repaint a confirmed swap causes — heart row lit,
     * sticker write settled, row written `false` — reads as a flip the card
     * would otherwise adopt, re-deriving the reaction *type* from a boolean
     * that never knew it and erasing the sticker the server just kept. The
     * echo of the card's own write must be skipped, not adopted.
     */
    const { ui, requests } = mountParentCard({
      "/api/posts/reactions": (request) => ({
        reacted: true,
        type: request.body?.type ?? "like",
      }),
    });

    // Confirm the heart first, so the row is lit and the swap's repaint is
    // a real flip rather than a no-op.
    await ui.click(ui.byName("React to post"));
    await ui.waitFor(() => requests.calls.some((call) => call.method === "POST"), {
      description: "the like request",
    });
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Remove reaction"]') !== null,
      { description: "the confirmed heart" },
    );

    // Swap it for a sticker: the server confirms a non-"like" type and the
    // parent writes the boolean row un-lit — the exact repaint that used to
    // erase the sticker. The item is picked by position rather than by a typed
    // emoji: the first item is the heart, so the second is a sticker whose type
    // no boolean can name, and the label's emoji carries a variation selector
    // an editor or a review can silently normalise away.
    const postsBefore = requests.calls.filter((call) => call.method === "POST").length;
    await ui.click(ui.byName("Add sticker reaction"));
    const stickerItems = ui.container.querySelectorAll('[aria-label="Sticker reactions"] button');
    if (stickerItems.length < 2) throw new Error("the sticker menu did not render its items");
    stickerItems[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await ui.waitFor(
      () => requests.calls.filter((call) => call.method === "POST").length === postsBefore + 1,
      { description: "the sticker swap request" },
    );

    // The swap settled: the card stays lit — a lit card, still the sticker's
    // own reaction, not re-derived back to nothing by the boolean's flip.
    await ui.waitFor(
      () =>
        ui.container.querySelector('button[aria-label="Remove reaction"]') !== null &&
        ui.container.querySelector('button[aria-label="React to post"]') === null,
      { description: "the confirmed sticker surviving its own repaint" },
    );
  });

  test("a confirmed remove is told to the parent as null, and the row repaints the card un-lit", async () => {
    const { ui, requests } = mountParentCard(
      {
        "/api/posts/reactions": () => ({ reacted: false, type: null }),
      },
      true,
    );

    await ui.click(ui.byName("Remove reaction"));
    await ui.waitFor(
      () => requests.calls.some((call) => call.method === "POST"),
      { description: "the removal request" },
    );
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="React to post"]') !== null,
      { description: "the un-lit reaction from the repainted row" },
    );
  });

  test("rolls the reaction back on a refusal and tells the parent nothing", async () => {
    const answers: (string | null)[] = [];
    stubFetch({
      "/api/posts/reactions": () =>
        new Response(JSON.stringify({ error: "failed" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    });
    const ui = mountSurface(
      <PostCard
        {...CARD}
        onReactionSettled={(type) => answers.push(type)}
      />,
    );

    await ui.click(ui.byName("React to post"));

    await ui.waitFor(
      () =>
        ui.container.querySelector('button[aria-label="React to post"]') !== null &&
        ui.container.querySelector('button[aria-label="Remove reaction"]') === null,
      { description: "the rolled-back reaction" },
    );
    // Silence is the rollback's answer: the write did not land, so the rows
    // the cards paint from are unchanged and the parent is never told.
    expect(answers).toEqual([]);
  });

  test("adopts the row when the parent repaints it with no press of this card's own", async () => {
    /**
     * The feed's rows can move under a card that stays mounted — a live patch,
     * a reconciliation after reconnect. This parent starts the row un-lit and
     * repaints it lit once the page has come up, the way a settled write
     * landing through another path would: the card must read the repainted
     * row, not the mount-day figure.
     */
    stubFetch({});
    function RowThatMoves() {
      const [liked, setLiked] = useState(false);
      return (
        <div>
          <button type="button" aria-label="repaint the row" onClick={() => setLiked(true)} />
          <PostCard {...CARD} liked={liked} />
        </div>
      );
    }
    const ui = mountSurface(<RowThatMoves />);

    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="React to post"]') !== null,
      { description: "the un-lit row painted" },
    );

    await ui.click(ui.byName("repaint the row"));

    // No press of the card's own, no refetch: the repainted row is what the
    // mounted card re-derives from.
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Remove reaction"]') !== null,
      { description: "the heart the repainted row re-lit" },
    );
  });
});
