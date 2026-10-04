"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AudienceIcon } from "@/components/social/audience-icon";
import { Check, ChevronDown } from "lucide-react";
import {
  audienceLabel,
  composerAudiences,
  isPostAudience,
  type PostAudience,
} from "@/lib/post-audiences";
import { cn } from "@/lib/utils";

/**
 * The long-form copy, which only this menu shows — the pill on a post would not
 * fit it. Keyed by {@link PostAudience}, so a new audience needs words here too.
 *
 * This is the copy for a member posting as themselves, which is the default and
 * the case in the feed, on a profile and in the edit dialog. Only the audience
 * whose meaning depends on *who is speaking* gets different words — see
 * {@link audienceOptionsFor}.
 */
const audienceDescription: Record<PostAudience, string> = {
  public: "Anyone on and off LinkMe+",
  followers: "People who follow you",
  private: "Visible just to you",
  // Never shown by this menu — a group post is composed inside its group, which
  // sets the audience itself. The words are here because the map is keyed by the
  // audience, and the next surface that offers one should not have to invent
  // them.
  group: "People in this group",
};

interface AudienceOption {
  value: PostAudience;
  label: string;
  description: string;
}

/**
 * The options, built from the shared list in its order — `composerAudiences`,
 * which is every audience a composer may honour rather than every audience that
 * exists. A group's post carries `group`, and it is the group's own composer
 * that sets it, so offering it here would be a choice with nothing behind it.
 * The audience names come from `@/lib/post-audiences` rather than being spelled
 * out again, so the menu cannot offer an audience the server rule does not
 * enforce.
 *
 * `subject` is who is speaking: `null` for the member themselves, a Page's name
 * when the post is being published as one. Only `followers` reads differently,
 * and it has to: the people who can read a Page's followers-only post are the
 * *Page's* followers, so "People who follow you" would be wrong exactly where it
 * matters — and the audience rule agrees, since it gates that post on the edge
 * to the Page. `public` and `private` mean the same thing whoever writes, and
 * say so: "Visible just to you" is still true of an admin's `private` post on a
 * Page, which only they can read.
 */
export function audienceOptionsFor(subject: string | null = null): AudienceOption[] {
  return composerAudiences.map((value) => ({
    value,
    label: audienceLabel[value],
    description:
      value === "followers" && subject
        ? `People who follow ${subject}`
        : audienceDescription[value],
  }));
}

/**
 * The audience picker.
 *
 * One control shared by the composer, the Page composer and the edit dialog:
 * who can see a post is the same decision in all three, and three copies would
 * eventually offer different audiences.
 */
export function PostAudienceSelect({
  value,
  onChange,
  onOpenChange,
  compact = false,
  className,
  asPage,
}: {
  value: PostAudience;
  onChange: (value: PostAudience) => void;
  /**
   * Reports the menu opening and closing. The composer needs it: the menu is
   * portalled outside the composer, so while it is open the focus that moved
   * onto an option is not the composer being left.
   */
  onOpenChange?: (open: boolean) => void;
  /** Drops the label on narrow screens; the composer's toolbar has no room. */
  compact?: boolean;
  className?: string;
  /**
   * The Page the post is being published as, when it is being published as one.
   * Omitted for a member posting as themselves.
   */
  asPage?: string | null;
}) {
  const options = audienceOptionsFor(asPage ?? null);
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {/* The name is the control's visible label *plus* which audience is on.
            A bare "Choose post audience" hid both: voice control has to be able
            to say the words on the button (WCAG 2.5.3), and "which audience is
            this post set to?" is the one thing the control is for. */}
        <Button
          variant="outline"
          size="sm"
          aria-label={`Post audience: ${current.label}`}
          className={className}
        >
          <AudienceIcon audience={current.value} className="h-4 w-4 mr-1.5 text-brand-blue" />
          <span className={cn(compact && "hidden sm:inline")}>{current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 ml-1 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* A radio group rather than a list of items: one of these is always
            the current audience, and the tick beside it only says so to someone
            who can see the menu. */}
        <DropdownMenuRadioGroup
          value={value}
          // Radix renders this as `role="group"`, and a group takes its name
          // only from the author — the items inside say which one is chosen,
          // not what is being chosen between.
          aria-label="Post audience"
          // Radix reports `undefined` when the item that is already chosen is
          // chosen again — a menu may allow no selection, a post's audience may
          // not, and "no audience" here would fall back to the first one in the
          // list while looking like nothing had happened. The shared validator
          // is the guard rather than a local `!== undefined`, so an audience
          // that stops existing cannot arrive through this door either.
          onValueChange={(next) => {
            if (isPostAudience(next)) onChange(next);
          }}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="gap-3 py-2.5"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-light-blue">
                  <AudienceIcon audience={option.value} className="h-4 w-4 text-brand-blue" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-navy-800">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
                {selected && (
                  <Check className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
                )}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
