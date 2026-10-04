"use client";

import { Check, Palette } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth-provider";
import { useTheme } from "@/components/providers/theme-provider";
import { saveAccountAccent } from "@/lib/theme-preferences";
import { ThemeChoiceGroup } from "@/components/shared/theme-choice-group";
import { ACCENTS, type Accent } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The theme and accent pickers.
 *
 * Two radio groups, spelled as buttons. Each is a single choice among a few, so
 * `radiogroup`/`radio`/`aria-checked` is the shape that says as much — a row of
 * pressed buttons would announce "pressed" and leave the "only one of these"
 * part for the reader to infer. The colour of the chosen chip is the visual
 * duplicate of that same fact, never the only place it is said.
 *
 * The theme's own group is `ThemeChoiceGroup`, not markup written here, because
 * the nav's mobile panel offers the same choice and the two are a phone's tap
 * apart — one component is what keeps them from answering differently. The
 * sentence underneath it is this card's alone, so it stays.
 *
 * Nothing here stores anything: the choice goes to `ThemeProvider`, which owns
 * both the storage and the class on `<html>`.
 */
export function AppearanceSettings() {
  const { theme, accent, resolvedTheme, setAccent } = useTheme();
  const { user } = useAuth();

  /**
   * The accent, applied first and mirrored second.
   *
   * Local first because that is the part the reader sees: the class on `<html>`
   * changes in this commit, and the request to the account is a copy that
   * travels. It is not awaited and its answer is not shown — an accent that
   * could not be saved to the account is still saved to this browser, and the
   * next change tries again. Signed out, there is nowhere to send it, which is
   * why the copy below changes with the session rather than pretending.
   */
  const chooseAccent = (next: Accent) => {
    setAccent(next);
    if (user) void saveAccountAccent(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-brand-blue" /> Appearance
        </CardTitle>
        <CardDescription>
          {user
            ? "Choose how LinkMe+ looks. The accent is saved to your account and follows you to any device you sign in on."
            : "Choose how LinkMe+ looks. Saved to this browser — sign in to keep your accent across devices."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <ThemeChoiceGroup />
          <p className="text-xs text-muted-foreground">
            {theme === "system"
              ? `Following your device, which is currently ${resolvedTheme}.`
              : `Always ${theme} on this device.`}
          </p>
        </div>

        <div className="space-y-2">
          <p id="accent-label" className="text-sm font-medium text-navy-800">
            Accent colour
          </p>
          <div
            role="radiogroup"
            aria-labelledby="accent-label"
            className="flex flex-wrap gap-2"
          >
            {ACCENTS.map((option) => {
              const selected = accent === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  onClick={() => chooseAccent(option.id)}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue",
                    selected
                      ? "border-brand-blue text-navy-800"
                      : "border-surface-border text-navy-700 hover:bg-navy-50 hover:text-navy-800",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: option.swatch }}
                  >
                    {selected && <Check className="h-4 w-4" />}
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
