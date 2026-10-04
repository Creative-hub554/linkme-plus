import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { postAudiences } from "@/lib/post-audiences";
// Type-only, and erased at build time: the accent's allowed values are the ones
// the picker offers, and `profiles.appearance` is typed by that same union so
// the two cannot drift. (`postAudiences` above is the same idea, imported as a
// value because the enum is built from it at runtime.)
import type { Accent } from "@/lib/theme";

// The audience list lives in `@/lib/post-audiences`; the column is built from it
// so the database cannot hold an audience the rule does not describe.
//
// One set of values, three meanings: `profiles.visibility` is whether a member
// is listed in discovery, `posts.visibility` is who may read a post, and
// `groups.visibility` is whether a group is listed. Only the post meaning is
// named and described in that module; the other two keep their own labels.
export const visibilityEnum = pgEnum("visibility", postAudiences);
export const userRoleEnum = pgEnum("user_role", ["member", "admin", "moderator"]);
export const postTypeEnum = pgEnum("post_type", ["text", "image", "video", "short_video"]);
export const listingStatusEnum = pgEnum("listing_status", ["draft", "active", "reserved", "sold", "expired", "removed"]);
export const jobStatusEnum = pgEnum("job_status", ["draft", "active", "closed", "archived"]);
export const applicationStatusEnum = pgEnum("application_status", ["pending", "reviewing", "shortlisted", "rejected", "hired"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "pending_payment", "pending_review", "approved", "scheduled", "active", "paused", "rejected", "completed", "cancelled", "refunded"]);
export const reportStatusEnum = pgEnum("report_status", ["pending", "reviewing", "resolved", "dismissed"]);
export const moderationActionEnum = pgEnum("moderation_action", ["warning", "removal", "suspension", "ban"]);
export const coverVideoStatusEnum = pgEnum("cover_video_status", ["pending", "rendering", "ready", "failed"]);

// ─── Users & Auth ───────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"),
  username: varchar("username", { length: 30 }).notNull().unique(),
  role: userRoleEnum("role").default("member").notNull(),
  emailVerified: timestamp("email_verified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 255 }).notNull(),
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
  refreshToken: text("refresh_token"),
  accessToken: text("access_token"),
  expiresAt: integer("expires_at"),
  tokenType: varchar("token_type", { length: 255 }),
  scope: varchar("scope", { length: 255 }),
  idToken: text("id_token"),
  sessionState: varchar("session_state", { length: 255 }),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionToken: varchar("session_token", { length: 255 }).notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires").notNull(),
});

// ─── Profiles ───────────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  displayName: varchar("display_name", { length: 50 }).notNull(),
  avatarUrl: text("avatar_url"),
  coverUrl: text("cover_url"),
  coverVideoUrl: text("cover_video_url"),
  coverConfig: jsonb("cover_config"),
  shortVideoCoverUrl: text("short_video_cover_url"),
  shortVideoCoverConfig: jsonb("short_video_cover_config"),
  bio: text("bio"),
  location: varchar("location", { length: 100 }),
  work: varchar("work", { length: 120 }),
  education: varchar("education", { length: 120 }),
  website: text("website"),
  skills: text("skills").array(),
  contactPreferences: jsonb("contact_preferences").$type<{ contactEmail?: string | null; contactPhone?: string | null }>(),
  /**
   * Display preferences that belong to the *account* rather than to a device.
   *
   * The accent is the whole of it today. Deliberately not the light/dark
   * choice: that belongs to the light you are reading in, so it stays in the
   * browser, while the accent is identity and should follow the person to a new
   * machine. The value is the same `Accent` union the picker offers, typed from
   * `@/lib/theme` so there is one list of allowed accents rather than two.
   *
   * A JSONB object rather than a column per preference, so a second preference
   * is a code change and not a migration — the same reason
   * `contactPreferences` is one.
   */
  appearance: jsonb("appearance").$type<{ accent?: Accent }>(),
  visibility: visibilityEnum("visibility").default("public").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Social ─────────────────────────────────────────────────────
export const follows = pgTable("follows", {
  id: uuid("id").defaultRandom().primaryKey(),
  followerId: uuid("follower_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  followingId: uuid("following_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blocks = pgTable("blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  blockerId: uuid("blocker_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  blockedId: uuid("blocked_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  pageId: uuid("page_id"),
  groupId: uuid("group_id"),
  type: postTypeEnum("type").default("text").notNull(),
  content: text("content"),
  visibility: visibilityEnum("visibility").default("public").notNull(),
  hashtags: text("hashtags").array(),
  mentions: text("mentions").array(),
  editedAt: timestamp("edited_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const postMedia = pgTable("post_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  altText: varchar("alt_text", { length: 255 }),
  type: varchar("type", { length: 20 }).notNull(),
  order: integer("order").default(0),
  processingStatus: varchar("processing_status", { length: 20 }).default("ready"),
});

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  content: text("content").notNull(),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reactions = pgTable("reactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  targetType: varchar("target_type", { length: 20 }).notNull(),
  targetId: uuid("target_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const savedItems = pgTable("saved_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetType: varchar("target_type", { length: 20 }).notNull(),
  targetId: uuid("target_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 30 }).notNull(),
  sourceUserId: uuid("source_user_id"),
  targetType: varchar("target_type", { length: 20 }),
  targetId: uuid("target_id"),
  /** Composed by the `notification_message` SQL helper, so API and push agree. */
  message: text("message"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Communities ─────────────────────────────────────────────────
export const pages = pgTable("pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: varchar("username", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  categoryId: uuid("category_id"),
  description: text("description"),
  avatarUrl: text("avatar_url"),
  coverUrl: text("cover_url"),
  contactDetails: jsonb("contact_details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pageRoles = pgTable("page_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  pageId: uuid("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Who follows a Page.
 *
 * Its own table rather than a row in `follows`, and the reason is the foreign
 * key that `follows` cannot express: `follows.following_id` references
 * `users.id`, so a Page has no id it could hold. Reusing it would mean either
 * dropping the constraint or storing a Page's id in a column that promises a
 * user — and the first version of `/api/pages` did exactly the second, counting
 * "followers" with `follows.following_id = page.id`, which can only ever be
 * zero. A Page is a different kind of thing from a member, so following one is
 * a different kind of row; `saved_items` and `saved_listings` are split the same
 * way.
 *
 * `(page_id, user_id)` is unique so a double-tap cannot hold two rows — the
 * insert is `onConflictDoNothing` and the counter is a `COUNT`, so a duplicate
 * would both inflate the number and survive an unfollow.
 */
export const pageFollows = pgTable("page_follows", {
  id: uuid("id").defaultRandom().primaryKey(),
  pageId: uuid("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  categoryId: uuid("category_id"),
  coverUrl: text("cover_url"),
  visibility: visibilityEnum("visibility").default("public").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groupMembers = pgTable("group_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).default("member"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

// ─── Marketplace ────────────────────────────────────────────────
export const marketplaceListings = pgTable("marketplace_listings", {
  id: uuid("id").defaultRandom().primaryKey(),
  sellerId: uuid("seller_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  categoryId: uuid("category_id"),
  priceMin: integer("price_min"),
  priceMax: integer("price_max"),
  condition: varchar("condition", { length: 50 }),
  location: varchar("location", { length: 100 }),
  status: listingStatusEnum("status").default("draft").notNull(),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const savedListings = pgTable("saved_listings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => marketplaceListings.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const listingMedia = pgTable("listing_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => marketplaceListings.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  altText: varchar("alt_text", { length: 255 }),
  order: integer("order").default(0),
});

export const productVariants = pgTable("product_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => marketplaceListings.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  sku: varchar("sku", { length: 50 }),
  price: integer("price").notNull(),
  stockQuantity: integer("stock_quantity").default(0),
  imageUrl: text("image_url"),
});

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => marketplaceListings.id, { onDelete: "cascade" }),
  quantity: integer("quantity").default(0),
  sku: varchar("sku", { length: 50 }),
  unitCost: integer("unit_cost"),
  lowStockThreshold: integer("low_stock_threshold").default(5),
});

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  inventoryId: uuid("inventory_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id"),
  type: varchar("type", { length: 20 }).notNull(),
  quantity: integer("quantity").notNull(),
  reason: varchar("reason", { length: 100 }),
  actorId: uuid("actor_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const storefronts = pgTable("storefronts", {
  id: uuid("id").defaultRandom().primaryKey(),
  sellerId: uuid("seller_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  avatarUrl: text("avatar_url"),
  coverUrl: text("cover_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Jobs ───────────────────────────────────────────────────────
export const companies = pgTable("companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  pageId: uuid("page_id").references(() => pages.id),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  website: text("website"),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  location: varchar("location", { length: 100 }),
  remoteStatus: varchar("remote_status", { length: 30 }),
  jobType: varchar("job_type", { length: 30 }),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  description: text("description"),
  requirements: text("requirements"),
  skills: text("skills").array(),
  status: jobStatusEnum("status").default("draft").notNull(),
  deadline: timestamp("deadline"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const jobApplications = pgTable("job_applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  coverLetter: text("cover_letter"),
  cvUrl: text("cv_url"),
  status: applicationStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Advertising ────────────────────────────────────────────────
export const adPlacements = pgTable("ad_placements", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  location: varchar("location", { length: 100 }).notNull(),
  format: varchar("format", { length: 50 }).notNull(),
  maxActive: integer("max_active").default(1),
  priceCpm: integer("price_cpm"),
});

export const adCampaigns = pgTable("ad_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  advertiserId: uuid("advertiser_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 30 }).notNull(),
  placementId: uuid("placement_id").references(() => adPlacements.id),
  status: campaignStatusEnum("status").default("draft").notNull(),
  budget: integer("budget").notNull(),
  spent: integer("spent").default(0),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  targetLocation: varchar("target_location", { length: 100 }),
  targetCategories: text("target_categories").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adCreatives = pgTable("ad_creatives", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => adCampaigns.id, { onDelete: "cascade" }),
  headline: varchar("headline", { length: 200 }),
  imageUrl: text("image_url"),
  destinationUrl: text("destination_url"),
  altText: varchar("alt_text", { length: 255 }),
  ctaText: varchar("cta_text", { length: 50 }),
  status: varchar("status", { length: 20 }).default("pending"),
});

export const adMetrics = pgTable("ad_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => adCampaigns.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  uniqueReach: integer("unique_reach").default(0),
});

export const promotedListingCampaigns = pgTable("promoted_listing_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => adCampaigns.id, { onDelete: "cascade" }),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => marketplaceListings.id, { onDelete: "cascade" }),
});

export const boostedPostCampaigns = pgTable("boosted_post_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => adCampaigns.id, { onDelete: "cascade" }),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  goal: varchar("goal", { length: 30 }),
});

// ─── Trust & Safety ─────────────────────────────────────────────
export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetType: varchar("target_type", { length: 20 }).notNull(),
  targetId: uuid("target_id").notNull(),
  reason: varchar("reason", { length: 50 }).notNull(),
  description: text("description"),
  status: reportStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const moderationActions = pgTable("moderation_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  targetType: varchar("target_type", { length: 20 }).notNull(),
  targetId: uuid("target_id").notNull(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: moderationActionEnum("action").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id"),
  action: varchar("action", { length: 50 }).notNull(),
  targetType: varchar("target_type", { length: 20 }),
  targetId: uuid("target_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Messaging ──────────────────────────────────────────────────
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversationMembers = pgTable("conversation_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at"),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Cover Videos ───────────────────────────────────────────────
export const coverVideos = pgTable("cover_videos", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  templateId: varchar("template_id", { length: 50 }).notNull(),
  customization: jsonb("customization").notNull(),
  status: coverVideoStatusEnum("status").default("pending").notNull(),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const shortVideoCovers = pgTable("short_video_covers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  templateId: varchar("template_id", { length: 30 }).notNull(),
  speed: varchar("speed", { length: 10 }).notNull(),
  duration: integer("duration").notNull(),
  aspectRatio: varchar("aspect_ratio", { length: 10 }).notNull(),
  subtitle: text("subtitle"),
  productLabel: varchar("product_label", { length: 60 }),
  productUrl: text("product_url"),
  profilePhotoUrl: text("profile_photo_url").notNull(),
  backgroundVideoUrl: text("background_video_url"),
  backgroundPhotoUrl: text("background_photo_url"),
  /** the uploaded pictures that build the animated background wall */
  photoUrls: text("photo_urls").array(),
  /** the rendered short video that plays as the profile cover */
  videoUrl: text("video_url"),
  profileOffsetX: integer("profile_offset_x").default(0).notNull(),
  profileOffsetY: integer("profile_offset_y").default(0).notNull(),
  profileRadius: integer("profile_radius").default(180).notNull(),
  status: varchar("status", { length: 20 }).default("ready").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Categories ─────────────────────────────────────────────────
export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  parentId: uuid("parent_id"),
  type: varchar("type", { length: 30 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
