"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MapPin, Clock, DollarSign } from "lucide-react";

interface JobCardProps {
  id: string;
  title: string;
  company: string;
  companyLogo?: string;
  location: string;
  type: string;
  salary?: string;
  posted: string;
  description: string;
  tags?: string[];
  /** The viewer has an application on this posting — the list read answers it
   * per row for a signed-in member, and a visitor's rows are all `false`. */
  applied?: boolean;
  /** Where that application stands — the list read carries it beside the flag
   * (the same answer the single-job read has always given). Null when the
   * viewer has not applied; the badge rides the flag, not on its own. */
  applicationStatus?: string | null;
}

export function JobCard({
  title,
  company,
  companyLogo,
  location,
  type,
  salary,
  posted,
  description,
  tags,
  applied = false,
  applicationStatus,
}: JobCardProps) {
  // The row's status is an enum key (`pending`, `reviewing`, …); the badge is a
  // word a reader can wear — capitalized, and rendered only beside the flag it
  // belongs to, because a status without an application is not a state this
  // card can be in.
  const appliedStatus =
    applied && applicationStatus
      ? applicationStatus.charAt(0).toUpperCase() + applicationStatus.slice(1)
      : null;
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12">
            {companyLogo ? (
              <img src={companyLogo} alt={company} />
            ) : (
              <AvatarFallback className="bg-brand-blue/10 text-brand-blue font-bold">
                {company[0]}
              </AvatarFallback>
            )}
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-sm">{title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">{company}</span>
                  <span className="text-xs text-muted-foreground">&middot;</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />{location}
                  </span>
                </div>
              </div>
              <Button size="sm">Apply</Button>
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />{posted}
              </span>
              <Badge variant="secondary" className="text-[10px]">{type}</Badge>
              {/* The viewer's own state, named in words: the flag the list read
                  answered rides the row, and a reader who has applied sees that
                  here rather than only inside the application flow. */}
              {applied && (
                <Badge variant="secondary" className="text-[10px]">Applied</Badge>
              )}
              {appliedStatus && (
                <Badge variant="secondary" className="text-[10px]">{appliedStatus}</Badge>
              )}
              {salary && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />{salary}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{description}</p>
            {tags && tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
