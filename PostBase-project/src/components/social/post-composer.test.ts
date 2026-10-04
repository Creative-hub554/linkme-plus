import { describe, expect, test } from "vitest";
import { shouldCollapseComposer, type ComposerFocusTarget } from "@/components/social/post-composer";

/**
 * The composer's collapse rule used to live inside an `onBlur` handler, where it
 * was wrong twice — once hiding the Post button after posting, once closing the
 * composer when the audience picker took focus. Both are now one function, so
 * both are pinned here.
 */
describe("shouldCollapseComposer", () => {
  test("keeps the composer open while focus is still inside it", () => {
    expect(
      shouldCollapseComposer({ focusTarget: "inside", ownsOpenPopover: false, hasDraft: false }),
    ).toBe(false);
  });

  test("keeps an empty composer open when its own picker has taken focus", () => {
    // The bug this rule exists for: the menu renders into a portal outside the
    // composer, so focus moving onto an option looked like leaving — and the
    // composer closed, taking the menu with it, before an audience could be
    // chosen.
    expect(
      shouldCollapseComposer({ focusTarget: "outside", ownsOpenPopover: true, hasDraft: false }),
    ).toBe(false);
  });

  test("keeps the composer open when focus left the document", () => {
    // An opened file dialog blurs the page; collapsing would hide the toolbar
    // the dialog was opened from.
    expect(
      shouldCollapseComposer({ focusTarget: "off-document", ownsOpenPopover: false, hasDraft: false }),
    ).toBe(false);
  });

  test("collapses an empty composer focus has really left", () => {
    expect(
      shouldCollapseComposer({ focusTarget: "outside", ownsOpenPopover: false, hasDraft: false }),
    ).toBe(true);
  });

  test("keeps a composer with a draft open, wherever focus went", () => {
    for (const focusTarget of ["inside", "outside", "off-document"] as ComposerFocusTarget[]) {
      for (const ownsOpenPopover of [false, true]) {
        expect(shouldCollapseComposer({ focusTarget, ownsOpenPopover, hasDraft: true })).toBe(false);
      }
    }
  });

  test("collapses in exactly one of the twelve situations", () => {
    // The complete rule, not examples of it: focus really left, nothing open,
    // nothing written.
    const collapses: string[] = [];
    for (const focusTarget of ["inside", "outside", "off-document"] as ComposerFocusTarget[]) {
      for (const ownsOpenPopover of [false, true]) {
        for (const hasDraft of [false, true]) {
          if (shouldCollapseComposer({ focusTarget, ownsOpenPopover, hasDraft })) {
            collapses.push(`${focusTarget}/${ownsOpenPopover}/${hasDraft}`);
          }
        }
      }
    }
    expect(collapses).toEqual(["outside/false/false"]);
  });
});
