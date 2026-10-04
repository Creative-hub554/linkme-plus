import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Switch } from "@/components/ui/switch";

/**
 * A switch has no content to name it, so its name is a prop — and a switch with
 * no name is a control that says only "switch". `SwitchProps` requires exactly
 * one of `aria-label` / `aria-labelledby`, so the nameless spelling does not
 * compile and the two spellings cannot both be given.
 */
describe("Switch", () => {
  test("carries the name it is given", () => {
    const html = renderToStaticMarkup(<Switch aria-label="Enable dark mode" />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Enable dark mode"');
  });

  test("can be named by a reference instead", () => {
    const html = renderToStaticMarkup(<Switch aria-labelledby="dark-mode-heading" />);
    expect(html).toContain('aria-labelledby="dark-mode-heading"');
  });

  test("cannot be written without a name", () => {
    // `tsc` checks this file: making either spelling optional would leave this
    // directive unused and fail the typecheck.
    // @ts-expect-error a switch with no name announces only "switch".
    const nameless = <Switch />;
    expect(nameless).toBeTruthy();
  });

  test("cannot be named twice", () => {
    // @ts-expect-error the two spellings are alternatives, not a pair.
    const both = <Switch aria-label="On" aria-labelledby="dark-mode-heading" />;
    expect(both).toBeTruthy();
  });
});
