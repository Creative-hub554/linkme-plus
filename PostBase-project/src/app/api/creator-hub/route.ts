import { and, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { db } from "@/lib/db";
import { getActiveCreatorMembership } from "@/lib/db/creator-boost";
import {
  creatorCollaborations,
  creatorCommunities,
  creatorSupportTickets,
  follows,
  groupMembers,
  groups,
  notifications,
  posts,
  profiles,
  reactions,
  scheduledCreatorPosts,
  users,
} from "@/lib/db/schema";

const MAX_SCHEDULE_DAYS = 90;

function thirtyDaysAgo(now: Date) {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

async function requireCreator(userId: string) {
  return getActiveCreatorMembership(userId);
}

/** The active creator's dashboard and private operational tools. */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const membership = await requireCreator(session.user.id);
    if (!membership) return errorResponse("An active Creator Boost benefit is required", 403);

    const now = new Date();
    const periodStart = thirtyDaysAgo(now);
    const [recentPosts, periodPosts, scheduledPosts, communities, supportTickets, [{ followers }], profile] = await Promise.all([
      db
        .select({ id: posts.id, content: posts.content, createdAt: posts.createdAt, visibility: posts.visibility })
        .from(posts)
        .where(and(eq(posts.authorId, session.user.id), isNull(posts.deletedAt)))
        .orderBy(desc(posts.createdAt))
        .limit(8),
      db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.authorId, session.user.id), isNull(posts.deletedAt), gte(posts.createdAt, periodStart))),
      db
        .select({ id: scheduledCreatorPosts.id, content: scheduledCreatorPosts.content, scheduledFor: scheduledCreatorPosts.scheduledFor, status: scheduledCreatorPosts.status, failureReason: scheduledCreatorPosts.failureReason })
        .from(scheduledCreatorPosts)
        .where(eq(scheduledCreatorPosts.creatorId, session.user.id))
        .orderBy(desc(scheduledCreatorPosts.scheduledFor))
        .limit(8),
      db
        .select({ id: creatorCommunities.id, groupId: groups.id, name: groups.name, visibility: groups.visibility, createdAt: creatorCommunities.createdAt })
        .from(creatorCommunities)
        .innerJoin(groups, eq(creatorCommunities.groupId, groups.id))
        .where(eq(creatorCommunities.creatorId, session.user.id))
        .orderBy(desc(creatorCommunities.createdAt)),
      db
        .select({ id: creatorSupportTickets.id, subject: creatorSupportTickets.subject, status: creatorSupportTickets.status, createdAt: creatorSupportTickets.createdAt })
        .from(creatorSupportTickets)
        .where(eq(creatorSupportTickets.creatorId, session.user.id))
        .orderBy(desc(creatorSupportTickets.createdAt))
        .limit(5),
      db.select({ followers: count() }).from(follows).where(eq(follows.followingId, session.user.id)),
      db.select({ creatorSpotlightPostId: profiles.creatorSpotlightPostId }).from(profiles).where(eq(profiles.userId, session.user.id)).then(([row]) => row),
    ]);
    const postIds = periodPosts.map((post) => post.id);
    const [[{ postsLast30Days }], [{ likesLast30Days }], collaborations, incomingCollaborations] = await Promise.all([
      Promise.resolve([{ postsLast30Days: periodPosts.length }]),
      postIds.length
        ? db.select({ likesLast30Days: count() }).from(reactions).where(and(eq(reactions.targetType, "post"), eq(reactions.type, "like"), inArray(reactions.targetId, postIds), gte(reactions.createdAt, periodStart)))
        : Promise.resolve([{ likesLast30Days: 0 }]),
      db
        .select({ id: creatorCollaborations.id, postId: creatorCollaborations.postId, status: creatorCollaborations.status, collaborator: users.username, createdAt: creatorCollaborations.createdAt })
        .from(creatorCollaborations)
        .innerJoin(users, eq(creatorCollaborations.collaboratorId, users.id))
        .where(eq(creatorCollaborations.creatorId, session.user.id))
        .orderBy(desc(creatorCollaborations.createdAt))
        .limit(8),
      db
        .select({ id: creatorCollaborations.id, postId: creatorCollaborations.postId, status: creatorCollaborations.status, creator: users.username, createdAt: creatorCollaborations.createdAt })
        .from(creatorCollaborations)
        .innerJoin(users, eq(creatorCollaborations.creatorId, users.id))
        .where(and(eq(creatorCollaborations.collaboratorId, session.user.id), eq(creatorCollaborations.status, "pending")))
        .orderBy(desc(creatorCollaborations.createdAt))
        .limit(8),
    ]);

    return successResponse({
      membership,
      analytics: { followers: Number(followers ?? 0), postsLast30Days: Number(postsLast30Days ?? 0), likesLast30Days: Number(likesLast30Days ?? 0) },
      spotlightPostId: profile?.creatorSpotlightPostId ?? null,
      recentPosts,
      scheduledPosts,
      communities,
      collaborations,
      incomingCollaborations,
      supportTickets,
    });
  } catch (hubError) {
    console.error("Get Creator Hub error:", hubError);
    return errorResponse("Unable to load Creator Hub", 500);
  }
}

/** All creator-only writes are dispatched from one small, auditable surface. */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("A Creator Hub action is required", 400);
  }
  try {
    const membership = await requireCreator(session.user.id);
    if (!membership) return errorResponse("An active Creator Boost benefit is required", 403);
    const action = body.action;

    if (action === "schedule") {
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const scheduledFor = typeof body.scheduledFor === "string" ? new Date(body.scheduledFor) : null;
      const visibility = body.visibility === "followers" || body.visibility === "private" ? body.visibility : "public";
      const latest = new Date(Date.now() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000);
      if (!content || content.length > 10_000) return errorResponse("Scheduled posts need 1–10,000 characters", 400);
      if (!scheduledFor || Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date() || scheduledFor > latest) {
        return errorResponse("Choose a time within the next 90 days", 400);
      }
      const [scheduled] = await db.insert(scheduledCreatorPosts).values({ creatorId: session.user.id, content, visibility, scheduledFor, updatedAt: new Date() }).returning();
      return successResponse({ scheduled }, 201);
    }

    if (action === "saveDraft") {
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content || content.length > 10_000) return errorResponse("Draft posts need 1–10,000 characters", 400);
      const [draft] = await db.insert(scheduledCreatorPosts).values({ creatorId: session.user.id, content, status: "draft", scheduledFor: new Date(), updatedAt: new Date() }).returning();
      return successResponse({ draft }, 201);
    }

    if (action === "cancelSchedule") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!isUuid(id)) return errorResponse("A scheduled post is required", 400);
      const [scheduled] = await db.update(scheduledCreatorPosts).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(scheduledCreatorPosts.id, id), eq(scheduledCreatorPosts.creatorId, session.user.id), eq(scheduledCreatorPosts.status, "scheduled"))).returning({ id: scheduledCreatorPosts.id });
      if (!scheduled) return errorResponse("This scheduled post cannot be cancelled", 404);
      return successResponse({ scheduled });
    }

    if (action === "spotlight") {
      const postId = typeof body.postId === "string" ? body.postId : "";
      if (!isUuid(postId)) return errorResponse("A post is required", 400);
      const [post] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, session.user.id), eq(posts.visibility, "public"), isNull(posts.deletedAt)));
      if (!post) return errorResponse("Choose one of your public posts", 400);
      await db.update(profiles).set({ creatorSpotlightPostId: post.id }).where(eq(profiles.userId, session.user.id));
      return successResponse({ spotlightPostId: post.id });
    }

    if (action === "community") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : null;
      const visibility = body.visibility === "followers" || body.visibility === "private" ? body.visibility : "public";
      if (!name || name.length > 100) return errorResponse("Community names must be 1–100 characters", 400);
      const community = await db.transaction(async (tx) => {
        const [group] = await tx.insert(groups).values({ name, description, visibility }).returning({ id: groups.id, name: groups.name, visibility: groups.visibility });
        await tx.insert(groupMembers).values({ groupId: group.id, userId: session.user.id, role: "admin" });
        const [row] = await tx.insert(creatorCommunities).values({ creatorId: session.user.id, groupId: group.id }).returning({ id: creatorCommunities.id });
        return { ...row, group };
      });
      return successResponse({ community }, 201);
    }

    if (action === "collaborate") {
      const postId = typeof body.postId === "string" ? body.postId : "";
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      if (!isUuid(postId) || !username) return errorResponse("A post and collaborator username are required", 400);
      const [[post], [collaborator]] = await Promise.all([
        db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, session.user.id), isNull(posts.deletedAt))),
        db.select({ id: users.id }).from(users).where(eq(users.username, username)),
      ]);
      if (!post) return errorResponse("Choose one of your posts", 400);
      if (!collaborator || collaborator.id === session.user.id) return errorResponse("Choose another LinkMe+ member", 400);
      const [invite] = await db.insert(creatorCollaborations).values({ postId, creatorId: session.user.id, collaboratorId: collaborator.id }).onConflictDoNothing().returning({ id: creatorCollaborations.id });
      if (!invite) return errorResponse("That collaborator has already been invited to this post", 409);
      await db.insert(notifications).values({ userId: collaborator.id, type: "creator_collaboration", sourceUserId: session.user.id, targetType: "post", targetId: postId, message: "You have a Creator Hub collaboration invitation." });
      return successResponse({ invite }, 201);
    }

    if (action === "respondCollaboration") {
      const id = typeof body.id === "string" ? body.id : "";
      const decision = body.decision === "accepted" || body.decision === "declined" ? body.decision : null;
      if (!isUuid(id) || !decision) return errorResponse("A collaboration invitation and decision are required", 400);
      const [invite] = await db.update(creatorCollaborations).set({ status: decision, respondedAt: new Date() }).where(and(eq(creatorCollaborations.id, id), eq(creatorCollaborations.collaboratorId, session.user.id), eq(creatorCollaborations.status, "pending"))).returning({ id: creatorCollaborations.id, status: creatorCollaborations.status });
      if (!invite) return errorResponse("This collaboration invitation is no longer available", 404);
      return successResponse({ invite });
    }

    if (action === "support") {
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!subject || subject.length > 160 || !message || message.length > 5_000) return errorResponse("Support requests need a subject and a message up to 5,000 characters", 400);
      const [ticket] = await db.insert(creatorSupportTickets).values({ creatorId: session.user.id, subject, message, updatedAt: new Date() }).returning({ id: creatorSupportTickets.id, status: creatorSupportTickets.status });
      return successResponse({ ticket }, 201);
    }

    return errorResponse("Unknown Creator Hub action", 400);
  } catch (hubError) {
    console.error("Creator Hub action error:", hubError);
    return errorResponse("Unable to complete this Creator Hub action", 500);
  }
}
