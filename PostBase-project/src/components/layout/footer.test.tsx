// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Footer } from "@/components/layout/footer";

/**
 * The footer's links, judged on the claim no route guard can make: not
 * *whether* a destination is served — that is rendered-links.test.tsx's
 * question, and these routes are all still served — but whether the product
 * still advertises it. Being reachable and being promoted are different
 * promises, and only the second one is being kept here.
 *
 * The Social surfaces came out of the chrome one rendering at a time: the
 * header first (main-nav.test.tsx), then the strip's tabs
 * (social-nav.test.tsx), and the footer was the last place Groups was still
 * being offered. A link that returns is a removal that never happened.
 */
describe("Footer", () => {
  test("still promotes the two modules that sit beside Social", () => {
    const markup = renderToStaticMarkup(<Footer />);
    for (const href of ["/marketplace", "/jobs"]) {
      expect(markup, `${href} is missing from the footer`).toContain(`href="${href}"`);
    }
  });

  test("advertises none of Social's inner surfaces, whose links were removed", () => {
    const markup = renderToStaticMarkup(<Footer />);
    for (const gone of ["/groups", "/pages", "/messages"]) {
      expect(markup, `${gone} is still in the footer`).not.toContain(`href="${gone}"`);
    }
  });
});
