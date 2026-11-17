"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  Film,
  Heart,
  MessageCircle,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState } from "react";
import { CURRENT_USER, MOCK_SHORTS, MOCK_STORIES } from "@/data/mockData";
import { ShortVideoCanvas } from "@/components/cover-studio/short-video-canvas";
import { shortVideoTemplates } from "@/components/cover-studio/short-video-templates";
import type {
  CommunityGroup,
  JobOpportunity,
  MarketplaceItem,
  SocialPost,
  StoryItem,
  UserProfile,
} from "@/types/linkme";
import {
  useDesignReducedMotion,
  Avatar,
  Media,
  Video,
  card,
  coverMedia,
  mediaPoster,
  stagger,
} from "./primitives";

export function Feed({
  posts,
  onPost,
  onStory,
  onLike,
  onSave,
  onShare,
  compose,
}: {
  posts: SocialPost[];
  onPost: (post: SocialPost) => void;
  onStory: (story: StoryItem) => void;
  onLike: (id: string) => void;
  onSave: (id: string) => void;
  onShare: (id: string) => void;
  compose: () => void;
}) {
  const reduce = useDesignReducedMotion();
  return (
    <div className="ld-stack">
      <div className="ld-heading">
        <div>
          <h1>Home Feed</h1>
          <p>What your people are working on.</p>
        </div>
        <button className="ld-button ld-primary" onClick={compose}>
          New post
        </button>
      </div>
      <section className="ld-stories ld-glass" aria-label="Stories">
        {MOCK_STORIES.map((story) => (
          <motion.button
            key={story.id}
            type="button"
            layoutId={reduce ? undefined : "card-" + story.id}
            whileTap={reduce ? undefined : { scale: 0.98 }}
            onClick={() => onStory(story)}
          >
            <span className="ld-story-ring">
              <Avatar name={story.userName} url={story.userAvatar} />
            </span>
            <strong>{story.userName.split(" ")[0]}</strong>
            <small>{story.isLive ? "Live now" : story.timestamp}</small>
          </motion.button>
        ))}
      </section>
      <motion.div
        className="ld-stack"
        variants={stagger}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        {posts.map((post) => (
          <motion.article
            variants={card}
            key={post.id}
            layoutId={reduce ? undefined : "card-" + post.id}
            className="ld-glass ld-post"
          >
            <header className="ld-row">
              <Avatar name={post.author.name} url={post.author.avatarUrl} />
              <div>
                <strong>
                  {post.author.name}{" "}
                  {post.author.verified && (
                    <ShieldCheck
                      className="ld-verified"
                      size={15}
                      aria-label="Verified"
                    />
                  )}
                </strong>
                <p className="ld-meta">
                  {post.timestamp}
                  {post.communityTag ? " · " + post.communityTag : ""}
                </p>
              </div>
            </header>
            <button
              type="button"
              className="ld-post-open"
              onClick={() => onPost(post)}
              aria-label={"Open post by " + post.author.name}
            >
              <span>{post.content}</span>
              {post.mediaUrl && (
                <motion.div layoutId={reduce ? undefined : "media-" + post.id}>
                  {post.mediaType === "video" ? (
                    <Media src={mediaPoster} alt="Video post preview" />
                  ) : (
                    <Media
                      src={post.mediaUrl}
                      alt="Indigo and terracotta light rings"
                    />
                  )}
                </motion.div>
              )}
            </button>
            <div className="ld-reactions">
              <motion.button
                type="button"
                whileTap={reduce ? undefined : { scale: 0.98 }}
                aria-pressed={Boolean(post.isLiked)}
                onClick={() => onLike(post.id)}
              >
                <Heart size={16} /> {post.isLiked ? "Liked" : "Like"} ·{" "}
                {post.likes}
              </motion.button>
              <button type="button" onClick={() => onPost(post)}>
                <MessageCircle size={16} /> Comment · {post.commentsCount}
              </button>
              <button type="button" onClick={() => onShare(post.id)}>
                <Share2 size={16} /> Share
              </button>
              <button
                type="button"
                aria-pressed={Boolean(post.isBookmarked)}
                onClick={() => onSave(post.id)}
              >
                <Bookmark size={16} />{" "}
                {post.isBookmarked ? "Saved" : "Bookmark"}
              </button>
            </div>
          </motion.article>
        ))}
      </motion.div>
    </div>
  );
}

export function Shorts({ openStudio }: { openStudio: () => void }) {
  const [active, setActive] = useState(0);
  const [liked, setLiked] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const items = useRef<(HTMLElement | null)[]>([]);
  const reduce = useDesignReducedMotion();
  const clip = MOCK_SHORTS[active];
  function select(index: number) {
    const next = Math.min(MOCK_SHORTS.length - 1, Math.max(0, index));
    setActive(next);
    items.current[next]?.scrollIntoView({
      block: "nearest",
      behavior: reduce ? "instant" : "smooth",
    });
  }
  return (
    <div className="ld-stack">
      <div className="ld-heading">
        <div>
          <h1>Shorts</h1>
          <p>Clips from the creative community.</p>
        </div>
        <button className="ld-button ld-primary" onClick={openStudio}>
          <Film size={17} /> Open Short Video Studio
        </button>
      </div>
      <div className="ld-theater">
        <div
          className="ld-short-scroll"
          tabIndex={0}
          role="region"
          aria-label="Short videos. Use Up and Down to change clips."
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              select(active + (event.key === "ArrowDown" ? 1 : -1));
            }
          }}
          onScroll={(event) => {
            const node = event.currentTarget;
            const first = items.current[0];
            if (first)
              setActive(
                Math.min(
                  MOCK_SHORTS.length - 1,
                  Math.round(node.scrollTop / first.offsetHeight),
                ),
              );
          }}
        >
          {MOCK_SHORTS.map((item, index) => (
            <article
              ref={(node) => {
                items.current[index] = node;
              }}
              className="ld-short"
              key={item.id}
            >
              {index === active ? (
                <Video
                  key={item.id}
                  src={item.videoUrl}
                  poster={item.posterUrl || mediaPoster}
                  label={item.caption}
                />
              ) : (
                <Media src={item.posterUrl} alt="" />
              )}
              <div className="ld-short-copy">
                <span className="ld-chip">{item.studioStyle}</span>
                <strong>{item.author.name}</strong>
                <p>{item.caption}</p>
                <small>{item.audioTrack}</small>
              </div>
            </article>
          ))}
        </div>
        <div className="ld-short-actions">
          <button
            className="ld-icon"
            onClick={() => select(active - 1)}
            disabled={active === 0}
            aria-label="Previous short"
          >
            <ArrowUp size={18} />
          </button>
          <button
            className="ld-icon"
            onClick={() => select(active + 1)}
            disabled={active === MOCK_SHORTS.length - 1}
            aria-label="Next short"
          >
            <ArrowDown size={18} />
          </button>
          <button
            className="ld-icon"
            aria-label="Like short"
            aria-pressed={liked.includes(clip.id)}
            onClick={() =>
              setLiked((items) =>
                items.includes(clip.id)
                  ? items.filter((id) => id !== clip.id)
                  : [...items, clip.id],
              )
            }
          >
            <Heart size={18} />
          </button>
          <button
            className="ld-icon"
            aria-label="Save short"
            aria-pressed={saved.includes(clip.id)}
            onClick={() =>
              setSaved((items) =>
                items.includes(clip.id)
                  ? items.filter((id) => id !== clip.id)
                  : [...items, clip.id],
              )
            }
          >
            <Bookmark size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Studio({
  cover = false,
  theme,
  apply,
}: {
  cover?: boolean;
  theme?: UserProfile["coverStudioTheme"];
  apply?: (value: UserProfile["coverStudioTheme"]) => void;
}) {
  const reduce = useDesignReducedMotion();
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState(theme || "indigo-pulse");
  const [playingOverride, setPlaying] = useState<boolean | null>(null);
  const playing = playingOverride ?? !reduce;
  const template = shortVideoTemplates[index];
  return (
    <div className="ld-stack">
      {cover ? (
        <>
          <Video
            key={choice}
            {...coverMedia(choice)}
            className={"ld-cover ld-theme-" + choice}
            label="Selected cover video preview"
          />
          <label>
            Cover theme
            <select
              value={choice}
              onChange={(event) =>
                setChoice(event.target.value as UserProfile["coverStudioTheme"])
              }
            >
              <option value="obsidian-nebula">Obsidian Nebula</option>
              <option value="indigo-pulse">Indigo Pulse</option>
              <option value="terracotta-glow">Terracotta Glow</option>
            </select>
          </label>
          <button
            className="ld-button ld-primary"
            onClick={() => apply?.(choice)}
          >
            Apply cover
          </button>
        </>
      ) : (
        <>
          <div className="ld-studio-canvas">
            <ShortVideoCanvas
              template={template}
              subtitle="Short Video Studio"
              isPlaying={playing}
              className="ld-canvas"
            />
          </div>
          <label>
            Studio style
            <select
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
            >
              {shortVideoTemplates.map((style, i) => (
                <option value={i} key={style.id}>
                  {style.name} · Style {String(i + 1).padStart(2, "0")}/
                  {shortVideoTemplates.length}
                </option>
              ))}
            </select>
          </label>
          <p className="ld-meta">{template.description}</p>
          <button className="ld-button" onClick={() => setPlaying(!playing)}>
            {playing ? "Pause preview" : "Play preview"}
          </button>
        </>
      )}
    </div>
  );
}

export function Marketplace({
  listings,
  open,
  create,
}: {
  listings: MarketplaceItem[];
  open: (item: MarketplaceItem) => void;
  create: () => void;
}) {
  const [filter, setFilter] = useState("All");
  const reduce = useDesignReducedMotion();
  return (
    <div className="ld-stack">
      <div className="ld-heading">
        <div>
          <h1>Marketplace</h1>
          <p>Buy and sell with people you can get to know.</p>
        </div>
        <button className="ld-button ld-primary" onClick={create}>
          List item
        </button>
      </div>
      <div className="ld-row" aria-label="Listing category">
        {["All", "Tech & Gear", "Design Assets", "Workspace", "Apparel"].map(
          (category) => (
            <button
              className={
                "ld-button " + (filter === category ? "ld-selected" : "")
              }
              key={category}
              aria-pressed={filter === category}
              onClick={() => setFilter(category)}
            >
              {category}
            </button>
          ),
        )}
      </div>
      <motion.div
        layout={!reduce}
        className="ld-market-grid"
        variants={stagger}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        <AnimatePresence mode="popLayout">
          {listings
            .filter((item) => filter === "All" || item.category === filter)
            .map((item) => (
              <motion.article
                layout={!reduce}
                variants={card}
                exit={{ opacity: 0 }}
                key={item.id}
                layoutId={reduce ? undefined : "card-" + item.id}
                className="ld-glass ld-listing"
              >
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="ld-listing-open"
                >
                  <motion.div
                    layoutId={reduce ? undefined : "media-" + item.id}
                    className="ld-listing-media"
                  >
                    <Media src={item.imageUrl} alt="" />
                    <span className="ld-price">
                      {item.currency}
                      {item.price.toLocaleString("en-US")}
                    </span>
                  </motion.div>
                  <div className="ld-listing-copy">
                    <motion.h2
                      layoutId={reduce ? undefined : "title-" + item.id}
                    >
                      {item.title}
                    </motion.h2>
                    <span className="ld-chip">{item.condition}</span>
                    <p className="ld-meta">
                      {item.seller.name}{" "}
                      {item.seller.verified && (
                        <ShieldCheck
                          className="ld-verified"
                          size={15}
                          aria-label="Verified seller"
                        />
                      )}
                    </p>
                  </div>
                </button>
              </motion.article>
            ))}
        </AnimatePresence>
      </motion.div>
      {!listings.some(
        (item) => filter === "All" || item.category === filter,
      ) && (
        <p className="ld-glass ld-empty">No listings in this category yet.</p>
      )}
    </div>
  );
}

export function Jobs({
  jobs,
  apply,
  applied,
  create,
}: {
  jobs: JobOpportunity[];
  apply: (job: JobOpportunity) => void;
  applied: string[];
  create: () => void;
}) {
  const [selected, setSelected] = useState(jobs[0].id);
  const reduce = useDesignReducedMotion();
  const job = jobs.find((item) => item.id === selected) ?? jobs[0];
  return (
    <div className="ld-stack">
      <div className="ld-heading">
        <div>
          <h1>Jobs</h1>
          <p>Find your next move.</p>
        </div>
        <button className="ld-button ld-primary" onClick={create}>
          Post a job
        </button>
      </div>
      <div className="ld-job-grid">
        <motion.div
          className="ld-stack"
          variants={stagger}
          initial={reduce ? false : "hidden"}
          animate="show"
          aria-label="Open roles"
        >
          {jobs.map((item) => (
            <motion.button
              variants={card}
              whileHover={reduce ? undefined : { y: -3 }}
              key={item.id}
              className={
                "ld-glass ld-job-row " +
                (item.id === job.id ? "ld-selected" : "")
              }
              aria-pressed={item.id === job.id}
              onClick={() => setSelected(item.id)}
            >
              <div className="ld-row">
                <span className="ld-avatar">{item.companyLogo}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p className="ld-meta">
                    {item.company} · {item.postedAt}
                  </p>
                </div>
              </div>
              <div className="ld-row">
                <span className="ld-chip">{item.workModel}</span>
                {item.salaryRange && (
                  <span className="ld-chip">{item.salaryRange}</span>
                )}
              </div>
            </motion.button>
          ))}
        </motion.div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.article
            key={job.id}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="ld-glass ld-job-detail ld-stack"
          >
            <div>
              <h2>{job.title}</h2>
              <p className="ld-meta">
                {job.company} · {job.location}
              </p>
            </div>
            <p>{job.description}</p>
            {job.requirements.length > 0 && (
              <>
                <h3>What you’ll bring</h3>
                <ul>
                  {job.requirements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="ld-row">
              {job.tags.map((tag) => (
                <span className="ld-chip" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <button
              className="ld-button ld-primary"
              disabled={applied.includes(job.id)}
              onClick={() => apply(job)}
            >
              {applied.includes(job.id)
                ? "Application submitted"
                : "Quick Apply with LinkMe+ Profile"}
            </button>
          </motion.article>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Groups({
  groups,
  toggle,
}: {
  groups: CommunityGroup[];
  toggle: (id: string) => void;
}) {
  return (
    <div className="ld-stack">
      <div className="ld-heading">
        <div>
          <h1>Groups</h1>
          <p>Find a community around the work you care about.</p>
        </div>
      </div>
      <div className="ld-market-grid">
        {groups.map((group) => (
          <article key={group.id} className="ld-glass ld-group ld-stack">
            <Media src={group.bannerUrl} alt="" />
            <div className="ld-row ld-between">
              <span className="ld-chip">{group.category}</span>
              <span className="ld-meta">
                <span className="ld-dot" /> {group.activeNow} active
              </span>
            </div>
            <h2>{group.name}</h2>
            <p>{group.description}</p>
            <p className="ld-meta">{group.membersCount} members</p>
            <button
              className={
                "ld-button " + (group.isJoined ? "ld-selected" : "ld-primary")
              }
              aria-pressed={Boolean(group.isJoined)}
              onClick={() => toggle(group.id)}
            >
              {group.isJoined && <Check size={16} />}
              {group.isJoined ? "Joined" : "Join Community"}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

const profileTabs = [
  "Posts",
  "Shorts",
  "Marketplace Listings",
  "Groups",
  "Career / Resume",
] as const;
export function Profile({
  theme,
  posts,
  listings,
  groups,
  studio,
}: {
  theme: UserProfile["coverStudioTheme"];
  posts: SocialPost[];
  listings: MarketplaceItem[];
  groups: CommunityGroup[];
  studio: () => void;
}) {
  const [tab, setTab] = useState<(typeof profileTabs)[number]>("Posts");
  const profile = CURRENT_USER;
  const activity = [
    posts
      .filter((post) => post.author.id === profile.id)
      .map((post) => post.content),
    MOCK_SHORTS.filter((short) => short.author.id === profile.id).map(
      (short) => short.caption,
    ),
    listings
      .filter((item) => item.seller.id === profile.id)
      .map((item) => item.title),
    groups.filter((group) => group.isJoined).map((group) => group.name),
    profile.experience.map((job) =>
      [job.title, job.company, job.period].join(" · "),
    ),
  ][profileTabs.indexOf(tab)];
  return (
    <div className="ld-stack">
      <div className="ld-heading">
        <div>
          <h1>Profile</h1>
          <p>Your public presence on LinkMe+.</p>
        </div>
      </div>
      <section className="ld-glass ld-profile">
        <Video
          {...coverMedia(theme)}
          className={"ld-cover ld-theme-" + theme}
          label="Ambient profile cover"
        />
        <div className="ld-profile-body ld-stack">
          <div className="ld-row ld-between">
            <Avatar name={profile.name} url={profile.avatarUrl} large />
            <button className="ld-button" onClick={studio}>
              Customize in Cover Studio
            </button>
          </div>
          <div>
            <h2>
              {profile.name}{" "}
              <ShieldCheck
                className="ld-verified"
                size={17}
                aria-label="Verified"
              />
            </h2>
            <p className="ld-meta">
              {profile.handle} · {profile.role}
            </p>
          </div>
          <p>{profile.bio}</p>
          <div className="ld-row">
            {Object.entries(profile.stats).map(([label, value]) => (
              <span key={label}>
                <strong>{value.toLocaleString("en-US")}</strong>{" "}
                <span className="ld-meta">{label}</span>
              </span>
            ))}
          </div>
          <div className="ld-profile-tabs" aria-label="Profile sections">
            {profileTabs.map((item) => (
              <button
                key={item}
                aria-pressed={tab === item}
                onClick={() => setTab(item)}
              >
                {item}
                {tab === item && <motion.span layoutId="profileTabUnderline" />}
              </button>
            ))}
          </div>
          <section aria-label={tab} className="ld-stack">
            {activity.length ? (
              activity.map((item) => (
                <p className="ld-profile-item" key={item}>
                  {item}
                </p>
              ))
            ) : (
              <p className="ld-meta">No {tab.toLowerCase()} to show yet.</p>
            )}
            {tab === "Shorts" && (
              <Link href="/design/shorts">Browse Shorts</Link>
            )}
            {tab === "Career / Resume" && (
              <div className="ld-row">
                {profile.skills.map((skill) => (
                  <span className="ld-chip" key={skill}>
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
