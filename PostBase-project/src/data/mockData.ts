import type {
  UserProfile,
  StoryItem,
  SocialPost,
  ShortVideo,
  MarketplaceItem,
  JobOpportunity,
  CommunityGroup,
  ChatThread,
} from "../types/linkme";

export const CURRENT_USER: UserProfile = {
  id: "u-sarah",
  name: "Sarah Chen",
  handle: "@sarahchen",
  role: "Product Designer & Creative Technologist",
  bio: "Designing calm digital spaces, glassmorphic interfaces, and modular design systems. Building in public on LinkMe+.",
  avatarUrl: "",
  coverVideoUrl: "/design-media/ambient.webm",
  coverStudioTheme: "indigo-pulse",
  verified: true,
  stats: {
    connections: 1420,
    followers: 8940,
    posts: 164,
  },
  skills: [
    "UI/UX Design",
    "React & TypeScript",
    "Motion Systems",
    "Design Tokens",
    "Prototyping",
  ],
  experience: [
    {
      id: "exp-1",
      title: "Lead Product Designer",
      company: "LinkMe+ Studio",
      period: "2024 — Present",
      location: "Remote",
    },
    {
      id: "exp-2",
      title: "Senior Interface Architect",
      company: "Vespera Labs",
      period: "2021 — 2024",
      location: "San Francisco, CA",
    },
  ],
};

export const MOCK_STORIES: StoryItem[] = [
  {
    id: "st-1",
    userId: "u-sarah",
    userName: "Sarah Chen",
    userAvatar: "",
    mediaUrl: "/design-media/ambient.webp",
    isLive: true,
    timestamp: "Live now",
  },
  {
    id: "st-2",
    userId: "u-marcus",
    userName: "Marcus Reid",
    userAvatar: "",
    mediaUrl: "/design-media/ambient.webp",
    timestamp: "18m ago",
  },
  {
    id: "st-3",
    userId: "u-elena",
    userName: "Elena Vance",
    userAvatar: "",
    mediaUrl: "/design-media/ambient.webp",
    timestamp: "1h ago",
  },
  {
    id: "st-4",
    userId: "u-devon",
    userName: "Devon Park",
    userAvatar: "",
    mediaUrl: "/design-media/ambient.webp",
    timestamp: "3h ago",
  },
];

export const MOCK_POSTS: SocialPost[] = [
  {
    id: "post-1",
    author: {
      id: "u-sarah",
      name: "Sarah Chen",
      handle: "@sarahchen",
      avatarUrl: "",
      role: "Product Designer",
      verified: true,
    },
    communityTag: "Community · Design Systems",
    timestamp: "Just now",
    content:
      "Small steps. Big ideas. Building something beautiful today with our new obsidian glassmorphic tokens and ambient cover motion.",
    mediaUrl: "/design-media/ambient.webp",
    mediaType: "image",
    likes: 148,
    commentsCount: 24,
    shares: 12,
    isLiked: true,
  },
  {
    id: "post-2",
    author: {
      id: "u-marcus",
      name: "Marcus Reid",
      handle: "@marcusbuilds",
      avatarUrl: "",
      role: "Full-Stack Engineer",
      verified: true,
    },
    communityTag: "Community · Indie Founders",
    timestamp: "2h ago",
    content:
      "Just shipped our zero-latency WebSocket layer for LinkMe+ direct messages. Keeping social interactions calm, fast, and clutter-free.",
    likes: 312,
    commentsCount: 41,
    shares: 29,
  },
];

export const MOCK_SHORTS: ShortVideo[] = [
  {
    id: "short-1",
    author: {
      id: "u-sarah",
      name: "Sarah Chen",
      handle: "@sarahchen",
      avatarUrl: "",
      verified: true,
    },
    videoUrl: "/design-media/ambient.webm",
    posterUrl: "/design-media/ambient.webp",
    caption: "Testing dynamic kinetic typography inside Short Video Studio.",
    studioStyle: "Marquee Wall · Style 01/30",
    audioTrack: "Original Studio Loop — Midnight Obsidian",
    likes: 2410,
    commentsCount: 134,
    shares: 89,
  },
  {
    id: "short-2",
    author: {
      id: "u-elena",
      name: "Elena Vance",
      handle: "@elenavance",
      avatarUrl: "",
      verified: true,
    },
    videoUrl: "/design-media/terracotta.webm",
    posterUrl: "/design-media/terracotta.webp",
    caption: "Late-night desk setup tour + ambient lighting presets.",
    studioStyle: "Glass Prism · Style 07/30",
    audioTrack: "Lofi Pulse — Deep Indigo Mix",
    likes: 1890,
    commentsCount: 92,
    shares: 54,
  },
];

export const MOCK_MARKETPLACE: MarketplaceItem[] = [
  {
    id: "mkt-1",
    title: "Obsidian Glass UI Kit (Figma + React)",
    price: 48,
    currency: "$",
    category: "Design Assets",
    condition: "Digital Download",
    location: "Instant Delivery",
    imageUrl: "/design-media/ambient.webp",
    description:
      "120+ dark-mode glassmorphic components, Tailwind CSS v4 tokens, and Framer Motion presets.",
    seller: {
      id: "u-sarah",
      name: "Sarah Chen",
      handle: "@sarahchen",
      avatarUrl: "",
      verified: true,
      rating: 4.98,
    },
  },
  {
    id: "mkt-2",
    title: "Custom 65% Aluminum Mechanical Keyboard",
    price: 265,
    currency: "$",
    category: "Workspace",
    condition: "Like New",
    location: "San Francisco, CA",
    imageUrl: "/design-media/keyboard.webp",
    description:
      "Anodized deep violet chassis, tactile linear switches, PBT keycaps, and coiled USB-C cable.",
    seller: {
      id: "u-marcus",
      name: "Marcus Reid",
      handle: "@marcusbuilds",
      avatarUrl: "",
      verified: true,
      rating: 4.95,
    },
  },
  {
    id: "mkt-3",
    title: "Sony A7C II Mirrorless Camera Body",
    price: 1790,
    currency: "$",
    category: "Tech & Gear",
    condition: "Like New",
    location: "New York, NY",
    imageUrl: "/design-media/camera.webp",
    description:
      "Low shutter count (under 2,400), includes original box, battery, and Peak Design strap.",
    seller: {
      id: "u-devon",
      name: "Devon Park",
      handle: "@devonframes",
      avatarUrl: "",
      verified: true,
      rating: 5.0,
    },
  },
];

export const MOCK_JOBS: JobOpportunity[] = [
  {
    id: "job-1",
    title: "Senior Design Engineer (Motion & Systems)",
    company: "LinkMe+",
    companyLogo: "L+",
    location: "Remote (Global)",
    workModel: "Remote",
    salaryRange: "$165K – $210K",
    postedAt: "2h ago",
    tags: ["React", "TypeScript", "Framer Motion", "Design Systems"],
    description:
      "Lead the evolution of Cover Studio and Short Video Studio interfaces, crafting responsive, high-trust social tools.",
    requirements: [
      "4+ years building production React & TypeScript web applications.",
      "Deep mastery of CSS architecture, Tailwind CSS, and physics-based UI animation.",
      "Portfolio demonstrating high visual craft and interaction sensitivity.",
    ],
  },
  {
    id: "job-2",
    title: "Product Lead, Creator Marketplace",
    company: "Aether Commerce",
    companyLogo: "AC",
    location: "San Francisco / Hybrid",
    workModel: "Hybrid",
    salaryRange: "$180K – $225K",
    postedAt: "1d ago",
    tags: ["Product Strategy", "Peer-to-Peer", "Trust & Safety"],
    description:
      "Shape peer-to-peer digital and physical commerce experiences for independent creators and studios.",
    requirements: [
      "Proven track record scaling marketplace or creator monetization products.",
      "Strong analytical mindset paired with user-first product intuition.",
    ],
  },
];

export const MOCK_GROUPS: CommunityGroup[] = [
  {
    id: "grp-1",
    name: "Design Systems & Motion",
    category: "Design & Craft",
    membersCount: "14.2K",
    activeNow: 342,
    bannerUrl: "/design-media/ambient.webp",
    description:
      "Sharing component architectures, shaders, and micro-interaction studies.",
    isJoined: true,
  },
  {
    id: "grp-2",
    name: "Indie Builders & Founders",
    category: "Startups",
    membersCount: "22.8K",
    activeNow: 518,
    bannerUrl: "/design-media/ambient.webp",
    description:
      "Weekly shipping logs, honest feedback, and collaborator matching.",
    isJoined: false,
  },
];

export const MOCK_CHATS: ChatThread[] = [
  {
    id: "chat-1",
    participant: {
      id: "u-marcus",
      name: "Marcus Reid",
      handle: "@marcusbuilds",
      avatarUrl: "",
      online: true,
    },

    lastMessage: "Love the new Marquee Wall preset in Short Studio!",
    unreadCount: 2,
    messages: [
      {
        id: "m-1",
        senderId: "u-marcus",
        text: "Hey Sarah! Just saw your Cover Studio update.",
        timestamp: "10:14 AM",
      },
      {
        id: "m-2",
        senderId: "u-marcus",
        text: "Love the new Marquee Wall preset in Short Studio!",
        timestamp: "10:15 AM",
      },
    ],
  },
  {
    id: "chat-2",
    participant: {
      id: "u-elena",
      name: "Elena Vance",
      handle: "@elenavance",
      avatarUrl: "",
      online: false,
    },
    lastMessage: "Sent over the Figma tokens for the Marketplace drawer.",
    unreadCount: 0,
    messages: [
      {
        id: "m-3",
        senderId: "u-elena",
        text: "Sent over the Figma tokens for the Marketplace drawer.",
        timestamp: "Yesterday",
      },
    ],
  },
];
