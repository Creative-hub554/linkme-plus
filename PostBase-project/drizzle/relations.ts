import { relations } from "drizzle-orm/relations";
import { users, accounts, adCampaigns, adPlacements, blocks, boostedPostCampaigns, posts, comments, pages, companies, conversations, conversationMembers, coverVideos, follows, groups, groupMembers, marketplaceListings, inventoryItems, inventoryMovements, productVariants, promotedListingCampaigns, reactions, profiles, storefronts, adCreatives, adMetrics, jobs, jobApplications, listingMedia, messages, moderationActions, notifications, pageRoles, postMedia, reports, savedItems, sessions, shortVideoCovers, savedListings } from "./schema";

export const accountsRelations = relations(accounts, ({one}) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	accounts: many(accounts),
	adCampaigns: many(adCampaigns),
	blocks_blockedId: many(blocks, {
		relationName: "blocks_blockedId_users_id"
	}),
	blocks_blockerId: many(blocks, {
		relationName: "blocks_blockerId_users_id"
	}),
	comments: many(comments),
	conversationMembers: many(conversationMembers),
	coverVideos: many(coverVideos),
	follows_followerId: many(follows, {
		relationName: "follows_followerId_users_id"
	}),
	follows_followingId: many(follows, {
		relationName: "follows_followingId_users_id"
	}),
	groupMembers: many(groupMembers),
	reactions: many(reactions),
	profiles: many(profiles),
	storefronts: many(storefronts),
	jobApplications: many(jobApplications),
	marketplaceListings: many(marketplaceListings),
	messages: many(messages),
	moderationActions: many(moderationActions),
	notifications: many(notifications),
	pageRoles: many(pageRoles),
	posts: many(posts),
	reports: many(reports),
	savedItems: many(savedItems),
	sessions: many(sessions),
	shortVideoCovers: many(shortVideoCovers),
	savedListings: many(savedListings),
}));

export const adCampaignsRelations = relations(adCampaigns, ({one, many}) => ({
	user: one(users, {
		fields: [adCampaigns.advertiserId],
		references: [users.id]
	}),
	adPlacement: one(adPlacements, {
		fields: [adCampaigns.placementId],
		references: [adPlacements.id]
	}),
	boostedPostCampaigns: many(boostedPostCampaigns),
	promotedListingCampaigns: many(promotedListingCampaigns),
	adCreatives: many(adCreatives),
	adMetrics: many(adMetrics),
}));

export const adPlacementsRelations = relations(adPlacements, ({many}) => ({
	adCampaigns: many(adCampaigns),
}));

export const blocksRelations = relations(blocks, ({one}) => ({
	user_blockedId: one(users, {
		fields: [blocks.blockedId],
		references: [users.id],
		relationName: "blocks_blockedId_users_id"
	}),
	user_blockerId: one(users, {
		fields: [blocks.blockerId],
		references: [users.id],
		relationName: "blocks_blockerId_users_id"
	}),
}));

export const boostedPostCampaignsRelations = relations(boostedPostCampaigns, ({one}) => ({
	adCampaign: one(adCampaigns, {
		fields: [boostedPostCampaigns.campaignId],
		references: [adCampaigns.id]
	}),
	post: one(posts, {
		fields: [boostedPostCampaigns.postId],
		references: [posts.id]
	}),
}));

export const postsRelations = relations(posts, ({one, many}) => ({
	boostedPostCampaigns: many(boostedPostCampaigns),
	comments: many(comments),
	postMedias: many(postMedia),
	user: one(users, {
		fields: [posts.authorId],
		references: [users.id]
	}),
}));

export const commentsRelations = relations(comments, ({one}) => ({
	user: one(users, {
		fields: [comments.authorId],
		references: [users.id]
	}),
	post: one(posts, {
		fields: [comments.postId],
		references: [posts.id]
	}),
}));

export const companiesRelations = relations(companies, ({one, many}) => ({
	page: one(pages, {
		fields: [companies.pageId],
		references: [pages.id]
	}),
	jobs: many(jobs),
}));

export const pagesRelations = relations(pages, ({many}) => ({
	companies: many(companies),
	pageRoles: many(pageRoles),
}));

export const conversationMembersRelations = relations(conversationMembers, ({one}) => ({
	conversation: one(conversations, {
		fields: [conversationMembers.conversationId],
		references: [conversations.id]
	}),
	user: one(users, {
		fields: [conversationMembers.userId],
		references: [users.id]
	}),
}));

export const conversationsRelations = relations(conversations, ({many}) => ({
	conversationMembers: many(conversationMembers),
	messages: many(messages),
}));

export const coverVideosRelations = relations(coverVideos, ({one}) => ({
	user: one(users, {
		fields: [coverVideos.userId],
		references: [users.id]
	}),
}));

export const followsRelations = relations(follows, ({one}) => ({
	user_followerId: one(users, {
		fields: [follows.followerId],
		references: [users.id],
		relationName: "follows_followerId_users_id"
	}),
	user_followingId: one(users, {
		fields: [follows.followingId],
		references: [users.id],
		relationName: "follows_followingId_users_id"
	}),
}));

export const groupMembersRelations = relations(groupMembers, ({one}) => ({
	group: one(groups, {
		fields: [groupMembers.groupId],
		references: [groups.id]
	}),
	user: one(users, {
		fields: [groupMembers.userId],
		references: [users.id]
	}),
}));

export const groupsRelations = relations(groups, ({many}) => ({
	groupMembers: many(groupMembers),
}));

export const inventoryItemsRelations = relations(inventoryItems, ({one, many}) => ({
	marketplaceListing: one(marketplaceListings, {
		fields: [inventoryItems.listingId],
		references: [marketplaceListings.id]
	}),
	inventoryMovements: many(inventoryMovements),
}));

export const marketplaceListingsRelations = relations(marketplaceListings, ({one, many}) => ({
	inventoryItems: many(inventoryItems),
	productVariants: many(productVariants),
	promotedListingCampaigns: many(promotedListingCampaigns),
	listingMedias: many(listingMedia),
	user: one(users, {
		fields: [marketplaceListings.sellerId],
		references: [users.id]
	}),
	savedListings: many(savedListings),
}));

export const inventoryMovementsRelations = relations(inventoryMovements, ({one}) => ({
	inventoryItem: one(inventoryItems, {
		fields: [inventoryMovements.inventoryId],
		references: [inventoryItems.id]
	}),
}));

export const productVariantsRelations = relations(productVariants, ({one}) => ({
	marketplaceListing: one(marketplaceListings, {
		fields: [productVariants.listingId],
		references: [marketplaceListings.id]
	}),
}));

export const promotedListingCampaignsRelations = relations(promotedListingCampaigns, ({one}) => ({
	adCampaign: one(adCampaigns, {
		fields: [promotedListingCampaigns.campaignId],
		references: [adCampaigns.id]
	}),
	marketplaceListing: one(marketplaceListings, {
		fields: [promotedListingCampaigns.listingId],
		references: [marketplaceListings.id]
	}),
}));

export const reactionsRelations = relations(reactions, ({one}) => ({
	user: one(users, {
		fields: [reactions.userId],
		references: [users.id]
	}),
}));

export const profilesRelations = relations(profiles, ({one}) => ({
	user: one(users, {
		fields: [profiles.userId],
		references: [users.id]
	}),
}));

export const storefrontsRelations = relations(storefronts, ({one}) => ({
	user: one(users, {
		fields: [storefronts.sellerId],
		references: [users.id]
	}),
}));

export const adCreativesRelations = relations(adCreatives, ({one}) => ({
	adCampaign: one(adCampaigns, {
		fields: [adCreatives.campaignId],
		references: [adCampaigns.id]
	}),
}));

export const adMetricsRelations = relations(adMetrics, ({one}) => ({
	adCampaign: one(adCampaigns, {
		fields: [adMetrics.campaignId],
		references: [adCampaigns.id]
	}),
}));

export const jobApplicationsRelations = relations(jobApplications, ({one}) => ({
	job: one(jobs, {
		fields: [jobApplications.jobId],
		references: [jobs.id]
	}),
	user: one(users, {
		fields: [jobApplications.userId],
		references: [users.id]
	}),
}));

export const jobsRelations = relations(jobs, ({one, many}) => ({
	jobApplications: many(jobApplications),
	company: one(companies, {
		fields: [jobs.companyId],
		references: [companies.id]
	}),
}));

export const listingMediaRelations = relations(listingMedia, ({one}) => ({
	marketplaceListing: one(marketplaceListings, {
		fields: [listingMedia.listingId],
		references: [marketplaceListings.id]
	}),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	}),
	user: one(users, {
		fields: [messages.senderId],
		references: [users.id]
	}),
}));

export const moderationActionsRelations = relations(moderationActions, ({one}) => ({
	user: one(users, {
		fields: [moderationActions.actorId],
		references: [users.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const pageRolesRelations = relations(pageRoles, ({one}) => ({
	page: one(pages, {
		fields: [pageRoles.pageId],
		references: [pages.id]
	}),
	user: one(users, {
		fields: [pageRoles.userId],
		references: [users.id]
	}),
}));

export const postMediaRelations = relations(postMedia, ({one}) => ({
	post: one(posts, {
		fields: [postMedia.postId],
		references: [posts.id]
	}),
}));

export const reportsRelations = relations(reports, ({one}) => ({
	user: one(users, {
		fields: [reports.reporterId],
		references: [users.id]
	}),
}));

export const savedItemsRelations = relations(savedItems, ({one}) => ({
	user: one(users, {
		fields: [savedItems.userId],
		references: [users.id]
	}),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const shortVideoCoversRelations = relations(shortVideoCovers, ({one}) => ({
	user: one(users, {
		fields: [shortVideoCovers.userId],
		references: [users.id]
	}),
}));

export const savedListingsRelations = relations(savedListings, ({one}) => ({
	marketplaceListing: one(marketplaceListings, {
		fields: [savedListings.listingId],
		references: [marketplaceListings.id]
	}),
	user: one(users, {
		fields: [savedListings.userId],
		references: [users.id]
	}),
}));