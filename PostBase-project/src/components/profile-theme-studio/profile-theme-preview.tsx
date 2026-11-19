import {
  orderedProfileThemeBlocks,
  profileThemeLayoutById,
  profileThemeStyleById,
  type ProfileThemeConfig,
  type ProfileThemeStyleColors,
} from "@/lib/profile-theme";
import { cn } from "@/lib/utils";

/**
 * What the preview draws identity with. The studio feeds it the signed-in
 * member's own details; the fields are optional because nothing here should be
 * able to make the layout collapse just because metadata is missing.
 */
export interface ProfileThemePreviewIdentity {
  name: string;
  username: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  website: string | null;
}

interface ProfileThemePreviewProps {
  config: ProfileThemeConfig;
  identity: ProfileThemePreviewIdentity;
  /**
   * The viewer's reduced-motion preference. It is the preview's *limiter*, not
   * the config's switch: the config may ask for motion, but a member reading
   * with `prefers-reduced-motion` resolved the question already, and the
   * preview answers it the same way the published theme will.
   */
  reducedMotion: boolean;
}

/**
 * The themed preview the studio draws from the shared model.
 *
 * This is a picture of the profile the saved theme would render, built in DOM
 * rather than on a `<canvas>`: a theme is layout and color, so the same markup
 * that previews it is close to the markup the profile itself could render, and
 * a screen reader can read the preview rather than meeting an opaque bitmap.
 *
 * Content inside blocks is *sample* content, not the member's real data except
 * a line of bio for the quote block. This is the studio, not the profile; what
 * the picker is choosing is arrangement and palette, and the sample text keeps
 * the picture honest about that.
 *
 * Three things this component deliberately does not let the theme touch — the
 * fixed zones that every layout and every style render identically:
 *
 * - **Identity** — the name, handle and photo, in the layout's identity slot.
 *   Decorations have no zone over them, so nothing a member uploads can sit
 *   where recognition happens.
 * - **Safety** — the same controls row, unthemed, at the bottom of the card.
 * - **Readability** — style colors come from the shared, contrast-checked
 *   list; the layout never draws body text over a member decoration.
 */
export function ProfileThemePreview({ config, identity, reducedMotion }: ProfileThemePreviewProps) {
  if (config.standard) {
    return <StandardPreview identity={identity} />;
  }

  const style = profileThemeStyleById(config.styleId);
  const layout = profileThemeLayoutById(config.layoutId);
  // An unknown id falls back to the first entry rather than to `undefined`,
  // because the config was validated on the way in and a missing style must
  // degrade to *a* theme rather than to a crash.
  const colors: ProfileThemeStyleColors =
    style?.colors ?? { bg: "#101014", surface: "#1d1d22", text: "#fafafa", muted: "#c8c8cf", accent: "#e11d48" };
  const identityPlacement = layout?.identityPlacement ?? "over-banner";

  const motifOn = Boolean(config.motion && style?.motionCapable && !reducedMotion);

  return (
    <div
      data-theme-view="themed"
      data-theme-layout={identityPlacement}
      data-theme-motion={motifOn ? "on" : "off"}
      // The positioning context the decoration zones hang from: they are
      // absolutely placed, so an ancestor that is not `relative` would pin them
      // to the page instead of to the card.
      className="relative overflow-hidden rounded-xl border border-surface-border"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      <Motif motif={style?.motif ?? null} accent={colors.accent} on={motifOn} />

      {/* Layouts rearrange the card around the identity zone; the zone itself
          is drawn once here, and the placements below only position it. */}
      {identityPlacement === "left" ? (
        <div className="flex gap-4 p-4">
          <div className="w-1/3 shrink-0">
            <IdentityBlock identity={identity} colors={colors} stacked />
          </div>
          <div className="min-w-0 flex-1">
            <IncludedBlocks config={config} identity={identity} colors={colors} />
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {identityPlacement === "lead" && <LeadBannerIdentity identity={identity} colors={colors} />}
          <IncludedBlocks config={config} identity={identity} colors={colors} />
          {identityPlacement === "stacked" && <StackedIdentity identity={identity} colors={colors} />}
          {identityPlacement === "over-banner" && <OverBannerIdentity identity={identity} colors={colors} />}
        </div>
      )}

      <Decorations decorations={config.decorations} />

      {/* Fixed, like identity: wherever the theme goes, the safety controls do
          not. Unthemed on purpose — controls a theme recolors are controls a
          reader has to rediscover. */}
      <div
        data-theme-fixed="safety"
        aria-label="Safety controls"
        className={cn("flex gap-3 border-t px-4 py-2 text-xs")}
        style={{ borderColor: colors.surface, color: colors.muted }}
      >
        <span>Visibility</span>
        <span>Report</span>
        <span>Block</span>
      </div>
    </div>
  );
}

/** The plain, unthemed profile — what the member had before the studio. */
function StandardPreview({ identity }: { identity: ProfileThemePreviewIdentity }) {
  return (
    <div
      data-theme-view="standard"
      className="overflow-hidden rounded-xl border border-surface-border bg-card"
    >
      <div className="h-16 w-full bg-brand-blue/10" data-standard-banner />
      <div className="space-y-2 p-4 text-center">
        <Avatar initials={initialsOf(identity.name)} url={identity.avatarUrl} sizeClass="h-14 w-14" />
        <p className="text-lg font-bold text-navy-800">{identity.name}</p>
        {identity.username && <p className="text-sm text-muted-foreground">@{identity.username}</p>}
        {identity.bio && <p className="text-sm text-navy-600">{identity.bio}</p>}
      </div>
      <div
        data-theme-fixed="safety"
        aria-label="Safety controls"
        className="flex gap-3 border-t border-surface-border px-4 py-2 text-xs text-muted-foreground"
      >
        <span>Visibility</span>
        <span>Report</span>
        <span>Block</span>
      </div>
    </div>
  );
}

function IdentityBlock({
  identity,
  colors,
  stacked,
}: {
  identity: ProfileThemePreviewIdentity;
  colors: ProfileThemeStyleColors;
  stacked?: boolean;
}) {
  return (
    <div
      data-theme-fixed="identity"
      className={cn("flex items-center gap-3", stacked && "flex-col text-center")}
    >
      <Avatar
        initials={initialsOf(identity.name)}
        url={identity.avatarUrl}
        sizeClass="h-14 w-14"
        ring={colors.accent}
      />
      <div className={cn("min-w-0", stacked && "w-full")}>
        <p className="truncate text-base font-bold" style={{ color: colors.text }}>
          {identity.name}
        </p>
        {identity.username && (
          <p className="truncate text-xs" style={{ color: colors.muted }}>
            @{identity.username}
          </p>
        )}
        {identity.location && (
          <p className="truncate text-xs" style={{ color: colors.muted }}>
            {identity.location}
          </p>
        )}
      </div>
    </div>
  );
}

/** The identity zone where the banner already belongs to the theme. */
function LeadBannerIdentity({
  identity,
  colors,
}: {
  identity: ProfileThemePreviewIdentity;
  colors: ProfileThemeStyleColors;
}) {
  return (
    <div data-theme-fixed="identity" className="rounded-lg p-4" style={{ backgroundColor: colors.surface }}>
      <IdentityBlock identity={identity} colors={colors} />
    </div>
  );
}

function StackedIdentity({
  identity,
  colors,
}: {
  identity: ProfileThemePreviewIdentity;
  colors: ProfileThemeStyleColors;
}) {
  return (
    <div data-theme-fixed="identity" className="flex flex-col items-center gap-2 rounded-lg p-4" style={{ backgroundColor: colors.surface }}>
      <Avatar initials={initialsOf(identity.name)} url={identity.avatarUrl} sizeClass="h-20 w-20" ring={colors.accent} />
      <p className="text-lg font-bold" style={{ color: colors.text }}>{identity.name}</p>
      {identity.username && (
        <p className="text-xs" style={{ color: colors.muted }}>@{identity.username}</p>
      )}
    </div>
  );
}

function OverBannerIdentity({
  identity,
  colors,
}: {
  identity: ProfileThemePreviewIdentity;
  colors: ProfileThemeStyleColors;
}) {
  return (
    <div
      data-theme-fixed="identity"
      className="-mt-10 flex items-end gap-3 px-2"
      style={{ color: colors.text }}
    >
      <Avatar initials={initialsOf(identity.name)} url={identity.avatarUrl} sizeClass="h-16 w-16" ring={colors.accent} />
      <div className="min-w-0 pb-1">
        <p className="truncate text-base font-bold">{identity.name}</p>
        {identity.username && (
          <p className="truncate text-xs" style={{ color: colors.muted }}>@{identity.username}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The included blocks, in position order. Excluded blocks render nothing at all
 * — not a collapsed placeholder — because a theme that ships an empty tile for
 * a block the member turned off is a theme that argues with its editor.
 */
function IncludedBlocks({
  config,
  identity,
  colors,
}: {
  config: ProfileThemeConfig;
  identity: ProfileThemePreviewIdentity;
  colors: ProfileThemeStyleColors;
}) {
  const included = orderedProfileThemeBlocks(config).filter((placement) => placement.included);
  if (included.length === 0) {
    return <p className="text-xs" style={{ color: colors.muted }}>No blocks selected yet.</p>;
  }
  return (
    <div className="space-y-3">
      {included.map((placement) => (
        <SampleBlock
          key={placement.id}
          id={placement.id}
          identity={identity}
          colors={colors}
        />
      ))}
    </div>
  );
}

function SampleBlock({
  id,
  identity,
  colors,
}: {
  id: string;
  identity: ProfileThemePreviewIdentity;
  colors: ProfileThemeStyleColors;
}) {
  const surfaceStyle = { backgroundColor: colors.surface, color: colors.text };
  switch (id) {
    case "highlights":
      return (
        <div className="space-y-1 rounded-lg p-3" style={surfaceStyle}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>
            Highlights
          </p>
          <div className="grid grid-cols-3 gap-2">
            {["Pinned", "Top post", "Featured"].map((label) => (
              <div
                key={label}
                className="rounded p-2 text-center text-xs"
                style={{ backgroundColor: colors.bg, color: colors.muted }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      );
    case "interests":
      return (
        <div className="flex flex-wrap gap-2 rounded-lg p-3" style={surfaceStyle}>
          {["Photography", "Travel", "Music", "Code"].map((chip) => (
            <span
              key={chip}
              className="rounded-full px-2.5 py-1 text-xs"
              style={{ backgroundColor: colors.bg, color: colors.accent }}
            >
              {chip}
            </span>
          ))}
        </div>
      );
    case "media-strip":
      return (
        <div className="flex gap-2 overflow-hidden rounded-lg p-3" style={surfaceStyle}>
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="aspect-square w-16 shrink-0 rounded"
              style={{ backgroundColor: colors.bg }}
              aria-hidden
            />
          ))}
        </div>
      );
    case "quote":
      return (
        <blockquote
          className="rounded-lg p-3 text-sm italic"
          style={{ ...surfaceStyle, color: colors.text }}
        >
          {identity.bio ?? "“One line about what you do.”"}
        </blockquote>
      );
    case "links":
      return (
        <div className="rounded-lg p-3" style={surfaceStyle}>
          <p className="text-xs underline" style={{ color: colors.accent }}>
            {identity.website ?? "your website"}
          </p>
        </div>
      );
    default:
      return null;
  }
}

/** Decorations, pinned to the fixed zones. They never move into the text. */
function Decorations({ decorations }: { decorations: ProfileThemeConfig["decorations"] }) {
  const zoneClass: Record<string, string> = {
    "corner-top-left": "left-2 top-2",
    "corner-top-right": "right-2 top-2",
    "corner-bottom-left": "bottom-8 left-2",
    "corner-bottom-right": "right-2 top-1/2",
    "header-edge": "left-1/3 top-1",
  };
  return (
    <>
      {decorations.map((decoration) => (
        <img
          key={decoration.id}
          // Staged decorations carry their picked data URL by the time they
          // reach the preview; the `?? ""` is the widened request type's null
          // case, which nothing here produces but the type must admit.
          src={decoration.url ?? ""}
          alt=""
          aria-hidden
          data-decoration-zone={decoration.zone}
          className={cn("h-10 w-10 pointer-events-none absolute object-contain", zoneClass[decoration.zone] ?? "left-2 top-2")}
        />
      ))}
    </>
  );
}

/**
 * The style's motif, as decoration the theme itself ships. `aria-hidden` and
 * `pointer-events-none`: it is texture, and texture that a reader could tab
 * into would be texture lying about being content.
 */
function Motif({ motif, accent, on }: { motif: string | null; accent: string; on: boolean }) {
  if (!motif) return null;
  return (
    <div
      aria-hidden
      data-theme-motif={motif}
      className={cn("relative h-14 w-full overflow-hidden", on && "animate-pulse")}
      style={{ backgroundColor: accent }}
    >
      <div className="absolute inset-0 opacity-20" style={{ background: `repeating-linear-gradient(45deg, #000 0 6px, transparent 6px 12px)` }} />
    </div>
  );
}

function Avatar({
  initials,
  url,
  sizeClass,
  ring,
}: {
  initials: string;
  url: string | null;
  sizeClass: string;
  ring?: string;
}) {
  if (url) {
    return (
      // The preview's avatar is a mock, but a broken `alt` here would be read
      // out with the name repeated beside it; an empty alt keeps it decorative,
      // because the name is already the accessible content of the identity zone.
      <img src={url} alt="" className={cn("rounded-full object-cover", sizeClass)} style={ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined} />
    );
  }
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full bg-brand-blue/20 text-sm font-bold",
        sizeClass,
      )}
      style={ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined}
    >
      {initials}
    </span>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
