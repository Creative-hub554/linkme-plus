import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterChip } from "@/components/shared/filter-chip";

/**
 * A row of these is how the app filters listings, jobs, communities and cover
 * templates, and until this component existed the chosen chip was the filled
 * one — a signal that lives entirely in the colour, which is to say a signal
 * with nothing in it for anyone hearing the row read out.
 *
 * The pairing is what is pinned here: the fill and `aria-pressed` come from the
 * same boolean, so a chip cannot be drawn as chosen while announcing that it is
 * not.
 */
describe("FilterChip", () => {
  test("announces the chosen chip as pressed", () => {
    const html = renderToStaticMarkup(<FilterChip selected>Electronics</FilterChip>);
    expect(html).toContain('aria-pressed="true"');
    // The words are still the accessible name — `aria-pressed` adds state, it
    // does not replace the label.
    expect(html).toContain("Electronics");
  });

  test("announces the others as not pressed", () => {
    const html = renderToStaticMarkup(<FilterChip selected={false}>Electronics</FilterChip>);
    expect(html).toContain('aria-pressed="false"');
  });

  test("cannot look chosen while saying it is not", () => {
    const on = renderToStaticMarkup(<FilterChip selected>All</FilterChip>);
    const off = renderToStaticMarkup(<FilterChip selected={false}>All</FilterChip>);

    // The filled variant is the `default` one; the outlined variant must not
    // carry its fill, or a reader would see a chosen chip that does not say so.
    expect(on).toContain("bg-brand-blue");
    expect(off).not.toContain("bg-brand-blue");
    expect(on).toContain('aria-pressed="true"');
    expect(off).toContain('aria-pressed="false"');
  });

  test("paints itself for the surface it is on", () => {
    // The chip the cover studio's dark panels use. What matters here is that
    // `surface` reaches the chip at all, and that it changes only the unpressed
    // look: the chosen chip is still the filled one, which is what stops a dark
    // row from being drawn as unchosen while saying otherwise.
    const off = renderToStaticMarkup(
      <FilterChip selected={false} surface="dark">
        All
      </FilterChip>,
    );
    const on = renderToStaticMarkup(
      <FilterChip selected surface="dark">
        All
      </FilterChip>,
    );

    expect(off).toContain("bg-white/5");
    expect(off).not.toContain("bg-brand-blue");
    expect(off).toContain('aria-pressed="false"');

    expect(on).toContain("bg-brand-blue");
    expect(on).not.toContain("bg-white/5");
    expect(on).toContain('aria-pressed="true"');
  });

  test("is never a form's submit button", () => {
    // Two of these rows sit in page markup where a bare `<button>` would submit.
    const html = renderToStaticMarkup(<FilterChip selected={false}>All</FilterChip>);
    expect(html).toContain('type="button"');
  });
});
