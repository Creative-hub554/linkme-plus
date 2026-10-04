import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DisclosureButton, type DisclosureButtonProps } from "@/components/ui/disclosure-button";

/**
 * A disclosure that does not say it is open is the defect this exists to make
 * unwritable: the nav's mobile menu button swapped a hamburger for an × and
 * reported nothing about the panel it had just opened.
 *
 * The open state is one boolean here, and it produces both attributes. What is
 * pinned is that they cannot be separated — not by omission, and not by a value
 * that arrives through a cast.
 */
// `children` is required by construction (a control needs contents), so the helper
// supplies the glyph its real callers pass and the cases below stay about state.
function render({
  children = <span aria-hidden="true" />,
  ...props
}: Omit<React.ComponentProps<typeof DisclosureButton>, "children"> & {
  children?: React.ReactNode;
}) {
  return renderToStaticMarkup(
    <TooltipProvider delayDuration={0}>
      <DisclosureButton {...props}>{children}</DisclosureButton>
    </TooltipProvider>,
  );
}

describe("DisclosureButton", () => {
  test("announces the region it owns and that it is open", () => {
    const html = render({ open: true, controls: "mobile-nav", label: "Close menu" });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="mobile-nav"');
    expect(html).toContain('aria-label="Close menu"');
  });

  test("says closed rather than saying nothing", () => {
    // The attribute is always written, so "closed" is stated rather than implied
    // by its absence — which is the difference between a reader being told the
    // panel is shut and being told nothing at all.
    const html = render({ open: false, controls: "mobile-nav", label: "Open menu" });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="mobile-nav"');
  });

  test("sets both attributes from the state the caller passed", () => {
    const closed = render({ open: false, controls: "a", label: "Open" });
    const opened = render({ open: true, controls: "a", label: "Open" });
    expect(closed).toContain('aria-expanded="false"');
    expect(opened).toContain('aria-expanded="true"');
    // Not "the attribute changed" — the same control, saying the other thing.
    expect(opened.replace('aria-expanded="true"', "")).toBe(
      closed.replace('aria-expanded="false"', ""),
    );
  });

  test("ignores state attributes that arrive through a cast", () => {
    // TypeScript will not reject hyphenated JSX attributes (see the ToggleButton
    // test), so this is the enforcement that actually holds.
    const override = {
      "aria-expanded": false,
      "aria-controls": "something-else",
    } as unknown as Partial<DisclosureButtonProps>;
    const html = render({ open: true, controls: "mobile-nav", label: "Close menu", ...override });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="mobile-nav"');
    expect(html).not.toContain("something-else");
    expect(html).not.toContain('aria-expanded="false"');
  });

  test("is not a destination", () => {
    // A disclosure opens something in place. `href` is missing from the props so
    // this cannot be the control that navigates as well.
    // @ts-expect-error a disclosure is not a link.
    const link = <DisclosureButton open={false} controls="a" label="Open" href="/search" />;
    expect(link).toBeTruthy();
  });
});
