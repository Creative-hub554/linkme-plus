/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { parse, unlayeredColourOffenders } from "@/test/convention-guards";
import { ACCENTS, ACCENT_STORAGE_KEY, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../lib/theme";

// `?raw` is Vite's own escape hatch for exactly this: the *source* bytes of a
// file, untouched by PostCSS. A normal CSS import would hand back the compiled
// stylesheet, which is not what this test is about. (`vite/client` declares the
// module type; the project has no `@types/node`, so reading it with `fs` is not
// an option here.)
import css from "../app/globals.css?raw";

/**
 * A stylesheet contract test for `globals.css`.
 *
 * Two things in that file have now gone wrong in exactly the same way, and each
 * cost a full debugging session:
 *
 *   1. `* { border-color: … }` — the default that exists only to give borders a
 *      colour — sat *outside* any `@layer`, so it overrode every `border-<colour>`
 *      class in the application.
 *   2. The twenty hand-written token rules (`text-muted-foreground`, `bg-accent`,
 *      `border-input`, `ring-ring`, …) sat outside a layer too, so `.border-input`
 *      at specificity (0,1,0) outranked a layered `.focus:border-brand-blue` at
 *      (0,2,0) for no reason except the layer.
 *
 * Both because CSS gives an unlayered rule precedence over every layer, and
 * Tailwind v4 registers its utilities in `@layer utilities`.
 *
 * The second is now fixed at the root instead of by layering: the tokens are
 * declared in `@theme inline` as `--color-*`, so Tailwind generates the whole
 * utility family (`bg-accent`, `hover:bg-accent`, `bg-destructive/90`,
 * `placeholder:text-muted-foreground`, …) and no token class is written by hand
 * at all. That is why the positive half of the invariant below now asserts the
 * `@theme` declarations and the *absence* of hand-written token classes, rather
 * than that twenty of them are inside a layer.
 *
 * No rendered test can see this: jsdom computes no CSS, and a screenshot only
 * shows whatever the cascade happened to produce. What a test *can* see is the
 * source. A class rule that sets a colour and is not inside a layer is a rule
 * that will silently outrank Tailwind rather than compete with it on specificity
 * — which is the whole of the bug, stated as an invariant.
 *
 * The property list is deliberately limited to the four colour families the
 * tokens own. Two custom classes in this file also sit outside a layer on
 * purpose (`.shimmer-on-hover::after` sets the `background` shorthand,
 * `.feed-highlight` sets `outline`); neither shadows a Tailwind utility name, so
 * neither is this bug. The global `:focus-visible { outline: … }` rule is the one
 * remaining unlayered colour-ish rule, it has no class in its selector, and it is
 * knowingly left as-is — see the runbook for what that costs
 * (`focus-visible:outline-none` cannot win).
 *
 * What this test cannot check is the *generated* stylesheet — that Tailwind
 * actually emitted `hover:bg-accent` from the `@theme` declaration. The suite
 * never imports the compiled CSS, so that half is verified by reading the build
 * output and by measuring the live page; see the runbook.
 */

/**
 * Tailwind's own palette families. Their `--color-*` variables are emitted by
 * the framework, not declared in `@theme` here, so the `palette names must be
 * @theme-declared` check below has to let them through: `.dark` overrides
 * `red-50` and friends on purpose, so a red-tinted alert is a dark red box
 * rather than a light one with dark text.
 */
const TAILWIND_PALETTE_NAME =
  /^--color-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/;

/**
 * The semantic tokens, declared in `@theme inline` as `--color-*`. Tailwind
 * generates every spelling of these names, so none of them needs a rule here.
 */
const DESIGN_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
];

/** The token classes Tailwind now owns — none of them may be written by hand. */
const GENERATED_TOKEN_CLASSES = [
  "text-foreground",
  "text-muted-foreground",
  "text-primary",
  "bg-background",
  "bg-card",
  "bg-muted",
  "bg-accent",
  "bg-primary",
  "border-border",
  "border-input",
  "ring-ring",
  "focus-visible:ring-ring",
  "text-accent-foreground",
  "bg-secondary",
  "text-secondary-foreground",
  "text-destructive",
  "bg-destructive",
  "text-destructive-foreground",
  "bg-popover",
  "text-popover-foreground",
];

/** The leading class of a selector, with CSS escapes decoded (`.focus-visible\:x` → `focus-visible:x`). */
function leadingClass(part: string): string | null {
  const match = /^\.((?:\\.|[\w-])+)/.exec(part.trim());
  return match ? match[1].replace(/\\(.)/g, "$1") : null;
}

/** Name → value for every declaration in every `@theme` block. */
function themeVars(source: string): Map<string, string> {
  const vars = new Map<string, string>();
  const blocks = /@theme[^{]*\{([^}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(source))) {
    for (const declaration of block[1].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      vars.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
  return vars;
}

const rules = parse(css);
const unlayered = rules.filter((rule) => rule.layer === null);

describe("globals.css layering", () => {
  it("parses the stylesheet rather than finding nothing", () => {
    // Without this the invariant below could pass by parsing zero rules. The
    // real number is 53 now that the twenty token rules are gone; the margin is
    // only here so that adding a few rules does not need this line edited.
    expect(rules.length).toBeGreaterThan(40);
    expect(unlayered.length).toBeGreaterThan(10);
    expect(rules.some((rule) => rule.layer === "base")).toBe(true);
    // And the `@theme` blocks parsed, so the token assertion below cannot pass
    // by finding no theme at all.
    expect(themeVars(css).size).toBeGreaterThan(30);
  });

  it("sets a text, background, border or ring colour only from inside a layer", () => {
    // The detector is shared with the meta-test in `convention-guards.test.ts`,
    // so the rule this asserts and the shape it fires on cannot drift apart.
    const offenders = unlayeredColourOffenders(css);

    expect(
      offenders,
      "An unlayered rule beats every @layer regardless of specificity, so these would " +
        "outrank Tailwind's utilities instead of competing with them. Move the rule into " +
        "`@layer utilities` (or `@layer base` for an element default)."
    ).toEqual([]);
  });

  it("declares every semantic token in @theme so Tailwind generates its utilities", () => {
    // The positive half of the invariant: the rule above passes vacuously if the
    // token classes are deleted. Each token must be declared as
    // `--color-<name>: hsl(var(--<name>))` in a `@theme` block, or Tailwind
    // generates nothing for that name and the app's `bg-accent`, `bg-secondary/80`,
    // `placeholder:text-muted-foreground` and `data-[state=unchecked]:bg-input`
    // are inert again — which is the bug this replaced.
    const theme = themeVars(css);
    const missing = DESIGN_TOKENS.filter(
      (token) => theme.get(`--color-${token}`) !== `hsl(var(--${token}))`
    );

    expect(
      missing,
      "Declare each as `--color-<name>: hsl(var(--<name>))` in `@theme inline`, so Tailwind " +
        "generates the bare name and every variant and opacity form of it."
    ).toEqual([]);
  });

  it("leaves those token classes to Tailwind instead of hand-writing them", () => {
    // The other half: a hand-written copy would sit in a layer and defeat the
    // generated utility's variants, so none of these names may appear as a rule
    // of its own in this file. A selector is escaped in the old file
    // (`.focus-visible\:ring-ring`), so compare the decoded leading class.
    const handWritten = GENERATED_TOKEN_CLASSES.filter((token) =>
      rules.some((rule) => rule.selector.split(",").some((part) => leadingClass(part) === token))
    );

    expect(
      handWritten,
      "These are generated by Tailwind from the `@theme` tokens; a hand-written rule for one " +
        "covers only the bare name and shadows the variant and opacity forms."
    ).toEqual([]);
  });

  it("leaves the border default layered", () => {
    const borderDefault = rules.find((rule) => rule.selector === "*" && rule.declarations.includes("border-color"));
    expect(borderDefault, "`* { border-color }` is what gives borders their default colour").toBeDefined();
    expect(borderDefault?.layer).toBe("base");
  });
});

/**
 * The theme contract, checked from the source.
 *
 * The rendered suite computes no CSS, so the dark theme can only be verified by
 * measuring the live page (see the runbook). What a test *can* pin is the shape
 * the page and the stylesheet agreed on: a `.dark` block that overrides every
 * semantic token, accent blocks for each name the picker can choose, and a
 * pre-paint script that writes the same class and attribute the stylesheet
 * keys off. Each of those has a failure that is invisible in a render — a
 * forgotten token is a single unstyled control, a missing accent block is a
 * picker option that does nothing.
 */
describe("globals.css theme blocks", () => {
  const darkBlock = rules.find((rule) => rule.selector === ".dark");

  it("overrides every semantic token for dark mode", () => {
    expect(darkBlock, "`.dark` is the whole dark theme; without it the page stays light").toBeDefined();
    const declared = darkBlock?.declarations ?? [];
    const missing = DESIGN_TOKENS.filter((token) => !declared.includes(`--${token}`));
    expect(
      missing,
      "Each semantic token is overridden in `.dark`; a token left out keeps its light value " +
        "and that one family of controls stays light on a dark page.",
    ).toEqual([]);
  });

  it("keeps the dark block unlayered and after :root, so it actually wins", () => {
    // The whole mechanism: an unlayered rule beats Tailwind's `@layer theme`
    // variables regardless of specificity, and equal-specificity `:root` loses
    // to a later block. Layering `.dark` or moving it above `:root` would leave
    // it silently losing, which is a theme that half-applies.
    expect(darkBlock?.layer).toBeNull();
    const rootIndex = rules.findIndex((rule) => rule.selector === ":root");
    const darkIndex = rules.findIndex((rule) => rule.selector === ".dark");
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    expect(darkIndex).toBeGreaterThan(rootIndex);
  });

  it("only overrides palette names that @theme actually declares", () => {
    // An app `--color-*` name in `.dark` that is not in `@theme` is generated
    // by nothing, so the override is a no-op and the class it was meant to fix
    // stays light. This is the typo guard; Tailwind's own palette families are
    // emitted by the framework and are allowed through.
    const theme = themeVars(css);
    const paletteOverrides = (darkBlock?.declarations ?? []).filter((name) => name.startsWith("--color-"));
    const unknown = paletteOverrides.filter(
      (name) => !theme.has(name) && !TAILWIND_PALETTE_NAME.test(name),
    );
    expect(unknown, "Add the token to `@theme` or fix the name in `.dark`.").toEqual([]);
    expect(paletteOverrides.length).toBeGreaterThan(0);
  });

  it("declares an accent block for every accent the picker can choose", () => {
    for (const accent of ACCENTS) {
      const block = rules.find((rule) => rule.selector === `:root[data-accent="${accent.id}"]`);
      const declared = block?.declarations ?? [];
      expect(block, `\`:root[data-accent="${accent.id}"]\` is missing, so choosing ${accent.label} does nothing`).toBeDefined();
      expect(declared).toContain("--color-brand-blue");
      expect(declared).toContain("--primary");
      expect(declared).toContain("--ring");
    }
  });

  it("writes the class and attribute the stylesheet keys off, before paint", () => {
    // The script and the stylesheet are two halves of one contract. If the
    // script names a different class, or reads a different storage key than the
    // provider writes, it runs perfectly and does nothing.
    expect(THEME_INIT_SCRIPT).toContain('classList.toggle("dark"');
    expect(THEME_INIT_SCRIPT).toContain("dataset.accent");
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain(ACCENT_STORAGE_KEY);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * One substitution in the real stylesheet's own text, which must land exactly once.
 *
 * This case patches the file the detector actually reads rather than a shape written for
 * the test, so the anchor is what keeps it honest: if the stylesheet is renamed or its
 * first line moves, the case fails instead of leaving a patch that changed nothing and a
 * detector quietly handed a clean source. The mutation sweep's own entries hold themselves
 * to the same rule, for the same reason.
 */
function replaceOnce(source: string, find: string, replace: string): string {
  expect(
    source.split(find).length - 1,
    `the stylesheet no longer contains this anchor exactly once: ${find}`,
  ).toBe(1);
  return source.replace(find, replace);
}

/**
 * The bug, brought back into the real stylesheet.
 *
 * The forbidden fixture in `convention-guards.test.ts` states an unlayered colour rule in
 * the abstract; this states the shape *this repo* wrote twice, patched into `globals.css`
 * itself and handed to the same detector. The layered half above asserts the sheet is clean
 * today; this is the half that fails if the detector stops seeing the rule — and it fails on
 * the file the rule actually lived in, so a rename or a move of the stylesheet cannot leave
 * it passing against a source that no longer exists.
 */
describe("the layering rule, reintroduced in the real stylesheet", () => {
  it("catches a hand-written token class brought back out of a layer", () => {
    // The premise: the sheet is clean today, which is what makes it the file the rule would
    // be reintroduced into. A stray unlayered colour rule arriving for real would fail the
    // invariant above instead, which is the change this case is not.
    expect(unlayeredColourOffenders(css)).toEqual([]);

    // `.border-input` is the rule from the second bug in this file's own note: a hand-written
    // token class at specificity (0,1,0) that outranked a layered `.focus:border-brand-blue`
    // at (0,2,0) for no reason except the layer.
    const reintroduced = replaceOnce(
      css,
      '@import "tailwindcss";\n',
      '@import "tailwindcss";\n\n.border-input { border-color: hsl(var(--input)); }\n',
    );

    expect(unlayeredColourOffenders(reintroduced)).toEqual([".border-input { border-color }"]);
  });
});
