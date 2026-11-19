"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
} from "framer-motion";
import {
  BriefcaseBusiness,
  Film,
  House,
  Menu,
  MessageCircle,
  Plus,
  Search,
  ShoppingBag,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  CURRENT_USER,
  MOCK_CHATS,
  MOCK_GROUPS,
  MOCK_JOBS,
  MOCK_MARKETPLACE,
  MOCK_POSTS,
} from "@/data/mockData";
import type {
  ChatThread,
  JobOpportunity,
  MarketplaceItem,
  NavRoute,
  StoryItem,
  UserProfile,
} from "@/types/linkme";
import { Auth, Brand, Landing } from "./public-views";
import {
  useDesignReducedMotion,
  Avatar,
  Media,
  Overlay,
  Video,
  mediaPoster,
} from "./primitives";
import {
  Feed,
  Groups,
  Jobs,
  Marketplace,
  Profile,
  Shorts,
  Studio,
} from "./modules";
import { CreateForm, Messages, type Draft, type DraftKind } from "./forms";
import "./linkme-design.css";

const nav = [
  { route: "home", label: "Home Feed", mobile: "Home", icon: House },
  { route: "shorts", label: "Shorts", mobile: "Shorts", icon: Film },
  {
    route: "marketplace",
    label: "Marketplace",
    mobile: "Market",
    icon: ShoppingBag,
  },
  { route: "jobs", label: "Jobs", mobile: "Jobs", icon: BriefcaseBusiness },
  { route: "groups", label: "Groups", mobile: "Groups", icon: UsersRound },
  {
    route: "messages",
    label: "Messages",
    mobile: "Messages",
    icon: MessageCircle,
  },
  { route: "profile", label: "Profile", mobile: "Profile", icon: UserRound },
] as const;
type Modal =
  | { kind: "post"; id: string }
  | { kind: "story"; story: StoryItem }
  | { kind: "listing"; item: MarketplaceItem }
  | { kind: "apply"; job: JobOpportunity }
  | { kind: "studio" | "cover" | "create" | "messages" | "nav" }
  | { kind: "draft"; draft: DraftKind };
const createNames = {
  post: "New post",
  listing: "List item",
  job: "Post a job",
};
const routePath = (route: NavRoute) =>
  route === "landing" ? "/design" : "/design/" + route;
const createId = () => crypto.randomUUID();

function Navigation({
  route,
  mobile = false,
  more,
}: {
  route: NavRoute;
  mobile?: boolean;
  more?: () => void;
}) {
  return (
    <nav
      className={mobile ? "ld-mobile-nav" : "ld-nav-list"}
      aria-label={mobile ? "Mobile navigation" : "Primary navigation"}
    >
      {(mobile ? nav.slice(0, 4) : nav).map(
        ({ route: item, label, mobile: short, icon: Icon }) => (
          <Link
            key={item}
            href={routePath(item)}
            aria-current={route === item ? "page" : undefined}
          >
            {route === item && (
              <motion.span
                layoutId={mobile ? "activeMobileNavPill" : "activeNavPill"}
                className="ld-nav-pill"
              />
            )}
            <Icon size={19} aria-hidden="true" />
            <span>{mobile ? short : label}</span>
          </Link>
        ),
      )}
      {mobile && (
        <button type="button" onClick={more}>
          <Menu size={19} aria-hidden="true" />
          <span>More</span>
        </button>
      )}
    </nav>
  );
}

export function LinkMeDesign() {
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="linkme-design">
        <Design />
      </LayoutGroup>
    </MotionConfig>
  );
}

function Design() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const segment = pathname?.split("/")[2];
  const route: NavRoute =
    segment === "login"
      ? "login"
      : (nav.find((item) => item.route === segment)?.route ?? "landing");
  const reduce = useDesignReducedMotion();
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState("");
  const [posts, setPosts] = useState(MOCK_POSTS);
  const [comments, setComments] = useState<Record<string, string[]>>({});
  const [listings, setListings] = useState(MOCK_MARKETPLACE);
  const [pendingJobs, setPendingJobs] = useState<string[]>([]);
  const [groups, setGroups] = useState(MOCK_GROUPS);
  const [chats, setChats] = useState(MOCK_CHATS);
  const [threadId, setThreadId] = useState(MOCK_CHATS[0].id);
  const [applied, setApplied] = useState<string[]>([]);
  const [theme, setTheme] = useState<UserProfile["coverStudioTheme"]>(
    CURRENT_USER.coverStudioTheme,
  );
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  function open(next: Modal) {
    setNotice("");
    setModal(next);
  }
  function close() {
    setModal(null);
  }
  function go(next: NavRoute) {
    close();
    setSearchOpen(false);
    router.push(routePath(next));
  }
  function confirm(message: string) {
    close();
    setNotice(message);
  }
  function selectChat(id: string) {
    setThreadId(id);
    setChats((items) =>
      items.map((item) =>
        item.id === id ? { ...item, unreadCount: 0 } : item,
      ),
    );
  }
  function send(thread: string, text: string) {
    const message = {
      id: createId(),
      senderId: CURRENT_USER.id,
      text,
      timestamp: "Just now",
    };
    setChats((items) =>
      items.map((item) =>
        item.id === thread
          ? {
              ...item,
              lastMessage: text,
              messages: [...item.messages, message],
            }
          : item,
      ),
    );
  }
  function contact(seller: MarketplaceItem["seller"]) {
    if (seller.id === CURRENT_USER.id) return;
    const match = chats.find((item) => item.participant.id === seller.id);
    if (match) selectChat(match.id);
    else {
      const thread: ChatThread = {
        id: createId(),
        participant: { ...seller, online: false },
        lastMessage: "",
        unreadCount: 0,
        messages: [],
      };
      setChats((items) => [...items, thread]);
      setThreadId(thread.id);
    }
    open({ kind: "messages" });
  }
  function publish(draft: Draft) {
    const id = createId();
    if (draft.kind === "post") {
      setPosts((items) => [
        {
          id,
          author: CURRENT_USER,
          content: draft.content,
          timestamp: "Just now",
          likes: 0,
          commentsCount: 0,
          shares: 0,
        },
        ...items,
      ]);
      go("home");
      setNotice("Post published in the preview.");
    } else if (draft.kind === "listing") {
      setListings((items) => [
        {
          ...draft,
          id,
          currency: "$",
          imageUrl: mediaPoster,
          seller: { ...CURRENT_USER, rating: 0 },
        },
        ...items,
      ]);
      go("marketplace");
      setNotice("Listing published in the preview.");
    } else {
      setPendingJobs((items) => [...items, draft.title]);
      go("jobs");
      setNotice("Sample job submitted for review.");
    }
  }
  function addComment(id: string, text: string) {
    setComments((items) => ({ ...items, [id]: [...(items[id] ?? []), text] }));
    setPosts((items) =>
      items.map((post) =>
        post.id === id
          ? { ...post, commentsCount: post.commentsCount + 1 }
          : post,
      ),
    );
  }
  function share(id: string) {
    const url = new URL(routePath("home"), window.location.origin);
    url.searchParams.set("post", id);
    if (!navigator.clipboard) {
      setNotice("Copy the feed link from your browser to share it.");
      return;
    }
    void navigator.clipboard.writeText(url.href).then(
      () => setNotice("Link copied."),
      () => setNotice("Copy the feed link from your browser to share it."),
    );
  }
  const results = [
    ...posts.map((post) => ({
      id: post.id,
      label: post.author.name + " · " + post.content,
      open: () => {
        open({ kind: "post", id: post.id });
        setSearchOpen(false);
      },
    })),
    ...listings.map((item) => ({
      id: item.id,
      label: item.title,
      open: () => {
        open({ kind: "listing", item });
        setSearchOpen(false);
      },
    })),
    ...MOCK_JOBS.map((job) => ({
      id: job.id,
      label: job.title,
      open: () => go("jobs"),
    })),
    ...groups.map((group) => ({
      id: group.id,
      label: group.name,
      open: () => go("groups"),
    })),
  ]
    .filter(
      (item) =>
        search.trim() &&
        item.label.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .slice(0, 5);

  const shareId = route === "home" ? params?.get("post") : undefined;
  const sharedPost = shareId && posts.find((post) => post.id === shareId);
  const visibleModal =
    modal ??
    (sharedPost ? ({ kind: "post", id: sharedPost.id } as const) : null);
  const post =
    visibleModal?.kind === "post"
      ? posts.find((item) => item.id === visibleModal.id)
      : undefined;

  function modalContent(): {
    title: string;
    children: ReactNode;
    layoutId?: string;
    titleLayoutId?: string;
    drawer?: boolean;
    fullscreen?: boolean;
  } | null {
    if (!visibleModal) return null;
    switch (visibleModal.kind) {
      case "post":
        if (!post) return null;
        return {
          title: "Post by " + post.author.name,
          layoutId: "card-" + post.id,
          children: (
            <div className="ld-stack">
              <div className="ld-row">
                <Avatar name={post.author.name} url={post.author.avatarUrl} />
                <p className="ld-meta">
                  {post.timestamp} · {post.author.role}
                </p>
              </div>
              <p>{post.content}</p>
              {post.mediaUrl && (
                <motion.div layoutId={reduce ? undefined : "media-" + post.id}>
                  {post.mediaType === "video" ? (
                    <Video src={post.mediaUrl} label="Post video" />
                  ) : (
                    <Media
                      src={post.mediaUrl}
                      alt="Indigo and terracotta light rings"
                    />
                  )}
                </motion.div>
              )}
              <h3>Comments</h3>
              {(comments[post.id] ?? []).map((comment, index) => (
                <p className="ld-bubble" key={index}>
                  {comment}
                </p>
              ))}
              <form
                className="ld-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const value = String(
                    new FormData(form).get("comment") ?? "",
                  ).trim();
                  if (value) {
                    addComment(post.id, value);
                    form.reset();
                  }
                }}
              >
                <label>
                  Write a comment
                  <textarea name="comment" required rows={2} maxLength={1000} />
                </label>
                <button className="ld-button ld-primary">Post comment</button>
              </form>
            </div>
          ),
        };
      case "story": {
        const story = visibleModal.story;
        return {
          title: story.userName + " · " + story.timestamp,
          layoutId: "card-" + story.id,
          fullscreen: true,
          children: (
            <motion.div layoutId={reduce ? undefined : "media-" + story.id}>
              <Media
                src={story.mediaUrl}
                alt={"Story preview by " + story.userName}
                className="ld-story-media"
              />
            </motion.div>
          ),
        };
      }
      case "listing": {
        const item = visibleModal.item;
        return {
          title: item.title,
          drawer: true,
          layoutId: "card-" + item.id,
          titleLayoutId: "title-" + item.id,
          children: (
            <div className="ld-stack">
              <motion.div layoutId={reduce ? undefined : "media-" + item.id}>
                <Media
                  src={item.imageUrl}
                  alt={item.title}
                  className="ld-detail-media"
                />
              </motion.div>
              <div className="ld-row">
                <strong>
                  {item.currency}
                  {item.price.toLocaleString("en-US")}
                </strong>
                <span className="ld-chip">{item.condition}</span>
                <span className="ld-chip">{item.location}</span>
              </div>
              <p>{item.description}</p>
              <div className="ld-row">
                <Avatar name={item.seller.name} url={item.seller.avatarUrl} />
                <div>
                  <strong>{item.seller.name}</strong>
                  <p className="ld-meta">
                    {item.seller.verified ? "Verified seller" : "Seller"}
                    {item.seller.rating > 0 &&
                      " · " + item.seller.rating + "/5"}
                  </p>
                </div>
              </div>
              {item.seller.id !== CURRENT_USER.id && (
                <button
                  className="ld-button ld-primary"
                  onClick={() => contact(item.seller)}
                >
                  Message Seller
                </button>
              )}
            </div>
          ),
        };
      }
      case "apply": {
        const job = visibleModal.job;
        return {
          title: "Quick Apply",
          children: (
            <div className="ld-stack">
              <h3>{job.title}</h3>
              <p className="ld-meta">
                {job.company} · {job.workModel}
              </p>
              <div className="ld-row">
                <Avatar name={CURRENT_USER.name} url={CURRENT_USER.avatarUrl} />
                <strong>{CURRENT_USER.name}</strong>
              </div>
              <Video
                src={CURRENT_USER.coverVideoUrl}
                label="Applicant video profile preview"
              />
              <form
                className="ld-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  setApplied((items) =>
                    items.includes(job.id) ? items : [...items, job.id],
                  );
                  confirm("Sample application submitted.");
                }}
              >
                <label className="ld-check">
                  <input type="checkbox" required /> Include my video profile in
                  this sample application
                </label>
                <button className="ld-button ld-primary">
                  Submit application
                </button>
              </form>
            </div>
          ),
        };
      }
      case "studio":
        return { title: "Short Video Studio", children: <Studio /> };
      case "cover":
        return {
          title: "Cover Studio",
          children: (
            <Studio
              cover
              theme={theme}
              apply={(value) => {
                setTheme(value);
                confirm("Profile cover updated.");
              }}
            />
          ),
        };
      case "draft":
        return {
          title: createNames[visibleModal.draft],
          children: <CreateForm kind={visibleModal.draft} submit={publish} />,
        };
      case "messages":
        return {
          title: "Direct Messages",
          drawer: true,
          children: (
            <Messages
              threads={chats}
              selected={threadId}
              select={selectChat}
              send={send}
              compact
            />
          ),
        };
      case "create":
        return {
          title: "Create",
          children: (
            <div className="ld-stack">
              {(["post", "listing", "job"] as const).map((draft) => (
                <button
                  className="ld-button"
                  key={draft}
                  onClick={() => open({ kind: "draft", draft })}
                >
                  {createNames[draft]}
                </button>
              ))}
              <button
                className="ld-button"
                onClick={() => open({ kind: "studio" })}
              >
                Short Video Studio
              </button>
            </div>
          ),
        };
      case "nav":
        return {
          title: "More",
          children: (
            <div className="ld-stack">
              {nav.slice(4).map((item) => (
                <button
                  className="ld-button"
                  key={item.route}
                  onClick={() => go(item.route)}
                >
                  {item.label}
                </button>
              ))}
              <button
                className="ld-button ld-primary"
                onClick={() => open({ kind: "create" })}
              >
                <Plus size={18} /> Create
              </button>
            </div>
          ),
        };
    }
  }
  const dialog = modalContent();
  const draft = (kind: DraftKind) => open({ kind: "draft", draft: kind });
  const screens: Record<Exclude<NavRoute, "landing" | "login">, ReactNode> = {
    home: (
      <Feed
        posts={posts}
        onPost={(item) => open({ kind: "post", id: item.id })}
        onStory={(story) => open({ kind: "story", story })}
        onLike={(id) =>
          setPosts((items) =>
            items.map((post) =>
              post.id === id
                ? {
                    ...post,
                    isLiked: !post.isLiked,
                    likes: post.likes + (post.isLiked ? -1 : 1),
                  }
                : post,
            ),
          )
        }
        onSave={(id) =>
          setPosts((items) =>
            items.map((post) =>
              post.id === id
                ? { ...post, isBookmarked: !post.isBookmarked }
                : post,
            ),
          )
        }
        onShare={share}
        compose={() => draft("post")}
      />
    ),
    shorts: <Shorts openStudio={() => open({ kind: "studio" })} />,
    marketplace: (
      <Marketplace
        listings={listings}
        open={(item) => open({ kind: "listing", item })}
        create={() => draft("listing")}
      />
    ),
    jobs: (
      <>
        <Jobs
          jobs={MOCK_JOBS}
          applied={applied}
          apply={(job) => open({ kind: "apply", job })}
          create={() => draft("job")}
        />
        {pendingJobs.length > 0 && (
          <section className="ld-glass ld-pending ld-stack">
            <h2>Your submissions</h2>
            {pendingJobs.map((job, index) => (
              <div className="ld-row ld-between" key={index}>
                {job}
                <span className="ld-chip">Pending review</span>
              </div>
            ))}
          </section>
        )}
      </>
    ),
    groups: (
      <Groups
        groups={groups}
        toggle={(id) =>
          setGroups((items) =>
            items.map((group) =>
              group.id === id ? { ...group, isJoined: !group.isJoined } : group,
            ),
          )
        }
      />
    ),
    messages: (
      <Messages
        threads={chats}
        selected={threadId}
        select={selectChat}
        send={send}
      />
    ),
    profile: (
      <Profile
        theme={theme}
        posts={posts}
        listings={listings}
        groups={groups}
        studio={() => open({ kind: "cover" })}
      />
    ),
  };
  const publicRoute = route === "landing" || route === "login";
  const transition = { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const };
  return (
    <div className="ld-root">
      <div className="ld-ambient" aria-hidden="true" />
      <AnimatePresence mode="wait" initial={false}>
        {publicRoute ? (
          <motion.div
            key={route}
            initial={
              reduce ? false : { opacity: 0, y: 16, filter: "blur(6px)" }
            }
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.985, filter: "blur(6px)" }
            }
            transition={transition}
          >
            {route === "landing" ? (
              <Landing />
            ) : (
              <Auth
                signup={params?.get("mode") === "signup"}
                setSignup={(value) =>
                  router.replace(
                    routePath("login") + (value ? "?mode=signup" : ""),
                  )
                }
                enter={() => go("home")}
              />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="shell"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={transition}
            className="ld-shell"
          >
            <aside className="ld-sidebar">
              <Brand />
              <Navigation route={route} />
              <button
                className="ld-button ld-primary"
                onClick={() => open({ kind: "create" })}
              >
                <Plus size={18} /> Create
              </button>
              <Link
                className="ld-row ld-side-profile"
                href={routePath("profile")}
              >
                <Avatar name={CURRENT_USER.name} url={CURRENT_USER.avatarUrl} />
                <span>
                  <strong>{CURRENT_USER.name}</strong>
                  <small>{CURRENT_USER.handle}</small>
                </span>
              </Link>
            </aside>
            <header className="ld-mobile-header">
              <Brand />
              <button
                className="ld-icon"
                onClick={() => open({ kind: "create" })}
                aria-label="Create"
              >
                <Plus size={20} />
              </button>
            </header>
            <main className="ld-stage">
              <p role="status" className={notice ? "ld-notice" : "sr-only"}>
                {notice}
              </p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={route}
                  initial={
                    reduce ? false : { opacity: 0, y: 16, filter: "blur(6px)" }
                  }
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={
                    reduce
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.985, filter: "blur(6px)" }
                  }
                  transition={transition}
                >
                  {screens[route]}
                </motion.div>
              </AnimatePresence>
            </main>
            <aside className="ld-context">
              <div className="ld-search ld-glass">
                <Search size={18} />
                <label className="sr-only" htmlFor="ld-search">
                  Search LinkMe+
                </label>
                <input
                  id="ld-search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSearchOpen(false);
                  }}
                  placeholder="Search LinkMe+"
                />
              </div>
              {searchOpen && search.trim() && (
                <section
                  className="ld-glass ld-stack ld-widget"
                  aria-label="Search results"
                >
                  {results.length ? (
                    results.map((item) => (
                      <button
                        className="ld-search-result"
                        key={item.id}
                        onClick={item.open}
                      >
                        {item.label}
                      </button>
                    ))
                  ) : (
                    <p>No results found.</p>
                  )}
                </section>
              )}
              <details className="ld-glass ld-widget" open>
                <summary>Direct Messages</summary>
                <div className="ld-stack ld-widget-list">
                  {chats.slice(0, 3).map((thread) => (
                    <button
                      className="ld-contact"
                      key={thread.id}
                      onClick={() => {
                        selectChat(thread.id);
                        open({ kind: "messages" });
                      }}
                    >
                      <Avatar
                        name={thread.participant.name}
                        url={thread.participant.avatarUrl}
                      />
                      <span>
                        <strong>{thread.participant.name}</strong>
                        <small>
                          {thread.lastMessage || "Start a conversation"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </details>
              {route === "jobs" ? (
                <section className="ld-glass ld-widget ld-stack">
                  <h2>Featured roles</h2>
                  {MOCK_JOBS.map((job) => (
                    <button
                      className="ld-search-result"
                      key={job.id}
                      disabled={applied.includes(job.id)}
                      onClick={() => open({ kind: "apply", job })}
                    >
                      {job.title}
                    </button>
                  ))}
                </section>
              ) : (
                <section className="ld-glass ld-widget ld-stack">
                  <h2>
                    {route === "shorts"
                      ? "Suggested creators"
                      : "Trending communities"}
                  </h2>
                  {route === "shorts" ? (
                    <Link href={routePath("profile")}>{CURRENT_USER.name}</Link>
                  ) : (
                    groups.map((group) => (
                      <Link href={routePath("groups")} key={group.id}>
                        <strong>{group.name}</strong>
                        <p className="ld-meta">{group.membersCount} members</p>
                      </Link>
                    ))
                  )}
                </section>
              )}
              <div className="ld-row ld-context-links">
                <Link href="/help">Help</Link>
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
              </div>
            </aside>
            <Navigation
              route={route}
              mobile
              more={() => open({ kind: "nav" })}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <Overlay
        open={Boolean(dialog)}
        title={dialog?.title ?? ""}
        layoutId={dialog?.layoutId}
        titleLayoutId={dialog?.titleLayoutId}
        drawer={dialog?.drawer}
        fullscreen={dialog?.fullscreen}
        onClose={() => {
          close();
          if (shareId) router.replace(routePath("home"), { scroll: false });
        }}
      >
        {dialog?.children}
      </Overlay>
    </div>
  );
}
