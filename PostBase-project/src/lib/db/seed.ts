import { db, withDbRetry } from "./index";
import {
  assertDemoMediaConfigured,
  ensureDemoAvatar,
  ensureDemoListingImage,
  ensureDemoPageCover,
  ensureDemoPostImage,
  ensureDemoVideo,
} from "./demo-media";
import { count, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
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
  listingMedia,
  marketplaceListings,
  messages,
  notifications,
  pageFollows,
  pageRoles,
  pages,
  postMedia,
  posts,
  profiles,
  reactions,
  users,
} from "./schema";

/**
 * Demo data for LinkMe+.
 *
 * Safe to re-run, and able to *repair*: every row the seed holds is written as an
 * upsert on that row's own key, and the update it carries fires only when a value
 * the seed holds differs from what is stored. So a re-run over a database that
 * already matches writes nothing, while a demo row deleted by hand comes back and
 * an edited one is restored — and the run says which edges it had to put back.
 * Rows the seed does not own are never touched. Demo members have no credentials
 * — they exist to give the feed, profiles, and pagination something realistic to
 * show.
 *
 * The demo cast is not the whole story, because some surfaces are scoped to the
 * viewer rather than to the community: `/api/pages` lists only the Pages you own
 * or follow, `/api/messages` only your conversations, and a notification bell
 * only rings for things done *to* you. Seeded by the cast alone, those tabs stay
 * empty for whoever is signed in. So every account already in the database when
 * the seed runs is wired into the demo graph as well — follows, Page follows, a
 * conversation, and engagement aimed back at it — which is what makes the
 * signed-in app worth clicking through. That is additive: nothing an account
 * already owns is changed or deleted, and the only thing read of its own is its
 * posts, so there is something of its own for the cast to react to. The
 * notifications that engagement implies are stated by the seed as well, so that
 * an inbox emptied by hand comes back on the next run rather than staying gone.
 *
 * Timestamps are spread backwards from the moment of seeding so relative times
 * ("2h ago", "3d ago") look natural and the feed spans enough history to page
 * through several times.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

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
function pageId(index: number) {
  return `b1000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function pageRoleId(index: number) {
  return `b2000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function pageFollowId(index: number) {
  return `b3000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function reactionId(index: number) {
  return `b4000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function pagePostId(index: number) {
  return `b9000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function listingMediaId(index: number) {
  return `d1000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/**
 * A stable id for a row that belongs to an account that was already in the
 * database when the seed ran.
 *
 * The demo rows above count upward from a fixed position, which is safe because
 * the demo cast never changes. The accounts already here do change: one more
 * signup and "the second account" is a different person, so numbering them would
 * re-point every id the moment that happened and a second run would insert a
 * second copy of each row. Hashing the account's own id together with a label
 * for the row keeps an account's rows the same rows on every run, whatever else
 * is in the table.
 */
function accountRowId(prefix: string, ...parts: string[]): string {
  let hash = 0x811c9dc5;
  for (const character of parts.join(":")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}-0000-4000-8000-${hash.toString(16).padStart(12, "0")}`;
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

interface DemoPage {
  id: string;
  username: string;
  name: string;
  /** Used for the generated avatar, which is stored under the Page's initials. */
  initials: string;
  description: string;
  category: keyof typeof categoryIds;
  /** The member who administers the Page and authors everything it posts as. */
  admin: string;
  /** A second member with a role on the Page, so its team is not one person. */
  editor: string;
  posts: string[];
}

/**
 * Pages, so the Pages tab has something in it.
 *
 * A Page is a different kind of account from a member, which is why it is seeded
 * with the edges that make it reachable rather than merely as a row: the
 * directory lists only the Pages a viewer owns or follows, so a Page without a
 * follow edge is a Page nobody can see.
 */
const demoPages: DemoPage[] = [
  {
    id: pageId(1),
    username: "northstar-labs",
    name: "Northstar Labs",
    initials: "NS",
    description: "Tools for modern teams — product notes, hiring, and the occasional postmortem.",
    category: "business",
    admin: members[0].id,
    editor: members[3].id,
    posts: [
      "Shipped a quieter notifications inbox this week. Same events, far less noise.",
      "Our component library now documents the why behind a component, not only its API.",
    ],
  },
  {
    id: pageId(2),
    username: "brightline-studio",
    name: "Brightline Studio",
    initials: "BL",
    description: "A product and brand studio. Work in progress, critiques, and the odd rant about grids.",
    category: "design",
    admin: members[2].id,
    editor: members[1].id,
    posts: [
      "Three weeks into a redesign: the wireframes are finally boring, which is the goal.",
      "We are hiring a frontend engineer who thinks accessibility is part of the job.",
    ],
  },
  {
    id: pageId(3),
    username: "cardamom-co",
    name: "Cardamom & Co.",
    initials: "CC",
    description: "Small-batch baking with ingredients we can name. Orders open Thursdays.",
    category: "business",
    admin: members[7].id,
    editor: members[5].id,
    posts: [
      "This week's bake list is up. Pre-orders close Thursday and the lemon loaf always goes first.",
      "Cardamom buns are back on the counter from 8am, made with the farm's new crop.",
    ],
  },
];

/**
 * One conversation, written once and given to every account the seed adopts, so
 * the Messages tab opens on something that reads like a real exchange.
 */
const chatScript: { from: "host" | "member"; text: string }[] = [
  { from: "member", text: "Thanks for the follow — good to have you here. What are you working on at the moment?" },
  { from: "host", text: "Rewriting our onboarding flow. The copy is turning out to be the hard part, not the screens." },
  { from: "member", text: "That is usually a sign the screens are right. Happy to look if you want a second pair of eyes." },
  { from: "host", text: "That would help — I will send the draft over this evening." },
];

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

/** Photos per demo listing. The grid shows the first; the rest give `order` a job. */
const LISTING_PHOTOS = 3;

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

/** One seeded edge: the table, the key that identifies a row of it, and what the seed holds. */
interface SeededEdge<Row extends Record<string, unknown>> {
  label: string;
  table: PgTable;
  rows: Row[];
  /**
   * The unique key the row is matched on — the primary key, or the natural key
   * where the app can create this row too (a follow is its pair, a Page follow is
   * its pair), so a row a visitor made is recognized as the same edge rather than
   * duplicated beside it.
   */
  target: PgColumn | PgColumn[];
  /**
   * Columns whose stored value is not the seed's to rewrite, even in a row it
   * owns. Two kinds live here. A value derived from the *run's clock* — a post's
   * `created_at`, a member's `email_verified` — is written once and then held: the
   * timeline is anchored at the first seed, and re-running must not slide every
   * post forward to the new `now` (nor report every row as drifted for it). And a
   * value derived from *volatile state* — the adoption's like points at the
   * account's newest post when it was first written — must not walk onto a newer
   * one on a later run.
   */
  hold?: PgColumn[];
}

/** What one edge had to put back, for the closing report. */
interface EdgeRepair {
  label: string;
  /** Rows the seed holds that were not in the table at all. */
  restored: number;
  /** Rows that were there but not the value the seed holds for them. */
  repaired: number;
}

/**
 * Writes one seeded edge, and puts back whatever has drifted since a run.
 *
 * Every write the seed makes is an upsert on the row's own key, and the one
 * `do update` it renders carries a `where` that only fires when a column the seed
 * holds actually differs from what is stored. That is what turns "safe to
 * re-run" into "able to repair": `onConflictDoNothing` can only skip a row that
 * is already there, however wrong it has become.
 *
 * Nothing here deletes, and nothing writes a row the seed did not create: the
 * conflict target is the seed's own key, and where that key is a natural one (a
 * follow's pair) the row it matches is the edge whether or not the seed wrote it,
 * with the id left as it was found. A row the seed does not know about — a
 * viewer's own post, a follow they chose — is not the seed's business and is
 * never read, matched or changed.
 *
 * The counts are exact rather than inferred: which of the seed's keys are absent
 * is read first (`restored`), and the statement's `returning` is everything it
 * wrote, so the remainder is what it had to *rewrite*.
 */
async function writeSeededEdge<Row extends Record<string, unknown>>(edge: SeededEdge<Row>): Promise<EdgeRepair | null> {
  const { label, table, rows } = edge;
  if (rows.length === 0) return null;

  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const arbiters = Array.isArray(edge.target) ? edge.target : [edge.target];
  const held = new Set(edge.hold ?? []);
  const propOf = (column: PgColumn) => Object.keys(columns).find((prop) => columns[prop] === column) as string;
  const arbiterProps = arbiters.map(propOf);
  const ownedProps = Object.keys(rows[0]).filter(
    (prop) => columns[prop] !== undefined && !arbiterProps.includes(prop) && !held.has(columns[prop]),
  );

  // A stable string per row, so a pair-keyed edge is compared as the pair and not
  // as its first column: a follow the seed expects to one member must not be
  // counted as present because a follow to another one happens to match. Every key
  // column is therefore read — the read is *narrowed* by the first one, which is a
  // superset of what a pair match needs, but a keystring built from a column that
  // was not selected would compare "undefined" against a real id.
  const keyOf = (row: Record<string, unknown>) => arbiterProps.map((prop) => String(row[prop])).join("\u0000");
  const lookup = Object.fromEntries(arbiterProps.map((prop) => [prop, columns[prop]]));
  const present = await db
    .select(lookup)
    .from(table)
    .where(inArray(columns[arbiterProps[0]], [...new Set(rows.map((row) => row[arbiterProps[0]] as string))]));
  const presentKeys = new Set(present.map((row) => keyOf(row)));
  const restored = rows.filter((row) => !presentKeys.has(keyOf(row))).length;

  const written =
    ownedProps.length === 0
      ? await db.insert(table).values(rows).onConflictDoNothing().returning(lookup)
      : await db
          .insert(table)
          .values(rows)
          .onConflictDoUpdate({
            target: edge.target,
            set: Object.fromEntries(
              ownedProps.map((prop) => [prop, sql`excluded.${sql.identifier(columns[prop].name)}`]),
            ),
            setWhere: sql`(${sql.join(
              ownedProps.map(
                (prop) => sql`${columns[prop]} is distinct from excluded.${sql.identifier(columns[prop].name)}`,
              ),
              sql` or `,
            )})`,
          })
          .returning(lookup);

  return { label, restored, repaired: Math.max(0, written.length - restored) };
}

/**
 * The key a comment bell repeats on: who was told, who commented, and on what.
 * Read as a string so a bell can be held against the comments behind it.
 */
const commentBellKey = (bell: { userId: string; sourceUserId: string | null; targetId: string | null }) =>
  `${bell.userId}\u0000${bell.sourceUserId}\u0000${bell.targetId}`;

async function seed() {
  console.log("Seeding LinkMe+ application data...");
  assertDemoMediaConfigured();

  // An empty `users` is the one state where every row is new, so the report can
  // say "first seed" instead of calling the first write of every edge a repair.
  const [{ total: usersBefore }] = await db.select({ total: count() }).from(users);
  const firstSeed = usersBefore === 0;

  /** Every edge's repair, in the order the graph is written. */
  const repairs: EdgeRepair[] = [];
  const writeEdge = async <Row extends Record<string, unknown>>(edge: SeededEdge<Row>) => {
    const report = await writeSeededEdge(edge);
    if (report) repairs.push(report);
  };

  const now = Date.now();

  await withDbRetry(() =>
    writeEdge({
      label: "categories",
      table: categories,
      target: categories.id,
      rows: [
        { id: categoryIds.technology, name: "Technology", slug: "technology", type: "marketplace" },
        { id: categoryIds.design, name: "Design", slug: "design", type: "group" },
        { id: categoryIds.home, name: "Home & Garden", slug: "home-garden", type: "marketplace" },
        { id: categoryIds.business, name: "Business", slug: "business", type: "page" },
      ],
    }),
  );

  await writeEdge({
    label: "ad placements",
    table: adPlacements,
    target: adPlacements.id,
    rows: [
      { id: adPlacementId(1), name: "Home Feed Banner", location: "feed", format: "banner", maxActive: 3, priceCpm: 500 },
      { id: adPlacementId(2), name: "Marketplace Banner", location: "marketplace", format: "banner", maxActive: 2, priceCpm: 400 },
      { id: adPlacementId(3), name: "Job Board Banner", location: "jobs", format: "banner", maxActive: 2, priceCpm: 350 },
    ],
  });

  await writeEdge({
    label: "demo members",
    table: users,
    target: users.id,
    // `email_verified` is `now - 30 days`: recomputed from this run's clock, so it
    // is written once and held rather than asserted on every re-run.
    hold: [users.emailVerified],
    rows: members.map((member) => ({
      id: member.id,
      email: member.email,
      username: member.username,
      passwordHash: null,
      emailVerified: new Date(now - 30 * DAY),
    })),
  });

  // Avatars are generated and hosted once, then reused on every re-run.
  console.log(`Preparing ${members.length} demo avatars...`);
  const avatarUrls = await Promise.all(members.map((member, index) => ensureDemoAvatar(index, member.initials)));

  await writeEdge({
    label: "member profiles",
    table: profiles,
    // Keyed on the account rather than on `profiles.id`: the seed does not write
    // that id, so it is not the seed's to match on — and `user_id` is unique.
    target: profiles.userId,
    rows: members.map((member, index) => ({
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
  });

  // A small, mutual-ish follow graph: everyone follows the next four members.
  const followRows = members.flatMap((member, index) =>
    [1, 2, 3, 4].map((offset) => ({
      id: followId(index * 4 + offset),
      followerId: member.id,
      followingId: members[(index + offset) % members.length].id,
    })),
  );
  await writeEdge({
    label: "cast follows",
    table: follows,
    // Matched on the pair, not on the seed's own id: a follow is its pair, so a
    // row the app created between runs is the same edge and is left as it is —
    // its id held rather than replaced with the seed's.
    target: [follows.followerId, follows.followingId],
    hold: [follows.id],
    rows: followRows,
  });

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
  // Every `created_at` here is `now` minus an offset, so the feed's whole timeline
  // is anchored at the first seed and held: the offsets still read as "2h ago",
  // and a repaired post keeps the position it had rather than jumping to the top.
  await writeEdge({
    label: "member posts",
    table: posts,
    target: posts.id,
    hold: [posts.createdAt],
    rows: postRows,
  });

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
  await writeEdge({ label: "post media", table: postMedia, target: postMedia.id, rows: mediaRows });

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
  await writeEdge({
    label: "comments",
    table: comments,
    target: comments.id,
    hold: [comments.createdAt],
    rows: commentRows,
  });

  await writeEdge({
    label: "groups",
    table: groups,
    target: groups.id,
    rows: [
      { id: ids.designGroup, name: "Design & Product Makers", description: "Share work in progress, critique, and practical product lessons.", categoryId: categoryIds.design, visibility: "public" },
      { id: ids.buildersGroup, name: "Indie Builders", description: "A friendly space for people making software, businesses, and useful things.", categoryId: categoryIds.technology, visibility: "public" },
    ],
  });

  await writeEdge({
    label: "group members",
    table: groupMembers,
    target: groupMembers.id,
    rows: [
      { id: groupMemberId(1), groupId: ids.designGroup, userId: members[1].id, role: "admin" },
      { id: groupMemberId(2), groupId: ids.designGroup, userId: members[0].id, role: "member" },
      { id: groupMemberId(3), groupId: ids.designGroup, userId: members[3].id, role: "member" },
      { id: groupMemberId(4), groupId: ids.buildersGroup, userId: members[2].id, role: "admin" },
      { id: groupMemberId(5), groupId: ids.buildersGroup, userId: members[6].id, role: "member" },
      { id: groupMemberId(6), groupId: ids.buildersGroup, userId: members[0].id, role: "member" },
    ],
  });

  await writeEdge({
    label: "companies",
    table: companies,
    target: companies.id,
    rows: [
      { id: ids.companyOne, name: "Northstar Labs", description: "Tools for modern teams.", website: "https://example.com/northstar" },
      { id: ids.companyTwo, name: "Brightline Studio", description: "A product and brand studio.", website: "https://example.com/brightline" },
    ],
  });

  await writeEdge({
    label: "jobs",
    table: jobs,
    target: jobs.id,
    rows: [
      { id: ids.jobOne, companyId: ids.companyOne, title: "Frontend Engineer", location: "Remote", remoteStatus: "remote", jobType: "Full-time", salaryMin: 85000, salaryMax: 115000, description: "Build polished product experiences with a collaborative team.", requirements: "React, TypeScript, accessibility", skills: ["React", "TypeScript", "CSS"], status: "active" },
      { id: ids.jobTwo, companyId: ids.companyTwo, title: "Product Designer", location: "Singapore", remoteStatus: "hybrid", jobType: "Full-time", salaryMin: 70000, salaryMax: 95000, description: "Shape clear, useful workflows from early concept to launch.", requirements: "Product thinking, prototyping, communication", skills: ["Figma", "Research", "Systems"], status: "active" },
    ],
  });

  const listingRows = [
    { id: ids.listingOne, sellerId: members[1].id, title: "Desk setup bundle", description: "A clean, lightly used desk setup for a focused workspace.", categoryId: categoryIds.home, priceMin: 180, priceMax: 220, condition: "Like new", location: "Singapore", status: "active" as const },
    { id: ids.listingTwo, sellerId: members[2].id, title: "Mechanical keyboard", description: "Quiet tactile keyboard with extra keycaps included.", categoryId: categoryIds.technology, priceMin: 95, priceMax: 95, condition: "Good", location: "Austin, Texas", status: "active" as const },
  ];
  await writeEdge({
    label: "listings",
    table: marketplaceListings,
    target: marketplaceListings.id,
    rows: listingRows,
  });

  // A listing with no photo is a card that says "No image" — the one state a
  // shop grid cannot afford, and the reason the grid read has to carry a photo
  // at all. The first photo is the one the grid shows; the rest are what give
  // the single-listing read's `order` something to sort.
  console.log(`Preparing ${listingRows.length * LISTING_PHOTOS} listing photos...`);
  const listingPhotoUrls: string[] = [];
  for (let index = 0; index < listingRows.length * LISTING_PHOTOS; index += 1) {
    listingPhotoUrls.push(await ensureDemoListingImage(index));
  }

  const listingPhotoRows = listingRows.flatMap((listing, listingIndex) =>
    Array.from({ length: LISTING_PHOTOS }, (_unused, photoIndex) => ({
      id: listingMediaId(listingIndex * LISTING_PHOTOS + photoIndex),
      listingId: listing.id,
      url: listingPhotoUrls[listingIndex * LISTING_PHOTOS + photoIndex],
      altText: `${listing.title} — photo ${photoIndex + 1}`,
      order: photoIndex,
    })),
  );
  await writeEdge({
    label: "listing photos",
    table: listingMedia,
    target: listingMedia.id,
    rows: listingPhotoRows,
  });

  // The conversation itself carries no value the seed owns besides its id, so
  // this edge can only be restored, not repaired — which is what the helper's
  // empty `set` falls back to.
  await writeEdge({ label: "conversation", table: conversations, target: conversations.id, rows: [{ id: ids.conversation }] });
  await writeEdge({
    label: "conversation members",
    table: conversationMembers,
    target: conversationMembers.id,
    rows: [
      { id: conversationMemberId(1), conversationId: ids.conversation, userId: members[0].id },
      { id: conversationMemberId(2), conversationId: ids.conversation, userId: members[1].id },
    ],
  });
  await writeEdge({
    label: "messages",
    table: messages,
    target: messages.id,
    rows: [
      { id: ids.messageOne, conversationId: ids.conversation, senderId: members[1].id, content: "Hey Theo — I shared the latest design notes in the group." },
      { id: ids.messageTwo, conversationId: ids.conversation, senderId: members[0].id, content: "Thanks, I'll take a look this afternoon." },
    ],
  });

  // ─── Pages ────────────────────────────────────────────────────────
  // A Page is drawn with two pictures and they are two different shapes: a
  // square avatar and a wide header band. Each is composed for the box that
  // holds it, which is why they are generated separately rather than one image
  // cropped twice.
  console.log(`Preparing ${demoPages.length} demo Page avatars and covers...`);
  const [pageAvatarUrls, pageCoverUrls] = await Promise.all([
    Promise.all(demoPages.map((page, index) => ensureDemoAvatar(members.length + index, page.initials))),
    Promise.all(demoPages.map((_page, index) => ensureDemoPageCover(index))),
  ]);

  // Both pictures are part of the edge now, so the older-shape problem this
  // used to patch with a one-column `coalesce` is the repair pass's ordinary
  // case: a Page seeded before its cover existed is filled in, and a picture
  // edited since is put back to the one the seed composes.
  await writeEdge({
    label: "pages",
    table: pages,
    target: pages.id,
    rows: demoPages.map((page, index) => ({
      id: page.id,
      username: page.username,
      name: page.name,
      categoryId: categoryIds[page.category],
      description: page.description,
      avatarUrl: pageAvatarUrls[index],
      coverUrl: pageCoverUrls[index],
    })),
  });

  await writeEdge({
    label: "page roles",
    table: pageRoles,
    target: pageRoles.id,
    rows: demoPages.flatMap((page, index) => [
      { id: pageRoleId(index * 2 + 1), pageId: page.id, userId: page.admin, role: "admin" },
      { id: pageRoleId(index * 2 + 2), pageId: page.id, userId: page.editor, role: "editor" },
    ]),
  });

  const pagePostRows = demoPages.flatMap((page, pageIndex) =>
    page.posts.map((content, postIndex) => ({
      id: pagePostId(pageIndex * page.posts.length + postIndex),
      authorId: page.admin,
      pageId: page.id,
      type: "text" as const,
      content,
      visibility: "public" as const,
      createdAt: new Date(now - (pageIndex + 1) * 9 * HOUR - postIndex * 3 * HOUR),
    })),
  );
  await writeEdge({
    label: "Page posts",
    table: posts,
    target: posts.id,
    hold: [posts.createdAt],
    rows: pagePostRows,
  });

  // Each member follows the two Pages nearest them, so every Page carries
  // followers who are not its own admin.
  const pageFollowRows = members.flatMap((member, index) =>
    [0, 1].map((offset) => ({
      id: pageFollowId(index * 2 + offset),
      pageId: demoPages[(index + offset) % demoPages.length].id,
      userId: member.id,
    })),
  );
  await writeEdge({
    label: "cast Page follows",
    table: pageFollows,
    target: [pageFollows.pageId, pageFollows.userId],
    // The pair is the edge, so a row the app created is matched rather than
    // duplicated beside it — and its id is left exactly as it was found.
    hold: [pageFollows.id],
    rows: pageFollowRows,
  });

  // ─── Likes ────────────────────────────────────────────────────────
  // Without these every card reads "0", which is the whole difference between a
  // feed that looks alive and one that looks abandoned. Each post is liked by
  // one to three members other than its author, so no post carries two likes
  // from the same person and every post carries at least one. The Pages' posts
  // are included because they are the newest thing on the feed: leave them out
  // and the first screen a reader sees is still a column of zeroes.
  const likeable = [
    ...planned.map((post) => ({ id: post.id, authorId: post.authorId })),
    ...pagePostRows.map((post) => ({ id: post.id, authorId: post.authorId })),
  ];
  const likeRandom = pseudoRandom(31337);
  const reactionRows = likeable.flatMap((post, index) => {
    const authorIndex = members.findIndex((member) => member.id === post.authorId);
    const likes = 1 + Math.floor(likeRandom() * 3);
    return Array.from({ length: likes }, (_unused, liked) => ({
      id: reactionId(index * 3 + liked),
      targetType: "post",
      targetId: post.id,
      userId: members[(authorIndex + liked + 1) % members.length].id,
      type: "like",
    }));
  });
  await writeEdge({ label: "cast likes", table: reactions, target: reactions.id, rows: reactionRows });

  // ─── The demo graph, wired to the accounts already here ───────────
  // Everything above belongs to the demo cast. The surfaces below are scoped to
  // the viewer, so they only come alive for an account the seed adopts: it
  // follows the cast and the Pages, holds a conversation with one of them, and
  // the cast follows and likes it back. Those last two are what put rows in its
  // notification bell — raised by the database's own engagement trigger as a
  // by-product of the insert, and stated again by the seed itself so that a
  // re-seed can put back an inbox that went missing (see the end of the block).
  const existingAccounts = await db.select({ id: users.id }).from(users);
  const demoIds = new Set(members.map((member) => member.id));
  const hosts = existingAccounts.filter((account) => !demoIds.has(account.id));

  // Carried out of the block for the closing report.
  let impliedNotifications = 0;
  let restoredNotifications = 0;
  let dedupedNotifications = 0;

  if (hosts.length > 0) {
    const conversationFor = (hostId: string) => accountRowId("c5000000", hostId, "conversation");

    // Both directions are the one graph, but only the cast-follows-host half
    // rings the host's bell, so it is built as its own list: the notification
    // pass at the end of this block states one notification per row of it.
    const castFollowsHost = hosts.flatMap((host) =>
      members.map((member) => ({
        id: accountRowId("c2000000", member.id, "follows", host.id),
        followerId: member.id,
        followingId: host.id,
      })),
    );

    await writeEdge({
      label: "adoption follows",
      table: follows,
      target: [follows.followerId, follows.followingId],
      hold: [follows.id],
      rows: [
        ...hosts.flatMap((host) =>
          members.map((member) => ({
            id: accountRowId("c1000000", host.id, "follows", member.id),
            followerId: host.id,
            followingId: member.id,
          })),
        ),
        ...castFollowsHost,
      ],
    });

    await writeEdge({
      label: "adoption Page follows",
      table: pageFollows,
      target: [pageFollows.pageId, pageFollows.userId],
      rows: hosts.flatMap((host) =>
        demoPages.map((page) => ({
          id: accountRowId("c3000000", host.id, "page", page.id),
          pageId: page.id,
          userId: host.id,
        })),
      ),
    });

    // The cast likes each adopted account's newest post — read, never written,
    // because the account's own posts are its own. The row id is keyed on the
    // pair rather than on the post, so if that account posts again and the seed
    // runs a second time the row is already there and the like stays where it
    // was first put instead of turning up on two posts at once.
    const allPosts = await db
      .select({ id: posts.id, authorId: posts.authorId, createdAt: posts.createdAt })
      .from(posts);
    const hostPost = new Map<string, { id: string; at: number }>();
    for (const post of allPosts) {
      const at = post.createdAt.getTime();
      const seen = hostPost.get(post.authorId);
      if (!seen || at > seen.at) hostPost.set(post.authorId, { id: post.id, at });
    }

    const hostReactionRows = hosts.flatMap((host) => {
      const target = hostPost.get(host.id);
      if (!target) return [];
      return members.slice(0, 3).map((member) => ({
        id: accountRowId("c4000000", member.id, "reaction", host.id),
        targetType: "post",
        targetId: target.id,
        userId: member.id,
        type: "like",
      }));
    });
    // The adoption's like is the one value the seed does not assert: it points at
    // the account's newest post *when it was first written*, so the target is held
    // rather than rewritten — a later run must not walk the like onto a newer post.
    await writeEdge({
      label: "adoption likes",
      table: reactions,
      target: reactions.id,
      hold: [reactions.targetId],
      rows: hostReactionRows,
    });

    await writeEdge({
      label: "adoption conversations",
      table: conversations,
      target: conversations.id,
      rows: hosts.map((host) => ({ id: conversationFor(host.id) })),
    });

    await writeEdge({
      label: "adoption chat members",
      table: conversationMembers,
      target: conversationMembers.id,
      rows: hosts.flatMap((host, index) => [
        {
          id: accountRowId("c6000000", host.id, "member"),
          conversationId: conversationFor(host.id),
          userId: host.id,
        },
        {
          id: accountRowId("c6100000", host.id, "member"),
          conversationId: conversationFor(host.id),
          userId: members[index % members.length].id,
        },
      ]),
    });

    await writeEdge({
      label: "adoption chat",
      table: messages,
      target: messages.id,
      // Held for the same reason as the member posts: the script's timestamps are
      // `now` minus an offset, so a repaired message keeps its place in the thread.
      hold: [messages.createdAt],
      rows: hosts.flatMap((host, index) => {
        const partner = members[index % members.length];
        return chatScript.map((line, lineIndex) => ({
          id: accountRowId("c7000000", host.id, "message", String(lineIndex)),
          conversationId: conversationFor(host.id),
          senderId: line.from === "host" ? host.id : partner.id,
          content: line.text,
          createdAt: new Date(now - (chatScript.length - lineIndex) * 11 * MINUTE),
        }));
      }),
    });

    // ── The inbox that engagement implies ─────────────────────────────
    // `notify_engagement` raises these rows as a by-product of the two inserts
    // above — but a trigger fires only on *insert*, and every row here is
    // `on conflict do nothing`. On a database that is already seeded the
    // engagement rows are already present, so the trigger stays silent and an
    // inbox cleared by hand never fills again. So the seed also states the
    // notifications its own engagement implies, and writes only the ones that
    // are missing: the `(user_id, source_user_id, type, target_id)` key the
    // trigger dedupes a reaction on — which cannot repeat for a follow, since a
    // pair has one row — the wording still the database's own
    // `notification_message`, and the actor's name resolved from
    // `users`/`profiles` exactly as the trigger resolves it. A row that comes
    // back this way is therefore the row the trigger would have written — and
    // on a first seed, where the trigger has just written all of them, this
    // pass inserts nothing.
    //
    // Scoped to the accounts this block adopts, deliberately: the cast's own
    // inboxes are the one viewer-scoped surface nobody can look at, since the
    // demo members have no credentials to sign in with.
    const postAuthor = new Map(allPosts.map((post) => [post.id, post.authorId]));
    const impliedInbox = [
      ...castFollowsHost.map((row) => ({
        id: accountRowId("c8000000", row.followerId, "follow", row.followingId),
        userId: row.followingId,
        type: "follow",
        sourceUserId: row.followerId,
        targetType: "user",
        targetId: row.followingId,
      })),
      // A reaction notifies the post's author, which is the account here.
      ...hostReactionRows.flatMap((row) => {
        const recipient = postAuthor.get(row.targetId);
        if (!recipient) return [];
        return [
          {
            id: accountRowId("c8000000", row.userId, "reaction", row.targetId),
            userId: recipient,
            type: "reaction",
            sourceUserId: row.userId,
            targetType: "post",
            targetId: row.targetId,
          },
        ];
      }),
    ];
    const candidates = sql.join(
      impliedInbox.map(
        (row) =>
          sql`(${row.id}::uuid, ${row.userId}::uuid, ${row.type}::text, ${row.sourceUserId}::uuid, ${row.targetType}::text, ${row.targetId}::uuid)`,
      ),
      sql`, `,
    );
    const restored = await db.execute(sql`
      insert into notifications (id, user_id, type, source_user_id, target_type, target_id, message)
      select v.id, v.user_id, v.type, v.source_user_id, v.target_type, v.target_id,
             notification_message(v.type, coalesce(profiles.display_name, users.username))
      from (values ${candidates})
        as v(id, user_id, type, source_user_id, target_type, target_id)
      join users on users.id = v.source_user_id
      left join profiles on profiles.user_id = users.id
      where not exists (
        select 1 from notifications existing
        where existing.user_id = v.user_id
          and existing.source_user_id = v.source_user_id
          and existing.type = v.type
          and existing.target_id = v.target_id
      )
      returning 1
    `);

    impliedNotifications = impliedInbox.length;
    restoredNotifications = restored.length;
  }

  // Restoring an edge re-fires the engagement trigger, and the trigger dedupes
  // only a reaction — so a repaired follow can leave two bells for one pair, and
  // the app never deletes either. Making the seed's rows the only rows is part of
  // the repair: for a follow or reaction key the earliest row stays and a later
  // duplicate of it goes. Comments are deliberately out of *that* sweep: two
  // comments by one member on one post are two events, and the same key twice is
  // correct, so a keep-the-earliest rule would delete an event rather than a
  // duplicate.
  const dropped = await db.execute(sql`
    delete from notifications
    where id in (
      select id from (
        select id, row_number() over (
          partition by user_id, source_user_id, type, target_id
          order by created_at, id
        ) as position
        from notifications
        where type in ('follow', 'reaction') and source_user_id is not null
      ) ranked
      where position > 1
    )
    returning 1
  `);

  // Comments need the same repair by a different rule: restoring one re-fires the
  // comment trigger, so its bell is raised a second time while the first one is
  // still there. "Which bells did *this* run raise?" would answer that only while
  // the run survives to ask — one killed between the restore and this point leaves
  // the repeat behind, indistinguishable from history on the next run — so the
  // invariant is the count instead: a comment key holds no more bells than there
  // are comments behind it, oldest first, and the surplus goes. That is exact where
  // it is applied, because a demo member has no credentials and so a key whose
  // commenter is one of them is nobody else's; it heals a repeat whichever run left
  // it; and on a database with no member comments, or with no bells for them, it
  // removes nothing.
  const memberIds = new Set(members.map((member) => member.id));
  const commentsBehind = new Map<string, number>();
  for (const row of await db
    .select({
      userId: posts.authorId,
      sourceUserId: comments.authorId,
      targetId: comments.postId,
      behind: count(),
    })
    .from(comments)
    .innerJoin(posts, eq(posts.id, comments.postId))
    .where(isNull(comments.deletedAt))
    .groupBy(posts.authorId, comments.authorId, comments.postId)) {
    // Nobody is notified about their own comment, so that row implies no bell and is
    // not a count to hold an inbox to.
    if (row.userId === row.sourceUserId || !memberIds.has(row.sourceUserId)) continue;
    commentsBehind.set(commentBellKey(row), row.behind);
  }

  const commentBells = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      sourceUserId: notifications.sourceUserId,
      targetId: notifications.targetId,
    })
    .from(notifications)
    .where(eq(notifications.type, "comment"))
    .orderBy(notifications.createdAt, notifications.id);
  const heldForComment = new Map<string, number>();
  const surplus: string[] = [];
  for (const bell of commentBells) {
    const key = commentBellKey(bell);
    const position = (heldForComment.get(key) ?? 0) + 1;
    heldForComment.set(key, position);
    const behind = commentsBehind.get(key);
    if (behind !== undefined && position > behind) surplus.push(bell.id);
  }
  if (surplus.length > 0) {
    await db.delete(notifications).where(inArray(notifications.id, surplus));
  }

  dedupedNotifications = dropped.length + surplus.length;

  console.log("");
  console.log("✓ Seeded demo data");
  console.log(`  members          ${members.length} (${members.map((member) => member.username).join(", ")})`);
  console.log(`  posts            ${postRows.length} spanning ~${Math.round((planned[planned.length - 1].createdAt.getTime() - now) / -DAY)} days`);
  console.log(`  post media       ${mediaRows.length} (${mediaRows.filter((row) => row.type.startsWith("image")).length} images, ${mediaRows.filter((row) => row.type.startsWith("video")).length} videos)`);
  console.log(`  comments         ${commentRows.length}, follows ${followRows.length}`);
  console.log(`  pages            ${demoPages.length} (${demoPages.map((page) => page.username).join(", ")}), ${pagePostRows.length} posts`);
  console.log(`  reactions        ${reactionRows.length}`);
  console.log(`  listing photos   ${listingPhotoRows.length} across ${listingRows.length} listings`);
  console.log(
    `  adopted accounts ${hosts.length}${hosts.length > 0 ? " (each follows the cast and its Pages, and has a conversation waiting)" : " (none to adopt)"}`,
  );
  if (hosts.length > 0) {
    console.log(
      `  notifications    ${impliedNotifications} implied by the adoption${restoredNotifications > 0 ? `, ${restoredNotifications} written back into inboxes that were missing them` : ""}`,
    );
  }

  // ─── What this run had to repair ──────────────────────────────────
  // "Safe to re-run" is only half of it. A preview database people click through
  // drifts — a row deleted by hand, a value edited, an inbox emptied — and a seed
  // that can only skip a row it already has cannot put one back. So the run names
  // every edge it had to repair, and says plainly when the answer is nothing.
  const restoredRows = repairs.reduce((total, repair) => total + repair.restored, 0);
  const rewrittenRows = repairs.reduce((total, repair) => total + repair.repaired, 0);
  const repairedTotal = restoredRows + rewrittenRows + restoredNotifications + dedupedNotifications;
  console.log("");
  if (firstSeed) {
    console.log(`  repair           first seed on this database — ${repairedTotal} rows written, nothing to repair`);
  } else if (repairedTotal === 0) {
    console.log("  repair           nothing — every demo edge already holds the seed's values");
  } else {
    console.log(`  repair           ${repairedTotal} row(s) put back to the seed's values:`);
    for (const repair of repairs) {
      if (repair.restored + repair.repaired === 0) continue;
      console.log(`    ${repair.label.padEnd(22)}${repair.restored} restored, ${repair.repaired} rewritten`);
    }
    if (restoredNotifications + dedupedNotifications > 0) {
      console.log(
        `    ${"notifications".padEnd(22)}${restoredNotifications} restored, ${dedupedNotifications} duplicate(s) dropped`,
      );
    }
  }
  console.log("");
  console.log("Demo members are content-only personas: they have no credentials, so they");
  console.log("cannot sign in. Adopted accounts are the ones that were already here — the");
  console.log("seed adds follows, Page follows, likes, conversations, messages and the");
  console.log("notifications that engagement implies to them, and edits or removes nothing");
  console.log("they already have.");
  if (videoUrls.size > 0) {
    console.log("Sample videos: Big Buck Bunny (CC-BY 3.0, Blender Foundation), mirrored into R2.");
  }
  console.log("Re-running this seed is safe, and it repairs: every row it holds is re-asserted on each");
  console.log("run, so a demo row deleted by hand comes back and an edited one is put back — while a row");
  console.log("the seed does not own is never read, matched or changed.");
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
