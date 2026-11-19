export const feedTopics = [
  { id: "comedy", en: "Comedy & Fun", km: "កំប្លែង និងភាពសប្បាយ" },
  { id: "news", en: "News & Updates", km: "ព័ត៌មាន និងបច្ចុប្បន្នភាព" },
  { id: "education", en: "How-to & Education", km: "របៀបធ្វើ និងការអប់រំ" },
  { id: "food", en: "Food", km: "អាហារ" },
  { id: "lifestyle", en: "Lifestyle", km: "របៀបរស់នៅ" },
  { id: "technology", en: "Technology", km: "បច្ចេកវិទ្យា" },
  { id: "business", en: "Business & Jobs", km: "អាជីវកម្ម និងការងារ" },
  { id: "shopping", en: "Shopping", km: "ការទិញទំនិញ" },
  { id: "entertainment", en: "Arts & Entertainment", km: "សិល្បៈ និងការកម្សាន្ត" },
  { id: "community", en: "Community", km: "សហគមន៍" },
] as const;
export type FeedTopicId = typeof feedTopics[number]["id"];
export function isFeedTopic(value: unknown): value is FeedTopicId {
  return typeof value === "string" && feedTopics.some(topic => topic.id === value);
}
export interface FeedPreferences { topics: FeedTopicId[]; format: "all" | "posts" | "shorts" }
export const defaultFeedPreferences: FeedPreferences = { topics: [], format: "all" };
// An empty array deliberately means All topics, including legacy uncategorized posts.
export function parseFeedPreferences(value: unknown): FeedPreferences | null {
  if (!value || typeof value !== "object") return null;
  const { topics, format } = value as Record<string, unknown>;
  if (!Array.isArray(topics) || topics.length > feedTopics.length || !topics.every(isFeedTopic)) return null;
  if (format !== "all" && format !== "posts" && format !== "shorts") return null;
  return { topics: [...new Set(topics)].sort(), format };
}
export function feedPreferenceScope(value: FeedPreferences): string {
  return `${value.format}:${[...value.topics].sort().join(",")}`;
}
