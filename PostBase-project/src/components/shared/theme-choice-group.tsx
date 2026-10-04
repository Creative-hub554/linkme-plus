"use client";

import { useId } from "react";
import { useTheme } from "@/components/providers/theme-provider";
import { THEME_ICONS } from "@/lib/theme-icons";
import { THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The theme, as one choice among three, spelled as buttons.
 *
 * A `radiogroup` of `radio`s rather than a row of pressed buttons: this is a
 * single choice among a few, and `aria-checked` is the attribute that says which
 * one — "pressed" would announce a toggle and leave the "only one of these" part
 * for the reader to infer. The filled chip is the visual duplicate of that same
 * fact, never the only place it is said.
 *
 * It exists as its own component because it has two homes — the settings card
 * and the nav's mobile panel — and they are on screen *together* on a phone, so
 * a copied pair would be two things to keep in step rather than one. The labels
 * and the glyphs come from `THEMES` and `THEME_ICONS` for the same reason.
 *
 * The nav's account menu offers the same three choices and is deliberately not
 * this component: a menu has its own roles for a set of options
 * (`menuitemradio`), and those items must be `DropdownMenuRadioItem`s to sit in
 * a menu at all. See `theme-menu-items.tsx`.
 *
 * Nothing here stores anything: the choice goes to `ThemeProvider`, which owns
 * both the storage and the class on `<html>`.
 */
export function ThemeChoiceGroup() {
  const { theme, setTheme } = useTheme();

  // Generated rather than written, because this component can be in the
  // document twice at once: two groups sharing a written `id` would leave one of
  // them named by the *other* one's heading.
  const labelId = useId();

  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium text-navy-800">
        Theme
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-3 gap-2">
        {THEMES.map((option) => {
          const Icon = THEME_ICONS[option.id];
          const selected = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(option.id)}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue",
                selected
                  ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
                  : "border-surface-border text-navy-700 hover:bg-navy-50 hover:text-navy-800",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
