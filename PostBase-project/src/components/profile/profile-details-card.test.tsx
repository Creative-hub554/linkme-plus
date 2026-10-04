// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { ProfileDetailsCard, type ProfileDetailsData } from "@/components/profile/profile-details-card";

/**
 * The intro card, one case per row it can show or hide.
 *
 * It is presentational, so the subject is exactly which rows render for which
 * fields: a missing bio says so rather than rendering nothing, the counts are
 * formatted, a website is shown without its scheme, and the friends block — its
 * header, the singular/plural label and the "more than shown" wording — appears
 * only when there are friends.
 */
function render(details: ProfileDetailsData) {
  return mountSurface(<ProfileDetailsCard details={details} />, { providers: "none" });
}

afterEach(() => {
  cleanupSurfaces();
});

describe("ProfileDetailsCard", () => {
  test("shows every row a full profile supplies", () => {
    const ui = render({
      bio: "Designer and maker.",
      location: "Singapore",
      work: "Northwind Studio",
      education: "NUS",
      website: "https://maya.example",
      joinedAt: "2020-03-01T00:00:00.000Z",
      followersCount: 1234,
      followingCount: 56,
      skills: ["Figma", "TypeScript", "Illustration", "Branding", "Motion", "CSS", "Copy"],
      mutualFriends: [
        { id: "f1", name: "Alex" },
        { id: "f2", name: "Bea" },
      ],
    });
    const text = ui.container.textContent ?? "";
    expect(text).toContain("Designer and maker.");
    expect(text).toContain("Northwind Studio");
    expect(text).toContain("NUS");
    expect(text).toContain("Singapore");
    expect(text).toContain("Joined");
    expect(text).toContain("1,234");
    expect(text).toContain("56");
    // The scheme is stripped from the link's visible text.
    expect(text).toContain("maya.example");
    expect(text).not.toContain("https://maya.example");
    // Only the first six skills are worn; the seventh is dropped.
    expect(text).toContain("CSS");
    expect(text).not.toContain("Copy");
    expect(text).toContain("Friends");
    expect(text).toContain("2 friends");
  });

  test("says there is no bio rather than leaving the section blank", () => {
    const ui = render({ followersCount: 0, followingCount: 0 });
    expect(ui.container.textContent).toContain("No bio yet.");
    expect(ui.container.textContent).not.toContain("Friends");
  });

  test("stands alone for a single friend", () => {
    const ui = render({
      followersCount: 1,
      followingCount: 0,
      mutualFriends: [{ id: "f1", name: "alex" }],
    });
    expect(ui.container.textContent).toContain("1 friend");
    expect(ui.container.textContent).not.toContain("1 friends");
  });

  test("says when more friends exist than are shown", () => {
    const ui = render({
      followersCount: 0,
      followingCount: 0,
      mutualFriends: [{ id: "f1", name: "Alex" }],
      mutualFriendsCount: 42,
    });
    expect(ui.container.textContent).toContain("42 friends");
  });

  test("renders an empty skills list as no rows at all", () => {
    const ui = render({ followersCount: 0, followingCount: 0, skills: [] });
    expect(ui.container.textContent).not.toContain("Figma");
  });
});
