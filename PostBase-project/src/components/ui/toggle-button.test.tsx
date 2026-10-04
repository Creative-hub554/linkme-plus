import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToggleButton, type ToggleButtonProps } from "@/components/ui/toggle-button";

/**
 * The classes an element actually carries, as whole tokens.
 *
 * `toContain("bg-brand-blue")` is a different question: the filled variant also
 * emits `hover:bg-brand-blue-dark`, so a substring check answers "yes, there is a
 * fill class" when the only thing present is a hover rule. That mistake was made
 * while writing these tests and is why this helper exists.
 */
function classesOf(html: string): string[] {
  return (html.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
}

/**
 * The pairing, in one place.
 *
 * `FilterChip` and `FollowButton` both used to spell this out by hand: a
 * ternary on the variant and a second prop for `aria-pressed`, two facts that
 * had to agree and could be written half right. They both go through here now,
 * so what is pinned is the primitive — the fill and the announcement are the
 * same boolean, and neither can be passed to contradict it.
 */
describe("ToggleButton", () => {
  test("fills and announces together when pressed", () => {
    const html = renderToStaticMarkup(<ToggleButton pressed>All</ToggleButton>);
    expect(html).toContain('aria-pressed="true"');
    // The filled variant is `default`; the words are still the name.
    expect(classesOf(html)).toContain("bg-brand-blue");
    expect(html).toContain("All");
  });

  test("outlines and announces together when not", () => {
    const html = renderToStaticMarkup(<ToggleButton pressed={false}>All</ToggleButton>);
    expect(html).toContain('aria-pressed="false"');
    expect(classesOf(html)).not.toContain("bg-brand-blue");
  });

  test("is never a form's submit button", () => {
    const html = renderToStaticMarkup(<ToggleButton pressed={false}>All</ToggleButton>);
    expect(html).toContain('type="button"');
  });

  test("outlines a control on a dark card without filling it", () => {
    const html = renderToStaticMarkup(
      <ToggleButton pressed={false} surface="dark">
        Video
      </ToggleButton>,
    );
    expect(html).toContain('aria-pressed="false"');
    // The outlined-on-dark look: a translucent panel with white contents.
    expect(classesOf(html)).toContain("bg-white/5");
    expect(classesOf(html)).toContain("text-white");
    expect(classesOf(html)).not.toContain("bg-brand-blue");
  });

  test("fills it on any surface once it is on", () => {
    // This is what `surface` is shaped to protect: it says where the control
    // *is*, not what its two states look like. The filled state stays filled on
    // both, so a dark row cannot be drawn as unpressed while announcing that it
    // is pressed.
    for (const surface of ["light", "dark"] as const) {
      const html = renderToStaticMarkup(
        <ToggleButton pressed surface={surface}>
          Video
        </ToggleButton>,
      );
      expect(html, surface).toContain('aria-pressed="true"');
      expect(classesOf(html), surface).toContain("bg-brand-blue");
      expect(classesOf(html), surface).not.toContain("bg-white/5");
    }
  });

  test("cannot stop a caller's own background from winning", () => {
    // Not a feature — this is what `cn` does, since it runs through
    // tailwind-merge and the caller's classes come last. It is pinned because it
    // is the whole reason `surface` exists: a caller that had to name the
    // off-look's classes would be one `bg-*` away from drawing a pressed control
    // as unpressed, which is the exact failure the pressed/announced pairing was
    // added to end. If tailwind-merge ever changes this, the doc comment on
    // `surface` is what needs re-reading.
    const html = renderToStaticMarkup(
      <ToggleButton pressed className="bg-white/5">
        Video
      </ToggleButton>,
    );
    expect(classesOf(html)).toContain("bg-white/5");
    expect(classesOf(html)).not.toContain("bg-brand-blue");
    // The announcement is untouched — only the drawing can be overridden.
    expect(html).toContain('aria-pressed="true"');
  });

  test("ignores a state attribute that arrives through a cast", () => {
    // Types stop this; the spread order stops it too. A value that gets past the
    // first must not win over the state the caller actually passed.
    const override = { "aria-pressed": false } as unknown as Partial<ToggleButtonProps>;
    const html = renderToStaticMarkup(
      <ToggleButton pressed {...override}>
        All
      </ToggleButton>,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('aria-pressed="false"');
  });

  test("refuses to be handed a variant or a type", () => {
    // These do not compile, which is the enforcement — `tsc` checks this file, so
    // an `Omit` that quietly stopped working would fail there rather than here.
    // A third omission, `aria-pressed`, is deliberately not tested this way: see
    // the note at the bottom of this file.
    const variant = (
      // @ts-expect-error `variant` is derived from `pressed`.
      <ToggleButton pressed variant="destructive">
        All
      </ToggleButton>
    );
    const type = (
      // @ts-expect-error a toggle is never a submit button.
      <ToggleButton pressed type="submit">
        All
      </ToggleButton>
    );

    expect(renderToStaticMarkup(variant)).toContain('aria-pressed="true"');
    expect(renderToStaticMarkup(type)).toContain('type="button"');
  });
});

/**
 * `aria-pressed` is not exercised with `@ts-expect-error`, because TypeScript will
 * not reject it: a JSX attribute whose name contains a hyphen is exempt from the
 * excess-property check on a component's props, so `<ToggleButton
 * aria-pressed={false}>` compiles even with the `Omit` in place. Verified by
 * writing it, not assumed. For hyphenated attributes the spread order is the
 * enforcement, which is what the cast test above pins — and the same is true of
 * every `aria-*` in the components this one is built from.
 */
