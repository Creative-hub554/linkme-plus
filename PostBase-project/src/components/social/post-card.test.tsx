// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { stubFetch, type StubEndpoint } from "@/test/stub-fetch";
import { PostCard } from "./post-card";

/**
 * The signed-in reader, held as a mutable so a case can sign in as the comment's
 * author and the next as a stranger without re-mocking the module.
 */
const auth = { userId: "reader-1" as string | null };

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null, isLoading: false }),
}));

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
  // Every case states the reader it needs, so a signed-in reader from one case
  // cannot leak into the next and draw a delete control that has no author.
  auth.userId = "reader-1";
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

  test("wears a row's confirmed type on the mount that comes back after a remount", async () => {
    /**
     * The remount: the virtualized feed unmounts a card the moment it scrolls
     * out of the window, and the remount seeds its state from the row. Rows
     * from `/api/posts` now answer the viewer's reaction as the type it *is*,
     * so the remount shows what the server still holds — including a sticker,
     * which no boolean row can name (the boolean would re-derive it into
     * nothing, on every scroll-out of a reacted card).
     */
    stubFetch({});
    const ui = mountSurface(<PostCard {...CARD} liked={false} reaction="🔥" />);

    expect(ui.container.querySelector('button[aria-label="Remove reaction"]')).not.toBeNull();
    expect(ui.container.querySelector('button[aria-label="React to post"]')).toBeNull();
  });

  test("adopts a type-carrying row whole, stickers and all", async () => {
    /**
     * A row that speaks the reaction's type is adopted as it is: the repaint
     * of the card's own confirmed write carries the same type back, so there
     * is nothing to guard, and a repaint the card did not cause — another
     * viewer's activity settled into the row, a reconciliation — is exactly
     * the state to take. Either way the read-back is the truth, never a
     * re-derivation through a boolean.
     */
    stubFetch({});
    function TypedRow() {
      const [row, setRow] = useState<{ liked: boolean; reaction: string | null }>({
        liked: false,
        reaction: null,
      });
      return (
        <div>
          <button
            type="button"
            aria-label="repaint the row's type"
            onClick={() => setRow({ liked: false, reaction: "🔥" })}
          />
          <PostCard
            {...CARD}
            liked={row.liked}
            reaction={row.reaction}
            onReactionSettled={(type) => setRow({ liked: type === "like", reaction: type })}
          />
        </div>
      );
    }
    const ui = mountSurface(<TypedRow />);

    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="React to post"]') !== null,
      { description: "the un-reacted row painted" },
    );

    await ui.click(ui.byName("repaint the row's type"));

    // The row's 🔥 is what the card wears — not one re-derived from the
    // boolean flip the old shape would have produced.
    await ui.waitFor(
      () => ui.container.querySelector('button[aria-label="Remove reaction"]') !== null,
      { description: "the sticker the typed row lit" },
    );
  });
});

/**
 * The same card, paid for.
 *
 * A boost buys placement and nothing else: the post renders as every other
 * post does, with two additions the advertising rules ask for — it says it is
 * Sponsored, and a reader can put it away. What the campaign also gets (the
 * impression and click counts) is the server's business and is pinned against
 * the route that counts them.
 */
describe("the post card's sponsored placement", () => {
  test("says it is sponsored, offers the Page behind it, and can be put away", async () => {
    stubFetch({});
    const ui = mountSurface(
      <PostCard
        {...CARD}
        sponsored={{
          campaignId: "33333333-3333-4333-8333-333333333333",
          pageUsername: "northside",
          targetLocation: "Lisbon",
        }}
      />,
      { providers: "tooltip" },
    );

    expect(ui.container.textContent).toContain("Sponsored");
    expect(ui.container.textContent).toContain("· Lisbon");
    expect(ui.container.querySelector('a[href="/pages/northside"]')).not.toBeNull();

    const hide = [...ui.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Hide",
    ) as HTMLElement;
    await ui.click(hide);

    // Gone rather than greyed: the control is advertised as a way to put the
    // placement away, and a placeholder is not away.
    expect(ui.container.textContent).not.toContain("Colour study");
  });

  test("renders no placement at all on an ordinary post", () => {
    stubFetch({});
    const ui = mountSurface(<PostCard {...CARD} />, { providers: "tooltip" });

    expect(ui.container.textContent).not.toContain("Sponsored");
    expect([...ui.container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Hide")).toBe(
      false,
    );
  });
});

/**
 * Photos in a comment, through the composer.
 *
 * The flow has three legs and the order is the contract: the file is stored
 * first (`/api/posts/media` answers with the URL that will be persisted — a
 * `blob:` preview URL must never reach the server), the comment is then sent
 * carrying those URLs, and what comes back renders its photos in the thread.
 * The chip is the seam in between: a picked file is visible and removable
 * before anything is uploaded, so a photo attached by mistake never leaves
 * the browser.
 */
describe("the comment composer's photos", () => {
  const PHOTO_URL = "https://test.r2.dev/posts/author-1/harbour.png";

  /** The two endpoints every photo comment needs, plus the empty thread. */
  function photoEndpoints() {
    return {
      "/api/posts/comments": (request: { method: string; body?: Record<string, unknown> }) =>
        request.method === "POST"
          ? {
              comment: {
                id: "99999999-9999-4999-8999-999999999999",
                content: request.body?.content ?? "",
                media: request.body?.media ?? [],
              },
            }
          : {
              data: [],
              pagination: { total: 0, page: 1, limit: 20, totalPages: 0, hasMore: false },
            },
      // The upload answers with the URL the comment will record, keyed off
      // the file's own name so a removal can be told from a send.
      "/api/posts/media": (request: { form?: FormData }) => {
        const file = request.form?.get("file");
        const name = file instanceof File ? file.name : "photo.png";
        return { url: `https://test.r2.dev/posts/author-1/${name}`, key: `posts/author-1/${name}`, type: "image/png" };
      },
    };
  }

  /** Picks files on the composer's hidden input the way a chooser would. */
  function pickPhotos(ui: ReturnType<typeof mountSurface>, names: string[]) {
    const input = ui.container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error("the comment photo input did not render");
    return ui.chooseFiles(
      input,
      names.map((name) => new File(["image-bytes"], name, { type: "image/png" })),
    );
  }

  test("picks a photo, stores it first, and sends the comment carrying its URL", async () => {
    const { ui, requests } = mountParentCard(photoEndpoints());

    await ui.click(ui.byName("Comment on post"));
    // Nothing to send yet: neither text nor photo makes an empty comment.
    expect((ui.byName("Send comment") as HTMLButtonElement).disabled).toBe(true);

    await pickPhotos(ui, ["harbour.png"]);
    await ui.waitFor(
      () => ui.container.querySelector('[aria-label="Photos attached to this comment"]') !== null,
      { description: "the picked photo's chip" },
    );

    // Enabled by the photo alone — a photo-only comment needs no text.
    await ui.click(ui.byName("Send comment"));
    await ui.waitFor(
      () =>
        requests.calls.some(
          (call) => call.pathname === "/api/posts/comments" && call.method === "POST",
        ),
      { description: "the comment write" },
    );

    const uploadIndex = requests.calls.findIndex((call) => call.pathname === "/api/posts/media");
    const sendIndex = requests.calls.findIndex(
      (call) => call.pathname === "/api/posts/comments" && call.method === "POST",
    );
    expect(uploadIndex).toBeGreaterThanOrEqual(0);
    // Stored before sent: the comment records the URL the upload answered
    // with, never the preview this browser was holding.
    expect(uploadIndex).toBeLessThan(sendIndex);
    expect(requests.calls[uploadIndex].form?.get("file")).toBeInstanceOf(File);

    const send = requests.calls[sendIndex];
    expect(send.body?.content).toBe("");
    expect(send.body?.media).toEqual([
      { url: "https://test.r2.dev/posts/author-1/harbour.png", type: "image/png", altText: "Comment photo" },
    ]);

    // The server's answer carries the photos, so the thread shows them before
    // the hydration read even lands.
    await ui.waitFor(
      () => ui.container.querySelector('[aria-label="Photos in this comment"] img') !== null,
      { description: "the photo in the thread" },
    );
  });

  test("removes a picked photo before sending, and sends only what is left", async () => {
    const { ui, requests } = mountParentCard(photoEndpoints());

    await ui.click(ui.byName("Comment on post"));
    await pickPhotos(ui, ["first.png", "second.png"]);
    await ui.waitFor(
      () =>
        ui.container.querySelectorAll('[aria-label="Photos attached to this comment"] [role="listitem"]')
          .length === 2,
      { description: "both chips" },
    );

    await ui.click(ui.byName("Remove photo 1"));
    await ui.waitFor(
      () => ui.container.querySelector('[aria-label="Remove photo 2"]') === null,
      { description: "the first photo's chip gone" },
    );

    await ui.click(ui.byName("Send comment"));
    await ui.waitFor(
      () =>
        requests.calls.some(
          (call) => call.pathname === "/api/posts/comments" && call.method === "POST",
        ),
      { description: "the comment write" },
    );

    const send = requests.calls.find(
      (call) => call.pathname === "/api/posts/comments" && call.method === "POST",
    );
    // Only the surviving photo was uploaded and only it is recorded — the
    // removed one never left the browser.
    const uploads = requests.calls.filter((call) => call.pathname === "/api/posts/media");
    expect(uploads).toHaveLength(1);
    expect(send?.body?.media).toEqual([
      { url: "https://test.r2.dev/posts/author-1/second.png", type: "image/png", altText: "Comment photo" },
    ]);
  });

  test("renders the photos a loaded comment carries, alt text and all", async () => {
    stubFetch({
      "/api/posts/comments": () => ({
        data: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            content: "Look at this",
            author: { name: "Al Ramos", username: "al" },
            media: [{ url: PHOTO_URL, altText: "The harbour at dusk", type: "image/png" }],
          },
        ],
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false },
      }),
    });
    const ui = mountSurface(<PostCard {...CARD} />);

    await ui.click(ui.byName("Comment on post"));

    await ui.waitFor(
      () => ui.container.querySelector('[aria-label="Photos in this comment"] img') !== null,
      { description: "the comment's photo" },
    );
    const photo = ui.container.querySelector('[aria-label="Photos in this comment"] img') as HTMLImageElement;
    expect(photo.getAttribute("src")).toBe(PHOTO_URL);
    expect(photo.getAttribute("alt")).toBe("The harbour at dusk");
    expect(photo.getAttribute("loading")).toBe("lazy");
  });
});

/**
 * The delete control on a comment in the thread, and the confirmation it asks
 * for.
 *
 * The rule is authorship: a comment carries its author's id and the reader
 * carries theirs, and the control is drawn only where the two agree — a
 * colleague's comment carries no affordance at all rather than one that opens
 * and then refuses. Deleting cannot be undone and the server reclaims the
 * comment's photos with it, so the control opens a confirmation rather than
 * acting on a press, and cancelling sends nothing. A confirmed delete is
 * optimistic (the comment leaves and the count drops with it) and both are
 * put back when the request fails, with the failure in the card's notice.
 */
describe("deleting the reader's own comment", () => {
  const OWN_ID = "99999999-9999-4999-8999-999999999999";
  const OTHER_ID = "88888888-8888-4888-8888-888888888888";

  /** A button inside a portalled dialog, which lives outside the mount container. */
  function buttonReading(root: ParentNode, text: string): HTMLButtonElement {
    const element = [...root.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").includes(text),
    );
    if (!element) throw new Error('no button reading "' + text + '" was rendered');
    return element as HTMLButtonElement;
  }

  /**
   * A two-comment thread — one the reader's own, one a colleague's — beside a
   * DELETE that answers however the case needs it to. The card opens at two
   * comments so the decrement a delete makes is visible against that number.
   */
  function threadEndpoints(deleteReply: () => unknown = () => ({ success: true })) {
    return {
      "/api/posts/comments": (request: { method: string }) =>
        request.method === "DELETE"
          ? deleteReply()
          : {
              data: [
                {
                  id: OWN_ID,
                  content: "My own note.",
                  author: { id: "reader-1", name: "Reader One", username: "reader" },
                },
                {
                  id: OTHER_ID,
                  content: "A colleague's note.",
                  author: { id: "author-2", name: "Al Ramos", username: "al" },
                },
              ],
              pagination: { total: 2, page: 1, limit: 20, totalPages: 1, hasMore: false },
            },
    };
  }

  /** Mounts the card and opens its thread, waiting for both comments to land. */
  async function openThread(deleteReply?: () => unknown) {
    const requests = stubFetch(threadEndpoints(deleteReply) as never);
    const ui = mountSurface(<PostCard {...CARD} comments={2} />);
    await ui.click(ui.byName("Comment on post"));
    await ui.waitFor(
      () => ui.container.textContent?.includes("A colleague's note.") === true,
      { description: "the loaded thread" },
    );
    return { ui, requests };
  }

  test("is offered on the reader's own comment and on no one else's", async () => {
    auth.userId = "reader-1";
    const { ui } = await openThread();

    const controls = [...ui.container.querySelectorAll('[aria-label="Delete comment"]')];
    expect(controls).toHaveLength(1);
    // The control sits inside the bubble of the comment the reader wrote — not
    // merely on a row that also happens to hold their avatar.
    expect(controls[0].closest(".rounded-xl")?.textContent).toContain("My own note.");
  });

  test("is drawn for no comment when there is no signed-in reader", async () => {
    auth.userId = null;
    const { ui } = await openThread();

    expect(ui.container.querySelectorAll('[aria-label="Delete comment"]')).toHaveLength(0);
  });

  test("asks for confirmation, and cancelling sends nothing and keeps the comment", async () => {
    auth.userId = "reader-1";
    const { ui, requests } = await openThread();

    await ui.click(ui.byName("Delete comment"));
    await ui.waitFor(
      () => document.body.textContent?.includes("Delete this comment?") === true,
      { description: "the confirmation dialog" },
    );
    // The dialog names the consequence the post's own dialog names: the photos
    // go with it, which is the reader's to know before an undoable press.
    expect(document.body.textContent).toContain("can't be undone");
    expect(document.body.textContent).toContain("removed with it");

    await ui.click(buttonReading(document.body, "Cancel"));

    await ui.waitFor(
      () => document.body.textContent?.includes("Delete this comment?") !== true,
      { description: "the dialog closed" },
    );
    expect(requests.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(ui.container.textContent).toContain("My own note.");
  });

  test("sends the comment's id and takes it out of the thread, dropping the count", async () => {
    auth.userId = "reader-1";
    const { ui, requests } = await openThread();

    await ui.click(ui.byName("Delete comment"));
    await ui.waitFor(
      () => document.body.textContent?.includes("Delete this comment?") === true,
      { description: "the confirmation dialog" },
    );
    await ui.click(buttonReading(document.body, "Delete comment"));

    await ui.waitFor(
      () => requests.calls.some((call) => call.method === "DELETE"),
      { description: "the delete request" },
    );
    const del = requests.calls.find((call) => call.method === "DELETE");
    expect(del?.pathname).toBe("/api/posts/comments");
    expect(del?.query.get("id")).toBe(OWN_ID);

    // Optimistic: the reader's comment is gone from the thread, a colleague's
    // stays, and the action row's count follows it down.
    await ui.waitFor(
      () => ui.container.textContent?.includes("My own note.") !== true,
      { description: "the comment removed from the thread" },
    );
    expect(ui.container.textContent).toContain("A colleague's note.");
    expect(ui.container.querySelector('[aria-label="Comment on post"]')?.textContent).toBe("1");
    // The confirmation closed with the request rather than lingering over it.
    expect(document.body.textContent).not.toContain("Delete this comment?");
  });

  test("puts the comment back and says so when the delete fails", async () => {
    auth.userId = "reader-1";
    // A handler returning a built Response answers with its own status, so this
    // is a real 500 rather than a payload the card might mistake for success.
    const { ui, requests } = await openThread(() =>
      new Response(JSON.stringify({ error: "Nope" }), { status: 500 }),
    );

    await ui.click(ui.byName("Delete comment"));
    await ui.waitFor(
      () => document.body.textContent?.includes("Delete this comment?") === true,
      { description: "the confirmation dialog" },
    );
    await ui.click(buttonReading(document.body, "Delete comment"));

    await ui.waitFor(
      () => ui.container.textContent?.includes("Comment could not be deleted") === true,
      { description: "the failure notice" },
    );
    // The optimistic removal is undone: the comment is back where it was, the
    // count with it, and the request really was attempted.
    expect(requests.calls.some((call) => call.method === "DELETE")).toBe(true);
    expect(ui.container.textContent).toContain("My own note.");
    expect(ui.container.querySelector('[aria-label="Comment on post"]')?.textContent).toBe("2");
    // The dialog closed on the failure too — it does not linger over a rollback.
    expect(document.body.textContent).not.toContain("Delete this comment?");
  });
});
