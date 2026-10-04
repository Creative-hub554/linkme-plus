import { db, withDbRetry } from "./index";
import { assertDemoMediaConfigured, ensureDemoAvatar, ensureDemoPostImage, ensureDemoVideo } from "./demo-media";
import {
  adPlacements,
  categories,
  comments,
  companies,
  conversationMembers,
  conversations,
  follows,
  groupMembers,
  groups,
  jobs,
  marketplaceListings,
  messages,
  postMedia,
  posts,
  profiles,
  users,
} from "./schema";

/**
 * Demo data for LinkMe+.
 *
 * Safe to re-run: every row is inserted with a deterministic id and
 * `onConflictDoNothing`, so nothing is duplicated or overwritten, and real
 * accounts are never touched. Demo members have no credentials — they exist to
 * give the feed, profiles, and pagination something realistic to show.
 *
 * Timestamps are spread backwards from the moment of seeding so relative times
 * ("2h ago", "3d ago") look natural and the feed spans enough history to page
 * through several times.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Deterministic ids so re-running the seed cannot duplicate rows. */
function postId(index: number) {
  return `31000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function mediaId(index: number) {
  return `32000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function commentId(index: number) {
  return `33000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function followId(index: number) {
  return `34000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function groupMemberId(index: number) {
  return `35000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function conversationMemberId(index: number) {
  return `36000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function adPlacementId(index: number) {
  return `a1000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Deterministic pseudo-random source, so every seed run produces the same feed. */
function pseudoRandom(seed: number): () => number {
  let state = (seed + 1) * 0x6d2b79f5;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoMember {
  id: string;
  username: string;
  displayName: string;
  email: string;
  initials: string;
  bio: string;
  location: string;
  work: string;
  education: string;
  website: string;
  skills: string[];
  hashtags: string[];
  /** Posts written in this member's voice; each is used once. */
  posts: string[];
}

const members: DemoMember[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    username: "theo_demo",
    displayName: "Theo Wu",
    email: "theo.demo@linkme.plus",
    initials: "TW",
    bio: "Building useful products and meeting curious people.",
    location: "Phnom Penh, Cambodia",
    work: "Product lead at Northstar Labs",
    education: "Royal University of Phnom Penh",
    website: "https://example.com/theo",
    skills: ["Product", "Design", "Community"],
    hashtags: ["product", "buildinpublic"],
    posts: [
      "Spent the morning rewriting our onboarding copy. Cutting three sentences did more than adding a new screen ever did.",
      "Reminder: the fastest way to learn what users want is to watch five of them use the thing without helping.",
      "Shipped a small fix today that removed two clicks from a flow four hundred people use daily. Small edges, sharpened.",
      "Roadmaps are a hypothesis, not a promise. The trick is saying that out loud without losing anyone's trust.",
      "Hiring a product designer this month. Portfolio over pedigree — show me how you think, not just what you shipped.",
      "Coffee, a notebook, and an empty calendar until noon. This is how the good work actually gets done.",
      "We deleted a feature today and nobody noticed. That is the highest compliment a feature can receive.",
      "Three months of interviews distilled into one sentence: people want fewer decisions, not more options.",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    username: "maya_designs",
    displayName: "Maya Chen",
    email: "maya.demo@linkme.plus",
    initials: "MC",
    bio: "Visual designer sharing process, inspiration, and practical tips.",
    location: "Singapore",
    work: "Independent brand designer",
    education: "LASALLE College of the Arts",
    website: "https://example.com/maya",
    skills: ["Brand design", "Illustration", "UI"],
    hashtags: ["design", "typography"],
    posts: [
      "Colour study for a client refresh. Same palette, four moods — the layout barely changes but the feeling completely does.",
      "Sketching in the morning, refining at night. The first hour is always the most honest part of the work.",
      "A grid is not a cage. It is the reason the exceptions look deliberate.",
      "Type tip: if the hierarchy is not readable in greyscale, colour is not going to save it.",
      "Finished a brand book today. Sixty pages that mostly say: be consistent, be patient.",
      "Redrew the same icon nine times. The ninth one took four minutes and is obviously the right one.",
      "Design critiques are better when everyone brings work in progress instead of finished screens.",
      "Working on a poster series about the Singapore coastline. Salt, concrete, and a lot of blue.",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    username: "jordan_builds",
    displayName: "Jordan Rivera",
    email: "jordan.demo@linkme.plus",
    initials: "JR",
    bio: "Developer, mentor, and weekend maker.",
    location: "Austin, Texas",
    work: "Staff engineer at Brightline Studio",
    education: "University of Texas at Austin",
    website: "https://example.com/jordan",
    skills: ["React", "Cloud", "Open source"],
    hashtags: ["development", "opensource"],
    posts: [
      "Cut our bundle by eighteen percent by deleting two dependencies nobody remembered adding. Audit your imports.",
      "The best debugging tool is still a fresh pair of eyes and a bored afternoon.",
      "Wrote tests for the parts I was afraid of. Turns out fear is a decent prioritisation signal.",
      "Mentoring two juniors this quarter. Explaining a concept out loud remains the fastest way to find its holes.",
      "Migrated a service over the weekend with zero downtime. The plan took longer than the migration, as it should.",
      "Small win: our slowest endpoint is six times faster after adding one index and deleting one join.",
      "Reading other people's code is underrated practice. You learn the shapes of mistakes.",
      "Weekend project: a tiny tool that renames screenshots by reading their contents. Unnecessary. Very satisfying.",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    username: "amara_ux",
    displayName: "Amara Okafor",
    email: "amara.demo@linkme.plus",
    initials: "AO",
    bio: "UX researcher. Evidence over opinions, always.",
    location: "Lagos, Nigeria",
    work: "Research lead at Northstar Labs",
    education: "University of Lagos",
    website: "https://example.com/amara",
    skills: ["User research", "Accessibility", "Facilitation"],
    hashtags: ["research", "accessibility"],
    posts: [
      "Ran six research sessions this week. The pattern was not what the team expected — that is the point of doing them.",
      "If your survey asks 'would you use this?', you are collecting politeness, not data.",
      "Accessibility is not a checklist at the end. It is a design constraint at the start, like gravity.",
      "Notes from the field: people do not read instructions. They push buttons and see what happens.",
      "Recruiting participants takes longer than running the study. Plan for it or your timeline is fiction.",
      "Nobody has ever asked for more settings. They ask for better defaults.",
      "A good research repository is boring: labelled, searchable, and ruthlessly current.",
      "Testing with five people caught three issues we had argued about for weeks. Evidence ends debates.",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    username: "liam_makes",
    displayName: "Liam Novak",
    email: "liam.demo@linkme.plus",
    initials: "LN",
    bio: "Hardware tinkerer. Half of what I build works.",
    location: "Berlin, Germany",
    work: "Independent hardware maker",
    education: "TU Berlin",
    website: "https://example.com/liam",
    skills: ["CAD", "3D printing", "Electronics"],
    hashtags: ["making", "hardware"],
    posts: [
      "Third prototype of the enclosure. The printer hums, the design gets closer.",
      "Repairing a 1970s amplifier taught me more about grounding than any textbook.",
      "Small workshop rule: label the drawer before you fill it, not after.",
      "Designed a mount that works with four different tripods. Compatibility is a feature.",
      "Spent an hour chasing a short only to find a stray solder ball. Physics does not care about my schedule.",
      "Weekend build: a desk lamp that dims with a dial instead of an app. Radical.",
      "There is a special satisfaction in making a part you could have bought for two euros.",
      "Workshop inventory night. Twelve drawers, one label printer, and a new respect for obsessive people.",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    username: "sofia_photographs",
    displayName: "Sofia Marchetti",
    email: "sofia.demo@linkme.plus",
    initials: "SM",
    bio: "Photographer. Light, cities, and the people in them.",
    location: "Lisbon, Portugal",
    work: "Freelance photographer",
    education: "Escola Superior de Belas-Artes",
    website: "https://example.com/sofia",
    skills: ["Photography", "Retouching", "Printing"],
    hashtags: ["photography", "travel"],
    posts: [
      "Golden hour on the Alfama rooftops. Waited forty minutes for the light and shot for four.",
      "Shot an entire walk on one lens today. Constraints make the edit faster and the story tighter.",
      "Edited a series about the harbour at dawn. Cold hands, warm light.",
      "Print test came back. Grey becomes blue at print scale — always test before you deliver.",
      "Portrait session with a shy subject. Give people something to do with their hands and they relax.",
      "Rain in Lisbon is a free diffuser. Everything goes soft and filmic for twenty minutes.",
      "Backed up three shoots and cleared two cards. The unglamorous half of photography.",
      "Choosing twelve frames from six hundred. The skill is in the cutting, not the shooting.",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    username: "kenji_dev",
    displayName: "Kenji Tanaka",
    email: "kenji.demo@linkme.plus",
    initials: "KT",
    bio: "Backend engineer. Fond of boring migrations and clear logs.",
    location: "Tokyo, Japan",
    work: "Platform engineer at Kite Systems",
    education: "Waseda University",
    website: "https://example.com/kenji",
    skills: ["Postgres", "Distributed systems", "Observability"],
    hashtags: ["backend", "databases"],
    posts: [
      "Schema migrations are cheapest when the change is boring. One column, one backfill, one deploy.",
      "If a queue has no dead-letter path, it is not a queue, it is a promise you cannot keep.",
      "Profiled a slow query today: the culprit was a missing composite index, not the ORM.",
      "Idempotency is the difference between a retry and an incident.",
      "Wrote a postmortem for a self-inflicted outage. Blameless, specific, and mildly humbling.",
      "Reading the database logs before assuming the application is at fault saves hours.",
      "Observability is not dashboards. It is being able to answer a new question at three in the morning.",
      "Deleted four thousand lines of dead code. The build got faster and the team got calmer.",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    username: "priya_grows",
    displayName: "Priya Raman",
    email: "priya.demo@linkme.plus",
    initials: "PR",
    bio: "Baker and small business owner. Small batches, real ingredients.",
    location: "Bengaluru, India",
    work: "Founder of Cardamom & Co.",
    education: "Christ University",
    website: "https://example.com/priya",
    skills: ["Baking", "Sourcing", "Small business"],
    hashtags: ["smallbusiness", "food"],
    posts: [
      "Saturday market done. Sold out of the lemon loaf by ten, learned to bake twice as much next week.",
      "Sourcing cardamom from a farm two hours away. The aroma difference is not subtle.",
      "Opened pre-orders and closed them in an hour. Small batches keep quality honest.",
      "A customer asked for less sugar, so we made a second recipe. Feedback is free product design.",
      "Packaging test: kraft boxes, compostable windows, and a stamp instead of a sticker.",
      "Five years of recipes now fit in one notebook. The margins are the interesting part.",
      "Delivery is the hardest part of a food business. Not the cooking.",
      "Trained a new baker today. Teaching a recipe is really teaching attention.",
    ],
  },
];

/** Short replies used on recent posts so comments feel alive. */
const replyTexts = [
  "This is the part nobody talks about. Thanks for writing it down.",
  "Saved this one — I keep relearning the same lesson.",
  "Do you have a write-up of the process? Would love to read it.",
  "Completely agree. We tried the opposite last quarter and it cost us a month.",
  "Beautiful. The light in this is doing a lot of work.",
  "Adding this to our team notes for Monday.",
  "Curious how you measured it — what did the numbers look like before?",
  "Yes. Fewer options, better defaults, everyone happier.",
  "This made me want to go back and redo one of my old projects.",
  "Strong reminder. Bookmarking for the next planning session.",
  "The detail about printing at scale is something I always forget.",
  "Watching people use it without help is brutal and educational in equal measure.",
];

const categoryIds = {
  technology: "90000000-0000-4000-8000-000000000001",
  design: "90000000-0000-4000-8000-000000000002",
  home: "90000000-0000-4000-8000-000000000003",
  business: "90000000-0000-4000-8000-000000000004",
};

const ids = {
  designGroup: "20000000-0000-4000-8000-000000000001",
  buildersGroup: "20000000-0000-4000-8000-000000000002",
  companyOne: "40000000-0000-4000-8000-000000000001",
  companyTwo: "40000000-0000-4000-8000-000000000002",
  jobOne: "50000000-0000-4000-8000-000000000001",
  jobTwo: "50000000-0000-4000-8000-000000000002",
  listingOne: "60000000-0000-4000-8000-000000000001",
  listingTwo: "60000000-0000-4000-8000-000000000002",
  conversation: "70000000-0000-4000-8000-000000000001",
  messageOne: "80000000-0000-4000-8000-000000000001",
  messageTwo: "80000000-0000-4000-8000-000000000002",
} as const;

/** Every fourth post carries artwork; a few carry a sample video. */
const POST_COUNT = 64;
const IMAGE_EVERY = 4;
const VIDEO_POSTS = new Set([1, 13, 27, 42]);

interface PlannedPost {
  id: string;
  authorId: string;
  content: string;
  type: "text" | "image" | "video";
  hashtags: string[];
  createdAt: Date;
  /** Index of the generated artwork, when this post has an image. */
  artworkIndex?: number;
  videoIndex?: number;
}

function planPosts(now: number): PlannedPost[] {
  const random = pseudoRandom(20260923);
  const planned: PlannedPost[] = [];
  let artworkCursor = 0;
  let videoCursor = 0;

  for (let index = 0; index < POST_COUNT; index += 1) {
    // Round-robin over members so no single voice dominates the feed.
    const member = members[index % members.length];
    const content = member.posts[Math.floor(index / members.length) % member.posts.length];
    const isVideo = VIDEO_POSTS.has(index);
    const isImage = !isVideo && index % IMAGE_EVERY === 0;

    // Spread history backwards with light jitter; the newest posts land within
    // the last hour or so so "just now" and "1h ago" both appear.
    const hoursBack = index * 5.5 + random() * 2.5;

    planned.push({
      id: postId(index),
      authorId: member.id,
      content,
      type: isVideo ? "video" : isImage ? "image" : "text",
      hashtags: member.hashtags,
      createdAt: new Date(now - hoursBack * HOUR),
      artworkIndex: isImage ? artworkCursor++ : undefined,
      videoIndex: isVideo ? videoCursor++ : undefined,
    });
  }

  return planned;
}

async function seed() {
  console.log("Seeding LinkMe+ application data...");
  assertDemoMediaConfigured();

  const now = Date.now();

  await withDbRetry(() =>
    db
      .insert(categories)
      .values([
        { id: categoryIds.technology, name: "Technology", slug: "technology", type: "marketplace" },
        { id: categoryIds.design, name: "Design", slug: "design", type: "group" },
        { id: categoryIds.home, name: "Home & Garden", slug: "home-garden", type: "marketplace" },
        { id: categoryIds.business, name: "Business", slug: "business", type: "page" },
      ])
      .onConflictDoNothing(),
  );

  await db
    .insert(adPlacements)
    .values([
      { id: adPlacementId(1), name: "Home Feed Banner", location: "feed", format: "banner", maxActive: 3, priceCpm: 500 },
      { id: adPlacementId(2), name: "Marketplace Banner", location: "marketplace", format: "banner", maxActive: 2, priceCpm: 400 },
      { id: adPlacementId(3), name: "Job Board Banner", location: "jobs", format: "banner", maxActive: 2, priceCpm: 350 },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values(
      members.map((member) => ({
        id: member.id,
        email: member.email,
        username: member.username,
        passwordHash: null,
        emailVerified: new Date(now - 30 * DAY),
      })),
    )
    .onConflictDoNothing();

  // Avatars are generated and hosted once, then reused on every re-run.
  console.log(`Preparing ${members.length} demo avatars...`);
  const avatarUrls = await Promise.all(members.map((member, index) => ensureDemoAvatar(index, member.initials)));

  await db
    .insert(profiles)
    .values(
      members.map((member, index) => ({
        userId: member.id,
        displayName: member.displayName,
        avatarUrl: avatarUrls[index],
        bio: member.bio,
        location: member.location,
        work: member.work,
        education: member.education,
        website: member.website,
        skills: member.skills,
      })),
    )
    .onConflictDoNothing();

  // A small, mutual-ish follow graph: everyone follows the next four members.
  const followRows = members.flatMap((member, index) =>
    [1, 2, 3, 4].map((offset) => ({
      id: followId(index * 4 + offset),
      followerId: member.id,
      followingId: members[(index + offset) % members.length].id,
    })),
  );
  await db.insert(follows).values(followRows).onConflictDoNothing();

  const planned = planPosts(now);

  console.log(`Preparing artwork for ${planned.filter((post) => post.artworkIndex !== undefined).length} image posts...`);
  const artworkUrls = new Map<number, string>();
  for (const post of planned) {
    if (post.artworkIndex === undefined) continue;
    artworkUrls.set(post.artworkIndex, await ensureDemoPostImage(post.artworkIndex));
  }

  console.log(`Preparing ${VIDEO_POSTS.size} demo videos...`);
  const videoUrls = new Map<number, string>();
  for (const post of planned) {
    if (post.videoIndex === undefined) continue;
    const url = await ensureDemoVideo(post.videoIndex);
    if (url) videoUrls.set(post.videoIndex, url);
  }

  // A video post with no clip available degrades to a text post rather than
  // linking to media that cannot play.
  const postRows = planned.map((post) => ({
    id: post.id,
    authorId: post.authorId,
    type: (post.videoIndex !== undefined && !videoUrls.has(post.videoIndex) ? "text" : post.type) as
      | "text"
      | "image"
      | "video",
    content: post.content,
    hashtags: post.hashtags,
    visibility: "public" as const,
    createdAt: post.createdAt,
  }));
  await db.insert(posts).values(postRows).onConflictDoNothing();

  const mediaRows = planned.flatMap((post, index) => {
    if (post.artworkIndex !== undefined) {
      return [
        {
          id: mediaId(index),
          postId: post.id,
          url: artworkUrls.get(post.artworkIndex) as string,
          altText: "Abstract artwork shared with this post",
          type: "image/jpeg",
          order: 0,
        },
      ];
    }
    if (post.videoIndex !== undefined && videoUrls.has(post.videoIndex)) {
      return [
        {
          id: mediaId(index),
          postId: post.id,
          url: videoUrls.get(post.videoIndex) as string,
          altText: "Sample video clip shared with this post",
          type: "video/mp4",
          order: 0,
        },
      ];
    }
    return [];
  });
  if (mediaRows.length > 0) {
    await db.insert(postMedia).values(mediaRows).onConflictDoNothing();
  }

  // Replies on the twelve newest posts, from members other than the author.
  const replyRandom = pseudoRandom(777);
  const commentRows = planned.slice(0, 12).flatMap((post, postIndex) => {
    const replyCount = 1 + Math.floor(replyRandom() * 3);
    return Array.from({ length: replyCount }, (_unused, replyIndex) => {
      const replier = members[(postIndex + replyIndex + 1) % members.length];
      const text = replyTexts[Math.floor(replyRandom() * replyTexts.length)];
      return {
        id: commentId(postIndex * 3 + replyIndex),
        postId: post.id,
        authorId: replier.id,
        content: text,
        createdAt: new Date(post.createdAt.getTime() + (replyIndex + 1) * 42 * 60 * 1000),
      };
    });
  });
  await db.insert(comments).values(commentRows).onConflictDoNothing();

  await db
    .insert(groups)
    .values([
      { id: ids.designGroup, name: "Design & Product Makers", description: "Share work in progress, critique, and practical product lessons.", categoryId: categoryIds.design, visibility: "public" },
      { id: ids.buildersGroup, name: "Indie Builders", description: "A friendly space for people making software, businesses, and useful things.", categoryId: categoryIds.technology, visibility: "public" },
    ])
    .onConflictDoNothing();

  await db
    .insert(groupMembers)
    .values([
      { id: groupMemberId(1), groupId: ids.designGroup, userId: members[1].id, role: "admin" },
      { id: groupMemberId(2), groupId: ids.designGroup, userId: members[0].id, role: "member" },
      { id: groupMemberId(3), groupId: ids.designGroup, userId: members[3].id, role: "member" },
      { id: groupMemberId(4), groupId: ids.buildersGroup, userId: members[2].id, role: "admin" },
      { id: groupMemberId(5), groupId: ids.buildersGroup, userId: members[6].id, role: "member" },
      { id: groupMemberId(6), groupId: ids.buildersGroup, userId: members[0].id, role: "member" },
    ])
    .onConflictDoNothing();

  await db
    .insert(companies)
    .values([
      { id: ids.companyOne, name: "Northstar Labs", description: "Tools for modern teams.", website: "https://example.com/northstar" },
      { id: ids.companyTwo, name: "Brightline Studio", description: "A product and brand studio.", website: "https://example.com/brightline" },
    ])
    .onConflictDoNothing();

  await db
    .insert(jobs)
    .values([
      { id: ids.jobOne, companyId: ids.companyOne, title: "Frontend Engineer", location: "Remote", remoteStatus: "remote", jobType: "Full-time", salaryMin: 85000, salaryMax: 115000, description: "Build polished product experiences with a collaborative team.", requirements: "React, TypeScript, accessibility", skills: ["React", "TypeScript", "CSS"], status: "active" },
      { id: ids.jobTwo, companyId: ids.companyTwo, title: "Product Designer", location: "Singapore", remoteStatus: "hybrid", jobType: "Full-time", salaryMin: 70000, salaryMax: 95000, description: "Shape clear, useful workflows from early concept to launch.", requirements: "Product thinking, prototyping, communication", skills: ["Figma", "Research", "Systems"], status: "active" },
    ])
    .onConflictDoNothing();

  await db
    .insert(marketplaceListings)
    .values([
      { id: ids.listingOne, sellerId: members[1].id, title: "Desk setup bundle", description: "A clean, lightly used desk setup for a focused workspace.", categoryId: categoryIds.home, priceMin: 180, priceMax: 220, condition: "Like new", location: "Singapore", status: "active" },
      { id: ids.listingTwo, sellerId: members[2].id, title: "Mechanical keyboard", description: "Quiet tactile keyboard with extra keycaps included.", categoryId: categoryIds.technology, priceMin: 95, priceMax: 95, condition: "Good", location: "Austin, Texas", status: "active" },
    ])
    .onConflictDoNothing();

  await db.insert(conversations).values({ id: ids.conversation }).onConflictDoNothing();
  await db
    .insert(conversationMembers)
    .values([
      { id: conversationMemberId(1), conversationId: ids.conversation, userId: members[0].id },
      { id: conversationMemberId(2), conversationId: ids.conversation, userId: members[1].id },
    ])
    .onConflictDoNothing();
  await db
    .insert(messages)
    .values([
      { id: ids.messageOne, conversationId: ids.conversation, senderId: members[1].id, content: "Hey Theo — I shared the latest design notes in the group." },
      { id: ids.messageTwo, conversationId: ids.conversation, senderId: members[0].id, content: "Thanks, I'll take a look this afternoon." },
    ])
    .onConflictDoNothing();

  console.log("");
  console.log("✓ Seeded demo data");
  console.log(`  members          ${members.length} (${members.map((member) => member.username).join(", ")})`);
  console.log(`  posts            ${postRows.length} spanning ~${Math.round((planned[planned.length - 1].createdAt.getTime() - now) / -DAY)} days`);
  console.log(`  post media       ${mediaRows.length} (${mediaRows.filter((row) => row.type.startsWith("image")).length} images, ${mediaRows.filter((row) => row.type.startsWith("video")).length} videos)`);
  console.log(`  comments         ${commentRows.length}, follows ${followRows.length}`);
  console.log("");
  console.log("Demo members are content-only personas: they have no credentials, so they");
  console.log("cannot sign in. Sign in with your own account to see them in the feed.");
  if (videoUrls.size > 0) {
    console.log("Sample videos: Big Buck Bunny (CC-BY 3.0, Blender Foundation), mirrored into R2.");
  }
  console.log("Re-running this seed is safe: every row uses a fixed id and is inserted with ON CONFLICT DO NOTHING.");
}

// Node's globals are not typed in this project; the same cast is used in
// src/lib/db/index.ts and src/lib/r2.ts.
const runtimeProcess = (globalThis as { process?: { exitCode?: number } }).process;

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    if (runtimeProcess) runtimeProcess.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end({ timeout: 5 });
  });
