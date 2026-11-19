import { expect, test } from "vitest";
import { feedTopics, parseFeedPreferences, isFeedTopic, feedPreferenceScope } from "./feed-topics";
test("ten bilingual topics have unique stable identifiers", () => {
  expect(feedTopics).toHaveLength(10);
  expect(new Set(feedTopics.map(topic => topic.id)).size).toBe(10);
  expect(feedTopics.every(topic => topic.en && topic.km)).toBe(true);
});
test("preferences reject unknown categories, malformed formats, and unbounded input", () => {
  expect(isFeedTopic("adult")).toBe(false);
  expect(parseFeedPreferences({ topics: ["invalid"], format: "all" })).toBeNull();
  expect(parseFeedPreferences({ topics: [], format: "videos" })).toBeNull();
  expect(parseFeedPreferences({ topics: "news", format: "all" })).toBeNull();
});
test("All topics includes legacy content and scopes are independent of selection order", () => {
  expect(parseFeedPreferences({ topics: [], format: "all" })).toEqual({ topics: [], format: "all" });
  const preferences = parseFeedPreferences({ topics: ["news", "comedy", "news"], format: "posts" })!;
  expect(preferences.topics).toEqual(["comedy", "news"]);
  expect(feedPreferenceScope(preferences)).toBe("posts:comedy,news");
});
