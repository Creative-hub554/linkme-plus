// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { FollowButton } from "@/components/social/follow-button";

/**
 * The button's whole contract is that it *responds* — the click is optimistic,
 * the server settles it, and a failure rolls the state back where the reader
 * can see the attempt failed. A snapshot of the idle button would prove none of
 * that, so the interesting half of this file drives real clicks through a
 * stubbed `fetch`.
 */

function buttonIn(container: ParentNode): HTMLButtonElement {
  const element = container.querySelector("button");
  if (!element) throw new Error("FollowButton rendered no button");
  return element as HTMLButtonElement;
}

function statusIn(container: ParentNode): string {
  return container.querySelector('[role="status"]')?.textContent ?? "";
}

afterEach(() => {
  cleanupSurfaces();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("what the button says before anyone touches it", () => {
  test("offers to follow when the reader does not follow yet", () => {
    const markup = renderToStaticMarkup(<FollowButton userId="u1" />);
    expect(markup).toContain("Follow");
    expect(markup).not.toContain("Following");
    expect(markup).toContain('aria-pressed="false"');
  });

  test("says Following, and offers the undo, when the edge already exists", () => {
    const markup = renderToStaticMarkup(<FollowButton userId="u1" initialFollowing />);
    expect(markup).toContain("Following");
    expect(markup).toContain('aria-pressed="true"');
  });

  test("names whose follow action it is, for a list of members", () => {
    // A row of results renders many of these; without the subject the
    // accessible name is a bare "Follow" repeated down the page.
    const markup = renderToStaticMarkup(
      <FollowButton userId="u1" subjectName="Ada Lovelace" />,
    );
    expect(markup).toContain('aria-label="Follow Ada Lovelace"');
    const followed = renderToStaticMarkup(
      <FollowButton userId="u1" initialFollowing subjectName="Ada Lovelace" />,
    );
    expect(followed).toContain('aria-label="Unfollow Ada Lovelace"');
  });
});

describe("the click", () => {
  test("is optimistic: the label flips before the server answers", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const ui = mountSurface(<FollowButton userId="u7" />, { providers: "none" });
    await ui.click(buttonIn(ui.container));
    // The request is still in flight — the button has already said Following.
    expect(buttonIn(ui.container).textContent).toContain("Following");
    expect(buttonIn(ui.container).disabled).toBe(true);

    resolveFetch(
      new Response(JSON.stringify({ following: true, followers: 12 }), { status: 200 }),
    );
    await ui.waitFor(() => buttonIn(ui.container).disabled === false);
    expect(buttonIn(ui.container).textContent).toContain("Following");
  });

  test("sends the intended state, not a toggle", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ following: true, followers: 3 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ui = mountSurface(<FollowButton userId="u9" />, { providers: "none" });
    await ui.click(buttonIn(ui.container));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/users/follow");
    expect(JSON.parse(String(init.body))).toEqual({ userId: "u9", following: true });
  });

  test("reports the server's settled state, with the follower total it returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ following: true, followers: 42 }), { status: 200 })),
    );
    const onChange = vi.fn();

    const ui = mountSurface(
      <FollowButton userId="u9" onChange={onChange} />,
      { providers: "none" },
    );
    await ui.click(buttonIn(ui.container));
    await ui.waitFor(() => onChange.mock.calls.length > 0);

    expect(onChange).toHaveBeenCalledWith(true, 42);
  });

  test("rolls back and says so when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 })),
    );

    const ui = mountSurface(<FollowButton userId="u9" />, { providers: "none" });
    await ui.click(buttonIn(ui.container));

    await ui.waitFor(() => statusIn(ui.container).length > 0);
    // The state flipping back *is* the feedback: the button showed Following
    // optimistically, and now it must not still be claiming an edge that was
    // never written.
    expect(buttonIn(ui.container).textContent).toContain("Follow");
    expect(buttonIn(ui.container).textContent).not.toContain("Following");
    expect(statusIn(ui.container)).toBe("We couldn't update that follow. Please try again.");
    expect(buttonIn(ui.container).title).toBe("We couldn't update that follow. Please try again.");
  });

  test("ignores the second click while the first is in flight", async () => {
    // The first request must still be open when the second click lands, so it
    // is resolved by hand rather than immediately.
    let resolveFetch: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ui = mountSurface(<FollowButton userId="u9" />, { providers: "none" });
    await ui.click(buttonIn(ui.container));
    expect(buttonIn(ui.container).disabled).toBe(true);
    // Pending disables the control, and the handler bails on a re-entry — either
    // way the second click must not queue a contradicting request.
    await ui.click(buttonIn(ui.container));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({ following: true }), { status: 200 }));
    await ui.waitFor(() => buttonIn(ui.container).disabled === false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
