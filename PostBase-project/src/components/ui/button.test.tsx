import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";

/**
 * A button's name is its own content, so a `<Button />` with nothing inside is a
 * control that announces "button" and nothing else — the shape an icon-only
 * action row shipped as. `children` is required so that spelling does not
 * compile; a control that is *only* a glyph goes through `IconButton`, which
 * cannot be written without a `label`.
 */
describe("Button", () => {
  test("says what it does through its contents", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain("Save");
  });

  test("cannot be written without contents", () => {
    // `tsc` checks this file: if `children` became optional, this directive turns
    // into "unused" and the typecheck fails rather than the guard going quiet.
    // @ts-expect-error a button with nothing inside announces nothing.
    const empty = <Button />;
    expect(empty).toBeTruthy();
  });
});
