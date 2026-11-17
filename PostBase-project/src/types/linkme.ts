export type NavRoute =
  | "landing"
  | "login"
  | "home"
  | "shorts"
  | "marketplace"
  | "jobs"
  | "groups"
  | "messages"
  | "profile";

export interface UserProfile {
  id: string;
  name: string;
  handle: string;
  role: string;
  bio: string;
  avatarUrl: string;
  coverVideoUrl: string;
  coverStudioTheme: "obsidian-nebula" | "indigo-pulse" | "terracotta-glow";
  verified: boolean;
  stats: {
    connections: number;
    followers: number;
    posts: number;
  };
  skills: string[];
  experience: {
    id: string;
    title: string;
    company: string;
    period: string;
    location: string;
  }[];
}

export interface StoryItem {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  mediaUrl: string;
  isLive?: boolean;
  timestamp: string;
}

export interface SocialPost {
  id: string;
  author: Pick<
    UserProfile,
    "id" | "name" | "handle" | "avatarUrl" | "role" | "verified"
  >;
  communityTag?: string;
  timestamp: string;
  content: string;
  mediaUrl?: string;
  mediaType?: "image" | "video";
  likes: number;
  commentsCount: number;
  shares: number;
  isLiked?: boolean;
  isBookmarked?: boolean;
}

export interface ShortVideo {
  id: string;
  author: Pick<
    UserProfile,
    "id" | "name" | "handle" | "avatarUrl" | "verified"
  >;
  videoUrl: string;
  posterUrl: string;
  caption: string;
  studioStyle: string; // e.g. "Marquee Wall · Style 01/30"
  audioTrack: string;
  likes: number;
  commentsCount: number;
  shares: number;
}

export interface MarketplaceItem {
  id: string;
  title: string;
  price: number;
  currency: string;
  category: "Tech & Gear" | "Design Assets" | "Workspace" | "Apparel";
  condition: "New" | "Like New" | "Digital Download" | "Good";
  location: string;
  imageUrl: string;
  description: string;
  seller: Pick<
    UserProfile,
    "id" | "name" | "handle" | "avatarUrl" | "verified"
  > & {
    rating: number;
  };
}

export interface JobOpportunity {
  id: string;
  title: string;
  company: string;
  companyLogo: string;
  location: string;
  workModel: "Remote" | "Hybrid" | "On-site";
  salaryRange: string;
  postedAt: string;
  tags: string[];
  description: string;
  requirements: string[];
}

export interface CommunityGroup {
  id: string;
  name: string;
  category: string;
  membersCount: string;
  activeNow: number;
  bannerUrl: string;
  description: string;
  isJoined?: boolean;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
}

export interface ChatThread {
  id: string;
  participant: Pick<UserProfile, "id" | "name" | "handle" | "avatarUrl"> & {
    online: boolean;
  };
  lastMessage: string;
  unreadCount: number;
  messages: DirectMessage[];
}
