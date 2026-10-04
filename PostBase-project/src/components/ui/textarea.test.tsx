import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Textarea } from "@/components/ui/textarea";

/**
 * A textarea is a field like any other, so it carries the same requirement as
 * `Input`: a name of its own, a reference to one, or an `id` a label can point
 * at. A placeholder does not name it, and the nameless spelling does not compile.
 */
describe("Textarea", () => {
  test("carries the name it is given", () => {
    const html = renderToStaticMarkup(<Textarea aria-label="Your bio" />);
    expect(html).toContain('aria-label="Your bio"');
  });

  test("can be named by a label's `for` instead", () => {
    const html = renderToStaticMarkup(<Textarea id="bio" />);
    expect(html).toContain('id="bio"');
  });

  test("cannot be written without a way to be named", () => {
    // @ts-expect-error a field named by nothing announces nothing.
    const nameless = <Textarea placeholder="Tell us about yourself" />;
    expect(nameless).toBeTruthy();
  });

  test("cannot be named twice", () => {
    // @ts-expect-error `aria-label` and `aria-labelledby` are alternatives.
    const both = <Textarea aria-label="Bio" aria-labelledby="bio-label" />;
    expect(both).toBeTruthy();
  });
});
