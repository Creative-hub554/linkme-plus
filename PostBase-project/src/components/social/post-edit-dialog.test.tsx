// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { PostEditDialog, type PostEdit } from "@/components/social/post-edit-dialog";

/**
 * Who may change a post's audience, judged at the one place the answer can be
 * *offered* wrongly: the edit form.
 *
 * An ordinary post's audience is its author's to move, and the form says what
 * it is on and sends what was chosen. A post written inside a group is not:
 * being readable by the group is what publishing there meant, so the form does
 * not offer a picker, states the audience instead, and sends `group` whatever
 * happened to be in its state. The server pins it as well — this is the half
 * that stops the control being shown at all.
 */
function renderDialog({
  visibility,
  groupName,
  onSave,
}: {
  visibility: string | null;
  groupName?: string | null;
  onSave: (postId: string, changes: PostEdit) => Promise<void>;
}) {
  return mountSurface(
    <PostEditDialog
      postId="post-1"
      content="Written in a group"
      visibility={visibility}
      groupName={groupName}
      open
      onOpenChange={() => {}}
      onSave={onSave}
    />,
    { providers: "none" },
  );
}

function buttonReading(root: ParentNode, text: string) {
  const element = [...root.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes(text),
  );
  if (!element) throw new Error(`no button reading "${text}" was rendered`);
  return element as HTMLButtonElement;
}

afterEach(() => {
  // Unmount before the body is cleared: a portal is a child of the body, and
  // emptying the body first makes React's own teardown throw.
  cleanupSurfaces();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("editing a post written in a group", () => {
  test("states the audience instead of offering one", () => {
    const ui = renderDialog({
      visibility: "group",
      groupName: "Creative Builders",
      onSave: async () => {},
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Everyone in Creative Builders");
    // No picker: an option list here would contain every audience the post
    // cannot have, and choosing one would be the only effect it could have.
    expect(ui.container.textContent).not.toContain("Post audience");
    expect(document.querySelector('[aria-label^="Post audience"]')).toBeNull();
    // The words are still editable — only the audience is not.
    expect(document.querySelector("textarea")).not.toBeNull();
  });

  test("sends the group's audience, whatever the form is holding", async () => {
    const saved: PostEdit[] = [];
    const ui = renderDialog({
      visibility: "group",
      groupName: "Creative Builders",
      onSave: async (_postId, changes) => {
        saved.push(changes);
      },
    });
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    await ui.type(textarea as HTMLTextAreaElement, "Written in a group, edited");
    await ui.click(buttonReading(document, "Save changes"));
    await ui.waitFor(() => saved.length > 0, { description: "the edit to be saved" });

    expect(saved[0]).toEqual({
      content: "Written in a group, edited",
      visibility: "group",
    });
  });

  test("does not mistake an unrecognised audience for a group post", async () => {
    // The form is told about the group by its name rather than by reading the
    // visibility, so a post whose audience nobody declared is still an ordinary
    // post: the picker is offered and what it holds is what is sent.
    const saved: PostEdit[] = [];
    const ui = renderDialog({
      visibility: null,
      onSave: async (_postId, changes) => {
        saved.push(changes);
      },
    });
    expect(document.querySelector('[aria-label="Post audience: Public"]')).not.toBeNull();
    await ui.click(buttonReading(document, "Save changes"));
    await ui.waitFor(() => saved.length > 0, { description: "the edit to be saved" });
    // `public` because an unknown or missing audience reads as the one a
    // reader is most likely to expect, which is the shared list's first.
    expect(saved[0].visibility).toBe("public");
  });
});
