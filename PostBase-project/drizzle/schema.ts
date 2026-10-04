import { pgTable, uuid, varchar, jsonb, timestamp, unique, foreignKey, text, integer, pgEnum } from "drizzle-orm/pg-core"

export const applicationStatus = pgEnum("application_status", ['pending', 'reviewing', 'shortlisted', 'rejected', 'hired'])
export const campaignStatus = pgEnum("campaign_status", ['draft', 'pending_payment', 'pending_review', 'approved', 'scheduled', 'active', 'paused', 'rejected', 'completed', 'cancelled', 'refunded'])
export const coverVideoStatus = pgEnum("cover_video_status", ['pending', 'rendering', 'ready', 'failed'])
export const jobStatus = pgEnum("job_status", ['draft', 'active', 'closed', 'archived'])
export const listingStatus = pgEnum("listing_status", ['draft', 'active', 'reserved', 'sold', 'expired', 'removed'])
export const moderationAction = pgEnum("moderation_action", ['warning', 'removal', 'suspension', 'ban'])
export const postType = pgEnum("post_type", ['text', 'image', 'video', 'short_video'])
export const reportStatus = pgEnum("report_status", ['pending', 'reviewing', 'resolved', 'dismissed'])
export const userRole = pgEnum("user_role", ['member', 'admin', 'moderator'])
export const visibility = pgEnum("visibility", ['public', 'followers', 'private'])


export const auditLogs = pgTable("audit_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	actorId: uuid("actor_id"),
	action: varchar({ length: 50 }).notNull(),
	targetType: varchar("target_type", { length: 20 }),
	targetId: uuid("target_id"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const categories = pgTable("categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	slug: varchar({ length: 100 }).notNull(),
	parentId: uuid("parent_id"),
	type: varchar({ length: 30 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("categories_slug_unique").on(table.slug),
]);

export const accounts = pgTable("accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: varchar({ length: 255 }).notNull(),
	provider: varchar({ length: 255 }).notNull(),
	providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
	refreshToken: text("refresh_token"),
	accessToken: text("access_token"),
	expiresAt: integer("expires_at"),
	tokenType: varchar("token_type", { length: 255 }),
	scope: varchar({ length: 255 }),
	idToken: text("id_token"),
	sessionState: varchar("session_state", { length: 255 }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "accounts_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const adCampaigns = pgTable("ad_campaigns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	advertiserId: uuid("advertiser_id").notNull(),
	type: varchar({ length: 30 }).notNull(),
	placementId: uuid("placement_id"),
	status: campaignStatus().default('draft').notNull(),
	budget: integer().notNull(),
	spent: integer().default(0),
	startDate: timestamp("start_date", { mode: 'string' }),
	endDate: timestamp("end_date", { mode: 'string' }),
	targetLocation: varchar("target_location", { length: 100 }),
	targetCategories: text("target_categories").array(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.advertiserId],
			foreignColumns: [users.id],
			name: "ad_campaigns_advertiser_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.placementId],
			foreignColumns: [adPlacements.id],
			name: "ad_campaigns_placement_id_ad_placements_id_fk"
		}),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: varchar({ length: 255 }).notNull(),
	passwordHash: text("password_hash"),
	username: varchar({ length: 30 }).notNull(),
	role: userRole().default('member').notNull(),
	emailVerified: timestamp("email_verified", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
}, (table) => [
	unique("users_email_unique").on(table.email),
	unique("users_username_unique").on(table.username),
]);

export const adPlacements = pgTable("ad_placements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	location: varchar({ length: 100 }).notNull(),
	format: varchar({ length: 50 }).notNull(),
	maxActive: integer("max_active").default(1),
	priceCpm: integer("price_cpm"),
});

export const blocks = pgTable("blocks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	blockerId: uuid("blocker_id").notNull(),
	blockedId: uuid("blocked_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.blockedId],
			foreignColumns: [users.id],
			name: "blocks_blocked_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.blockerId],
			foreignColumns: [users.id],
			name: "blocks_blocker_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const boostedPostCampaigns = pgTable("boosted_post_campaigns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	postId: uuid("post_id").notNull(),
	goal: varchar({ length: 30 }),
}, (table) => [
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [adCampaigns.id],
			name: "boosted_post_campaigns_campaign_id_ad_campaigns_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "boosted_post_campaigns_post_id_posts_id_fk"
		}).onDelete("cascade"),
]);

export const comments = pgTable("comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	authorId: uuid("author_id").notNull(),
	parentId: uuid("parent_id"),
	content: text().notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [users.id],
			name: "comments_author_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "comments_post_id_posts_id_fk"
		}).onDelete("cascade"),
]);

export const companies = pgTable("companies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pageId: uuid("page_id"),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	logoUrl: text("logo_url"),
	website: text(),
}, (table) => [
	foreignKey({
			columns: [table.pageId],
			foreignColumns: [pages.id],
			name: "companies_page_id_pages_id_fk"
		}),
]);

export const conversationMembers = pgTable("conversation_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull(),
	userId: uuid("user_id").notNull(),
	lastReadAt: timestamp("last_read_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "conversation_members_conversation_id_conversations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "conversation_members_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const conversations = pgTable("conversations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const coverVideos = pgTable("cover_videos", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	templateId: varchar("template_id", { length: 50 }).notNull(),
	customization: jsonb().notNull(),
	status: coverVideoStatus().default('pending').notNull(),
	videoUrl: text("video_url"),
	thumbnailUrl: text("thumbnail_url"),
	durationMs: integer("duration_ms").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "cover_videos_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const follows = pgTable("follows", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	followerId: uuid("follower_id").notNull(),
	followingId: uuid("following_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.followerId],
			foreignColumns: [users.id],
			name: "follows_follower_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.followingId],
			foreignColumns: [users.id],
			name: "follows_following_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groupMembers = pgTable("group_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	groupId: uuid("group_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: varchar({ length: 20 }).default('member'),
	joinedAt: timestamp("joined_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [groups.id],
			name: "group_members_group_id_groups_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "group_members_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const groups = pgTable("groups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	categoryId: uuid("category_id"),
	coverUrl: text("cover_url"),
	visibility: visibility().default('public').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const inventoryItems = pgTable("inventory_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	listingId: uuid("listing_id").notNull(),
	quantity: integer().default(0),
	sku: varchar({ length: 50 }),
	unitCost: integer("unit_cost"),
	lowStockThreshold: integer("low_stock_threshold").default(5),
}, (table) => [
	foreignKey({
			columns: [table.listingId],
			foreignColumns: [marketplaceListings.id],
			name: "inventory_items_listing_id_marketplace_listings_id_fk"
		}).onDelete("cascade"),
]);

export const inventoryMovements = pgTable("inventory_movements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	inventoryId: uuid("inventory_id").notNull(),
	variantId: uuid("variant_id"),
	type: varchar({ length: 20 }).notNull(),
	quantity: integer().notNull(),
	reason: varchar({ length: 100 }),
	actorId: uuid("actor_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.inventoryId],
			foreignColumns: [inventoryItems.id],
			name: "inventory_movements_inventory_id_inventory_items_id_fk"
		}).onDelete("cascade"),
]);

export const productVariants = pgTable("product_variants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	listingId: uuid("listing_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	sku: varchar({ length: 50 }),
	price: integer().notNull(),
	stockQuantity: integer("stock_quantity").default(0),
	imageUrl: text("image_url"),
}, (table) => [
	foreignKey({
			columns: [table.listingId],
			foreignColumns: [marketplaceListings.id],
			name: "product_variants_listing_id_marketplace_listings_id_fk"
		}).onDelete("cascade"),
]);

export const promotedListingCampaigns = pgTable("promoted_listing_campaigns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	listingId: uuid("listing_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [adCampaigns.id],
			name: "promoted_listing_campaigns_campaign_id_ad_campaigns_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.listingId],
			foreignColumns: [marketplaceListings.id],
			name: "promoted_listing_campaigns_listing_id_marketplace_listings_id_f"
		}).onDelete("cascade"),
]);

export const reactions = pgTable("reactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	targetType: varchar("target_type", { length: 20 }).notNull(),
	targetId: uuid("target_id").notNull(),
	userId: uuid("user_id").notNull(),
	type: varchar({ length: 20 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "reactions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const profiles = pgTable("profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	displayName: varchar("display_name", { length: 50 }).notNull(),
	avatarUrl: text("avatar_url"),
	coverUrl: text("cover_url"),
	coverVideoUrl: text("cover_video_url"),
	bio: text(),
	location: varchar({ length: 100 }),
	skills: text().array(),
	contactPreferences: jsonb("contact_preferences"),
	visibility: visibility().default('public').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	coverConfig: jsonb("cover_config"),
	shortVideoCoverUrl: text("short_video_cover_url"),
	shortVideoCoverConfig: jsonb("short_video_cover_config"),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "profiles_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("profiles_user_id_unique").on(table.userId),
]);

export const storefronts = pgTable("storefronts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sellerId: uuid("seller_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	avatarUrl: text("avatar_url"),
	coverUrl: text("cover_url"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sellerId],
			foreignColumns: [users.id],
			name: "storefronts_seller_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const adCreatives = pgTable("ad_creatives", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	headline: varchar({ length: 200 }),
	imageUrl: text("image_url"),
	destinationUrl: text("destination_url"),
	altText: varchar("alt_text", { length: 255 }),
	ctaText: varchar("cta_text", { length: 50 }),
	status: varchar({ length: 20 }).default('pending'),
}, (table) => [
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [adCampaigns.id],
			name: "ad_creatives_campaign_id_ad_campaigns_id_fk"
		}).onDelete("cascade"),
]);

export const adMetrics = pgTable("ad_metrics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	date: timestamp({ mode: 'string' }).notNull(),
	impressions: integer().default(0),
	clicks: integer().default(0),
	uniqueReach: integer("unique_reach").default(0),
}, (table) => [
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [adCampaigns.id],
			name: "ad_metrics_campaign_id_ad_campaigns_id_fk"
		}).onDelete("cascade"),
]);

export const jobApplications = pgTable("job_applications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	userId: uuid("user_id").notNull(),
	coverLetter: text("cover_letter"),
	cvUrl: text("cv_url"),
	status: applicationStatus().default('pending').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "job_applications_job_id_jobs_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "job_applications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const jobs = pgTable("jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	title: varchar({ length: 200 }).notNull(),
	location: varchar({ length: 100 }),
	remoteStatus: varchar("remote_status", { length: 30 }),
	jobType: varchar("job_type", { length: 30 }),
	salaryMin: integer("salary_min"),
	salaryMax: integer("salary_max"),
	description: text(),
	requirements: text(),
	skills: text().array(),
	status: jobStatus().default('draft').notNull(),
	deadline: timestamp({ mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.companyId],
			foreignColumns: [companies.id],
			name: "jobs_company_id_companies_id_fk"
		}).onDelete("cascade"),
]);

export const listingMedia = pgTable("listing_media", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	listingId: uuid("listing_id").notNull(),
	url: text().notNull(),
	altText: varchar("alt_text", { length: 255 }),
	order: integer().default(0),
}, (table) => [
	foreignKey({
			columns: [table.listingId],
			foreignColumns: [marketplaceListings.id],
			name: "listing_media_listing_id_marketplace_listings_id_fk"
		}).onDelete("cascade"),
]);

export const marketplaceListings = pgTable("marketplace_listings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sellerId: uuid("seller_id").notNull(),
	title: varchar({ length: 200 }).notNull(),
	description: text(),
	categoryId: uuid("category_id"),
	priceMin: integer("price_min"),
	priceMax: integer("price_max"),
	condition: varchar({ length: 50 }),
	location: varchar({ length: 100 }),
	status: listingStatus().default('draft').notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sellerId],
			foreignColumns: [users.id],
			name: "marketplace_listings_seller_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull(),
	senderId: uuid("sender_id").notNull(),
	content: text().notNull(),
	readAt: timestamp("read_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "messages_conversation_id_conversations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "messages_sender_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const moderationActions = pgTable("moderation_actions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	targetType: varchar("target_type", { length: 20 }).notNull(),
	targetId: uuid("target_id").notNull(),
	actorId: uuid("actor_id").notNull(),
	action: moderationAction().notNull(),
	reason: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [users.id],
			name: "moderation_actions_actor_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: varchar({ length: 30 }).notNull(),
	sourceUserId: uuid("source_user_id"),
	targetType: varchar("target_type", { length: 20 }),
	targetId: uuid("target_id"),
	readAt: timestamp("read_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const pageRoles = pgTable("page_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pageId: uuid("page_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: varchar({ length: 20 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.pageId],
			foreignColumns: [pages.id],
			name: "page_roles_page_id_pages_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "page_roles_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const pages = pgTable("pages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	username: varchar({ length: 30 }).notNull(),
	name: varchar({ length: 100 }).notNull(),
	categoryId: uuid("category_id"),
	description: text(),
	avatarUrl: text("avatar_url"),
	coverUrl: text("cover_url"),
	contactDetails: jsonb("contact_details"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("pages_username_unique").on(table.username),
]);

export const postMedia = pgTable("post_media", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	url: text().notNull(),
	altText: varchar("alt_text", { length: 255 }),
	type: varchar({ length: 20 }).notNull(),
	order: integer().default(0),
	processingStatus: varchar("processing_status", { length: 20 }).default('ready'),
}, (table) => [
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_media_post_id_posts_id_fk"
		}).onDelete("cascade"),
]);

export const posts = pgTable("posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	authorId: uuid("author_id").notNull(),
	pageId: uuid("page_id"),
	groupId: uuid("group_id"),
	type: postType().default('text').notNull(),
	content: text(),
	visibility: visibility().default('public').notNull(),
	hashtags: text().array(),
	mentions: text().array(),
	editedAt: timestamp("edited_at", { mode: 'string' }),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [users.id],
			name: "posts_author_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const reports = pgTable("reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reporterId: uuid("reporter_id").notNull(),
	targetType: varchar("target_type", { length: 20 }).notNull(),
	targetId: uuid("target_id").notNull(),
	reason: varchar({ length: 50 }).notNull(),
	description: text(),
	status: reportStatus().default('pending').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [users.id],
			name: "reports_reporter_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const savedItems = pgTable("saved_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	targetType: varchar("target_type", { length: 20 }).notNull(),
	targetId: uuid("target_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "saved_items_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const sessions = pgTable("sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionToken: varchar("session_token", { length: 255 }).notNull(),
	userId: uuid("user_id").notNull(),
	expires: timestamp({ mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("sessions_session_token_unique").on(table.sessionToken),
]);

export const shortVideoCovers = pgTable("short_video_covers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	templateId: varchar("template_id", { length: 30 }).notNull(),
	speed: varchar({ length: 10 }).notNull(),
	duration: integer().notNull(),
	aspectRatio: varchar("aspect_ratio", { length: 10 }).notNull(),
	subtitle: text(),
	productLabel: varchar("product_label", { length: 60 }),
	productUrl: text("product_url"),
	profilePhotoUrl: text("profile_photo_url").notNull(),
	backgroundVideoUrl: text("background_video_url"),
	backgroundPhotoUrl: text("background_photo_url"),
	status: varchar({ length: 20 }).default('ready').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	profileOffsetX: integer("profile_offset_x").default(0).notNull(),
	profileOffsetY: integer("profile_offset_y").default(0).notNull(),
	profileRadius: integer("profile_radius").default(180).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "short_video_covers_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const savedListings = pgTable("saved_listings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	listingId: uuid("listing_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.listingId],
			foreignColumns: [marketplaceListings.id],
			name: "saved_listings_listing_id_marketplace_listings_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "saved_listings_user_id_users_id_fk"
		}).onDelete("cascade"),
]);
