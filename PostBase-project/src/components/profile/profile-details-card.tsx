import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MapPin,
  Briefcase,
  GraduationCap,
  LinkIcon,
  UserPlus,
  Calendar,
} from "lucide-react";

export interface ProfileDetailsData {
  bio?: string | null;
  location?: string | null;
  work?: string | null;
  education?: string | null;
  website?: string | null;
  joinedAt?: string | Date | null;
  followersCount: number;
  followingCount: number;
  mutualFriends?: Array<{ id: string; name: string; avatarUrl?: string | null }>;
  mutualFriendsCount?: number;
  skills?: string[] | null;
}

interface ProfileDetailsCardProps {
  details: ProfileDetailsData;
}

export function ProfileDetailsCard({ details }: ProfileDetailsCardProps) {
  const {
    bio,
    location,
    work,
    education,
    website,
    joinedAt,
    followersCount,
    followingCount,
    mutualFriends = [],
    mutualFriendsCount = mutualFriends.length,
    skills,
  } = details;

  const joinedLabel = joinedAt
    ? new Date(joinedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : null;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="text-lg font-bold text-navy-800">Intro</h2>
          {bio ? (
            <p className="mt-1 text-sm leading-relaxed text-navy-600">{bio}</p>
          ) : (
            <p className="mt-1 text-sm italic text-muted-foreground">No bio yet.</p>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-navy-600">
          <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            <strong className="font-semibold text-navy-800">
              {followersCount.toLocaleString()}
            </strong>{" "}
            followers ·{" "}
            <strong className="font-semibold text-navy-800">
              {followingCount.toLocaleString()}
            </strong>{" "}
            following
          </span>
        </div>

        <ul className="space-y-2 text-sm text-navy-600">
          {work && (
            <li className="flex items-start gap-2">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{work}</span>
            </li>
          )}
          {education && (
            <li className="flex items-start gap-2">
              <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{education}</span>
            </li>
          )}
          {location && (
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{location}</span>
            </li>
          )}
          {website && (
            <li className="flex items-start gap-2">
              <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <a
                href={website}
                target="_blank"
                rel="noreferrer noopener"
                className="break-all text-brand-blue hover:underline"
              >
                {website.replace(/^https?:\/\//, "")}
              </a>
            </li>
          )}
          {joinedLabel && (
            <li className="flex items-start gap-2">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>Joined {joinedLabel}</span>
            </li>
          )}
        </ul>

        {skills && skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skills.slice(0, 6).map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-surface-border bg-surface-light-blue px-2.5 py-0.5 text-xs text-navy-600"
              >
                {skill}
              </span>
            ))}
          </div>
        )}
      </CardContent>

      {mutualFriends.length > 0 && (
        <>
          <CardHeader className="border-t border-surface-border px-4 pb-2 pt-4">
            <CardTitle className="text-sm font-semibold text-navy-800">
              Friends
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="mb-2 flex items-center">
              <div className="flex -space-x-2">
                {mutualFriends.slice(0, 5).map((friend) => (
                  <Avatar
                    key={friend.id}
                    className="h-7 w-7 border-2 border-white ring-1 ring-surface-border"
                  >
                    <AvatarFallback className="text-[10px]">
                      {friend.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              <span className="ml-2 text-xs text-muted-foreground">
                {mutualFriendsCount > mutualFriends.length
                  ? `${mutualFriendsCount.toLocaleString()} friends`
                  : `${mutualFriendsCount} friend${mutualFriendsCount === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {mutualFriends.slice(0, 9).map((friend) => (
                <div
                  key={friend.id}
                  className="overflow-hidden rounded-md border border-surface-border"
                >
                  <div className="flex aspect-square items-center justify-center bg-surface-light-blue">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="text-sm">
                        {friend.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <p className="truncate px-1.5 py-1 text-[11px] font-medium text-navy-700">
                    {friend.name}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}
