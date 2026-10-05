// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { ReportPostDialog } from "@/components/social/report-post-dialog";

/**
 * The report flow is the safety team's intake: the dialog must not send a
 * report it has no reason for, must send the one the reader picked with the
 * post it belongs to, and must show the server's refusal rather than closing
 * over it. Each of those is a promise to the reporter *and* to whoever reads
 * the queue, so each is driven through a real open-and-submit here.
 *
 * Radix portals the dialog into `document.body`, so the lookups below read the
 * body rather than the mount's container.
 */

function buttonReading(root: ParentNode, text: string): HTMLButtonElement {
  // The accessible name of a button is its text when it has any, and its
  // `aria-label` when it is icon-only — the trigger is the second kind.
  const element = [...root.querySelectorAll("button")].find(
    (button) =>
      (button.textContent ?? "").includes(text) ||
      button.getAttribute("aria-label") === text,
  );
  if (!element) throw new Error(`no button reading "${text}" was rendered`);
  return element as HTMLButtonElement;
}

async function openDialog() {
  const ui = mountSurface(<ReportPostDialog postId="post-42" />, { providers: "none" });
  await ui.click(buttonReading(document.body, "More post options"));
  await ui.waitFor(() => document.body.textContent?.includes("Report this post") === true);
  return ui;
}

function typeInto(element: HTMLTextAreaElement, text: string) {
  // React controls the value through its own setter, so writing the property
  // directly is invisible to it — the descriptor has to be borrowed.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  cleanupSurfaces();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("opening the dialog", () => {
  test("offers the reasons and sends nothing until one is chosen", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ui = await openDialog();

    for (const reason of ["Spam or scam", "Harassment or bullying", "Other"]) {
      expect(document.body.textContent).toContain(reason);
    }
    const submit = buttonReading(document.body, "Submit report");
    expect(submit.disabled).toBe(true);

    await ui.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("submitting a report", () => {
  test("sends the chosen reason, the typed details, and the post it is about", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ui = await openDialog();

    await ui.click(buttonReading(document.body, "Spam or scam"));
    const details = document.body.querySelector("textarea");
    if (!details) throw new Error("the dialog rendered no details field");
    typeInto(details, "Repeated unsolicited DMs");

    const submit = buttonReading(document.body, "Submit report");
    expect(submit.disabled).toBe(false);
    await ui.click(submit);
    await ui.waitFor(() => fetchMock.mock.calls.length > 0);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/posts/reports");
    expect(JSON.parse(String(init.body))).toEqual({
      postId: "post-42",
      targetId: "post-42",
      reason: "Spam or scam",
      description: "Repeated unsolicited DMs",
    });

    // The confirmation is what closes the loop for the reporter.
    await ui.waitFor(() => document.body.textContent?.includes("Thanks for reporting this") === true);
    expect(document.body.textContent).toContain("Our safety team will review the post.");
  });

  test("shows the server's refusal instead of pretending the report landed", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "You have filed too many reports." }), { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ui = await openDialog();

    await ui.click(buttonReading(document.body, "Hate or violence"));
    await ui.click(buttonReading(document.body, "Submit report"));
    await ui.waitFor(() => document.body.querySelector('[role="alert"]') !== null);

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "You have filed too many reports.",
    );
    // Still on the form: the reporter gets to try again, not a thank-you.
    expect(document.body.textContent).toContain("Report this post");
    expect(document.body.textContent).not.toContain("Thanks for reporting this");
  });
});

describe("closing and reopening", () => {
  test("forgets the previous report so the next one starts empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const ui = await openDialog();

    await ui.click(buttonReading(document.body, "Spam or scam"));
    expect(buttonReading(document.body, "Submit report").disabled).toBe(false);

    await ui.click(buttonReading(document.body, "Cancel"));
    await ui.waitFor(() => document.body.textContent?.includes("Report this post") !== true);

    await ui.click(buttonReading(document.body, "More post options"));
    await ui.waitFor(() => document.body.textContent?.includes("Report this post") === true);
    expect(buttonReading(document.body, "Submit report").disabled).toBe(true);
  });
});
