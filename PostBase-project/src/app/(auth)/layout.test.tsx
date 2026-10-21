import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AuthLayout from "./layout";

/**
 * The auth route group's layout is an explicit *nothing*: the shell around a
 * sign-in screen is the page's own `AuthShell`, not the app's chrome. These
 * cases pin that, so a future edit cannot quietly re-introduce a header or a
 * provider above the login and register pages — the separation is a decision,
 * and this layout is the decision's implementation.
 */
describe("the auth layout", () => {
  it("renders the children and nothing around them", () => {
    const html = renderToStaticMarkup(<AuthLayout><p>sign-in form</p></AuthLayout>);

    expect(html).toContain("<p>sign-in form</p>");
    expect(html).not.toContain("<main");
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<footer");
  });
});
