import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusIndicator } from "@/components/ui/status-indicator";

/**
 * A status drawn as a colour is a status drawn for the people who can see that
 * colour. `OnlineStatus` shipped that way — a green dot or a grey dot and
 * nothing else, which is also the pair a reader with a red-green deficiency is
 * most likely to lose — and the fix was to always put the words in the markup.
 *
 * This component is that fix as a rule rather than a habit: the label is
 * required, so there is no spelling of a status mark that has nothing to say.
 */
describe("StatusIndicator", () => {
  test("always says what the state is, even with the words hidden", () => {
    const html = renderToStaticMarkup(<StatusIndicator label="Online" />);
    expect(html).toContain("Online");
    // Hidden from sight, not from a reader.
    expect(html).toContain("sr-only");
  });

  test("shows the same words rather than announcing something else", () => {
    const html = renderToStaticMarkup(<StatusIndicator label="Last seen 2 hours ago" showText />);
    expect(html).toContain("Last seen 2 hours ago");
    // Visible, so nothing needs hiding.
    expect(html).not.toContain("sr-only");
  });

  test("keeps the mark out of the announcement", () => {
    const html = renderToStaticMarkup(<StatusIndicator label="Online" />);
    // A coloured circle has no text; leaving it exposed only adds noise.
    expect(html).toMatch(/<span aria-hidden="true"[^>]*rounded-full/);
  });

  test("takes the colour from the tone and the size from the prop", () => {
    const online = renderToStaticMarkup(<StatusIndicator label="Online" tone="success" size="sm" />);
    const offline = renderToStaticMarkup(<StatusIndicator label="Offline" size="sm" />);
    expect(online).toContain("bg-green-500");
    expect(online).toContain("h-2 w-2");
    // The default tone is the quiet one, so a mark with no tone says nothing
    // emphatic by accident.
    expect(offline).toContain("bg-gray-400");
  });

  test("renders phrasing content, so it is valid inside a control", () => {
    // It sits inside conversation rows and notification items, which are
    // buttons: a `div` in there is invalid markup, and the browser's parser
    // would happily move it out of the button while React thought it was inside.
    const html = renderToStaticMarkup(
      <button type="button">
        <StatusIndicator label="Unread" />
      </button>,
    );
    expect(html).not.toContain("<div");
  });

  test("cannot be written without a label", () => {
    // The type is the enforcement: `label` has no default and no `undefined` in
    // it, so a status mark with nothing to say does not compile. `tsc` checks
    // this file, so if the prop ever became optional this directive turns into
    // "unused" and the typecheck fails.
    // @ts-expect-error a status with no words is the defect, not a variant of it.
    const wordless = <StatusIndicator tone="success" />;
    expect(wordless).toBeTruthy();
  });
});
