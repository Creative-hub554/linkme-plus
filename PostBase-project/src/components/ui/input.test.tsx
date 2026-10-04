import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "@/components/ui/input";

/**
 * A placeholder is not a name a reader can rely on — it is gone the moment the
 * field is filled — so an input has to say how it is named: its own `aria-label`,
 * a reference to text elsewhere, or an `id` a `<Label htmlFor>` points at. The
 * bare `<Input />` that shipped in several search fields does not compile.
 */
describe("Input", () => {
  test("carries the name it is given", () => {
    const html = renderToStaticMarkup(<Input aria-label="Email address" />);
    expect(html).toContain('aria-label="Email address"');
  });

  test("can be named by a label's `for` instead", () => {
    const html = renderToStaticMarkup(<Input id="email" />);
    expect(html).toContain('id="email"');
  });

  test("cannot be written without a way to be named", () => {
    // @ts-expect-error a field named by nothing announces nothing.
    const nameless = <Input placeholder="Email address" />;
    expect(nameless).toBeTruthy();
  });

  test("cannot be named twice", () => {
    // @ts-expect-error `aria-label` and `aria-labelledby` are alternatives.
    const both = <Input aria-label="Email" aria-labelledby="email-label" />;
    expect(both).toBeTruthy();
  });
});
