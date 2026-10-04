"use client";

import { Earth, Lock, Users, UserRoundCheck } from "lucide-react";
import type { PostAudience } from "@/lib/post-audiences";

/**
 * The one audience→icon map. The picker and the post card's pill both draw from
 * it, so an audience cannot end up with one symbol in the menu and another on
 * the post.
 *
 * Keyed by {@link PostAudience}, so a new audience is a compile error here until
 * somebody picks a symbol for it.
 */
const audienceIcons: Record<PostAudience, typeof Earth> = {
  public: Earth,
  followers: Users,
  private: Lock,
  // A different symbol from `followers`, which is the point: a post in a group
  // and a post for your followers are told apart at a glance on the card.
  group: UserRoundCheck,
};

export function AudienceIcon({
  audience,
  className,
}: {
  audience: PostAudience;
  className?: string;
}) {
  const Icon = audienceIcons[audience];
  return <Icon className={className} />;
}
