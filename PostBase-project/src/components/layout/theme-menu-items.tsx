"use client";

import { Check } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { THEME_ICONS } from "@/lib/theme-icons";
import { THEMES, type ThemeChoice } from "@/lib/theme";

/**
 * The theme, switchable from the nav's account menu.
 *
 * Three `menuitemradio`s rather than three buttons: a menu is not a place a
 * bare `role="group"` of buttons may sit, and Radix's radio items give each
 * option `role="menuitemradio"` with `aria-checked`, so the chosen theme is
 * *said* rather than only ticked — the same pairing the settings card gets from
 * its own radio group. `aria-label` on the group is what keeps the audit's
 * "a group of options must have a name" rule satisfied, since Radix renders the
 * group as a bare `role="group"` with no name of its own — the items' own
 * `aria-checked` is what satisfies the other half.
 *
 * Its own component, and that is load-bearing rather than tidiness: it calls
 * `useTheme`, which throws without a `ThemeProvider`, and it is rendered inside
 * the menu's *content* — which Radix mounts only while the menu is open. So the
 * hook is never called in a render of `MainNav` that has no menu on screen.
 * `main-nav.test.tsx` renders the nav to static markup with no provider at all,
 * and it stays green because of that; calling `useTheme` in `MainNav` itself
 * would have broken it (and would have re-rendered the whole nav on every theme
 * change for nothing).
 *
 * Radix closes the menu when an item is selected, which is the conventional
 * thing for a menu to do and gives immediate feedback: the page behind changes
 * as the menu goes. The alternative — keeping it open so the three can be
 * compared — costs a second dismissal at the end, which is the click this
 * exists to save.
 */
export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenuRadioGroup
      aria-label="Theme"
      value={theme}
      onValueChange={(value) => setTheme(value as ThemeChoice)}
    >
      {THEMES.map((option) => {
        const Icon = THEME_ICONS[option.id];
        return (
          <DropdownMenuRadioItem key={option.id} value={option.id}>
            <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
            {option.label}
            {/* Drawn as well as announced. `aria-checked` is what says the
                choice (Radix sets it from `value`), and this is the same fact
                for anyone looking at the screen rather than listening — the
                pairing the settings card makes with its own tick, and the one
                a menu item with neither would be missing. Derived from the
                same `theme` that drives `value`, so they cannot disagree. */}
            {theme === option.id && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}
