import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupCard } from "./group-card";

/**
 * The card's category badge, and the honesty of what it wears.
 *
 * The category arrives from the API as a *name* — the route left-joins
 * `categories` for it — but the card is the last line of defence: whatever a
 * caller hands it is what the badge renders, so a raw `categoryId` reaching a
 * prop would print a database key to the reader. Same rule as the listing
 * card: a uuid-shaped category is suppressed outright, and an absent one
 * renders no badge at all.
 */
const GROUP = {
  id: "group-1",
  name: "Design & Product Makers",
  memberCount: 42,
};

describe("GroupCard's category badge", () => {
  test("renders the category name it is handed", () => {
    const html = renderToStaticMarkup(<GroupCard {...GROUP} category="Design" />);
    expect(html).toContain(">Design</div>");
  });

  test("never renders a category id, however it arrives", () => {
    const html = renderToStaticMarkup(
      <GroupCard {...GROUP} category="90000000-0000-4000-8000-000000000002" />,
    );
    expect(html).not.toContain("90000000");
  });

  test("renders no badge at all when no category name exists", () => {
    const html = renderToStaticMarkup(<GroupCard {...GROUP} />);
    expect(html).not.toContain("90000000");
    // And the badge markup is genuinely absent, not merely empty.
    expect(html).not.toContain("text-[10px]");
  });
});
