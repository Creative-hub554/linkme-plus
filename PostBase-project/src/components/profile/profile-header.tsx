"use client";

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
  ProfileCover,
  type CoverMedia,
} from "@/components/profile/profile-cover";
import { MessageCircle, Plus, Pencil, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { FollowButton } from "@/components/social/follow-button";

export interface ProfileHeaderUser {
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  location?: string | null;
  joinedAt?: string | Date | null;
}

interface ProfileHeaderProps {
  user: ProfileHeaderUser;
  cover: CoverMedia;
  isOwner: boolean;
  followersCount?: number;
  followingCount?: number;
  activeTab: ProfileTabId;
  onTabChange: (tab: ProfileTabId) => void;
  onEditCover?: () => void;
  onEditProfile?: () => void;
  onAddStory?: () => void;
  /** Member this profile belongs to, for the follow action. Owner views omit it. */
  profileUserId?: string | null;
  initialFollowing?: boolean;
  onFollowChange?: (following: boolean, followers?: number) => void;
  onMessage?: () => void;
}

const tabs = [
  { id: "posts", label: "Posts" },
  { id: "about", label: "About" },
  { id: "friends", label: "Friends" },
  { id: "photos", label: "Photos" },
  { id: "videos", label: "Videos" },
  // The cover studio. It used to be a page with a place in the main navigation,
  // which made a member's own cover look like a module of the app; it is the last
  // step of setting up a profile, so it is a section of one. Ahead of "More",
  // which stays the catch-all at the end of the row.
  { id: "cover", label: "Cover studio" },
  { id: "more", label: "More" },
] as const;

export type ProfileTabId = (typeof tabs)[number]["id"];

export function ProfileHeader({
  user,
  cover,
  isOwner,
  followersCount,
  followingCount,
  activeTab,
  onTabChange,
  onEditCover,
  onEditProfile,
  onAddStory,
  profileUserId,
  initialFollowing,
  onFollowChange,
  onMessage,
}: ProfileHeaderProps) {
  const [showQr, setShowQr] = useState(false);
  const handle = user.username ? `@${user.username}` : null;
  const profileUrl = useMemo(() => {
    if (typeof window === "undefined") return `/profile?username=${encodeURIComponent(user.username ?? "user")}`;
    return `${window.location.origin}/profile?username=${encodeURIComponent(user.username ?? "user")}`;
  }, [user.username]);

  return (
    <div className="overflow-hidden rounded-xl border border-surface-border bg-card shadow-sm">
      <ProfileCover
        media={cover}
        alt={user.name ?? "Profile"}
        username={user.username}
        bio={user.bio}
        avatarUrl={user.avatarUrl}
        isOwner={isOwner}
        onEdit={onEditCover}
      />

      <div className="px-4 pb-0 sm:px-6">
        {/* The real profile picture is rendered inside the cover video. Keep identity content directly beneath it. */}
        <div className="pt-4 text-center sm:pt-5">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <h1 className="text-xl font-bold text-navy-800 sm:text-2xl">{user.name}</h1>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {handle && <span>{handle}</span>}
            {typeof followersCount === "number" && (
              <span>
                <strong className="font-semibold text-navy-800">
                  {followersCount.toLocaleString()}
                </strong>{" "}
                {followersCount === 1 ? "follower" : "followers"}
              </span>
            )}
            {typeof followingCount === "number" && (
              <span>
                <strong className="font-semibold text-navy-800">
                  {followingCount.toLocaleString()}
                </strong>{" "}
                following
              </span>
            )}
            {user.location && (
              <span className="inline-flex items-center gap-1">
                {user.location}
              </span>
            )}
            {user.joinedAt && (
              <span>
                Joined {typeof user.joinedAt === "string" ? user.joinedAt : user.joinedAt.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </span>
            )}
          </div>
          {user.bio && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-navy-600">
              {user.bio}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {isOwner ? (
            <>
              <Button size="sm" onClick={onEditProfile}>
                <Pencil className="h-4 w-4" />
                Edit Profile
              </Button>
              <Button variant="outline" size="sm" onClick={onAddStory}>
                <Plus className="h-4 w-4" />
                Add Story
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowQr(true)}>
                <QrCode className="h-4 w-4" />
                View QR code
              </Button>
            </>
          ) : (
            <>
              {profileUserId && (
                <FollowButton
                  userId={profileUserId}
                  initialFollowing={initialFollowing}
                  onChange={onFollowChange}
                />
              )}
              <Button variant="outline" size="sm" onClick={onMessage} disabled={!profileUserId}>
                <MessageCircle className="h-4 w-4" />
                Message
              </Button>
            </>
          )}
        </div>

        {/* Tab bar */}
        <nav
          aria-label="Profile sections"
          className="mt-3 flex justify-center gap-1 overflow-x-auto border-b border-surface-border scrollbar-hide"
        >
          {/* The studio is offered on your own profile only: it writes *your*
              cover, so on somebody else's it would be a door into the wrong
              room. Every other section describes the member whose profile this
              is, and so is shown to everyone. */}
          {tabs
            .filter((tab) => tab.id !== "cover" || isOwner)
            .map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  // A nav item, not a tablist tab: `aria-current` is the state
                  // ARIA allows on a plain button, and `aria-selected` is not.
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "relative min-h-11 whitespace-nowrap rounded-t-md px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4",
                    isActive
                      ? "text-brand-blue"
                      : "text-muted-foreground hover:bg-surface-light-blue hover:text-navy-800"
                  )}
                >
                  {tab.label}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-brand-blue"
                    />
                  )}
                </button>
              );
            })}
        </nav>
      </div>
      {showQr && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${user.name ?? "Profile"}'s QR code`}
          onClick={() => setShowQr(false)}
        >
          <div className="rounded-3xl bg-card p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowQr(false)}>Close</Button>
            </div>
            <QRCodeSVG value={profileUrl} size={280} bgColor="#ffffff" fgColor="#071426" level="H" includeMargin title={`QR code for ${user.name ?? "Profile"}`} />
            <p className="mt-3 text-center text-sm font-medium text-navy-800">Scan to connect with {user.name}</p>
          </div>
        </div>
      )}
    </div>
  );
}
