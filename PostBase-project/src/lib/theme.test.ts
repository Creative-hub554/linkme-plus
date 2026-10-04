import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  THEMES,
  appearanceSync,
  isAccent,
  isThemeChoice,
  readPreference,
  resolveTheme,
  writePreference,
} from "./theme";

/**
 * The theme module's decisions, as a contract.
 *
 * The rest of the theme is verified by measurement — the `.dark` block by the
 * build output and the live page, the provider's class on `<html>` by the
 * browser — because jsdom computes no CSS. What is a *rule* rather than a colour
 * lives here and is worth pinning: what `system` resolves to, what counts as a
 * stored value, and above all which of the two places an accent can live wins
 * when they disagree. That last one is the whole of the account-sync feature,
 * and it is one function so that it can be read here.
 *
 * Two of these are guards against a value arriving from outside the app: the
 * stored accent comes out of `localStorage`, and the account's comes out of a
 * response body. Neither is trusted, and `null`/`undefined`/a number are all
 * reachable, so the near-misses are tested rather than only the happy path.
 */
describe("resolveTheme", () => {
  it("follows the device only for `system`", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the device when the reader has chosen", () => {
    // The point: a reader who picked Light keeps Light on a dark machine.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("stored values", () => {
  it("accepts exactly the choices the pickers offer", () => {
    for (const theme of THEMES) expect(isThemeChoice(theme.id)).toBe(true);
    for (const accent of ACCENTS) expect(isAccent(accent.id)).toBe(true);
  });

  it("rejects near-misses and non-strings", () => {
    // `\"Dark\"`, a trailing space, and the values a JSON body can actually
    // carry: what is stored is text, and what is fetched is parsed JSON.
    for (const value of ["Dark", "dark ", "systematic", "", null, undefined, 7, ["dark"], { id: "dark" }]) {
      expect(isThemeChoice(value)).toBe(false);
    }
    for (const value of ["Blue", "ocean blue", "", null, undefined, 7, ["violet"], { id: "rose" }]) {
      expect(isAccent(value)).toBe(false);
    }
  });

  it("reads nothing, and throws nothing, where there is no browser", () => {
    // This is the server-render path: the module is imported by the schema and
    // by the pre-paint script's own file, so the functions must be inert rather
    // than merely careful.
    expect(typeof window).toBe("undefined");
    expect(readPreference("linkme-accent")).toBeNull();
    expect(() => writePreference("linkme-accent", "violet")).not.toThrow();
  });
});

describe("appearanceSync", () => {
  it("takes the account's accent when it has one", () => {
    // Even against a different local choice: the account is what the reader
    // last chose anywhere, which is what makes the accent travel.
    expect(appearanceSync("blue", "emerald")).toEqual({ action: "adopt", accent: "emerald" });
    expect(appearanceSync(null, "rose")).toEqual({ action: "adopt", accent: "rose" });
    expect(appearanceSync(undefined, "amber")).toEqual({ action: "adopt", accent: "amber" });
  });

  it("publishes the device's accent only when the account has none", () => {
    expect(appearanceSync("violet", undefined)).toEqual({ action: "publish", accent: "violet" });
    // A readable account with `{}` in the column is exactly this case, and it is
    // how the first device to choose an accent seeds the others.
    expect(appearanceSync("violet", null)).toEqual({ action: "publish", accent: "violet" });
  });

  it("does nothing when neither side holds a usable accent", () => {
    expect(appearanceSync(null, undefined)).toEqual({ action: "none" });
    expect(appearanceSync("", {})).toEqual({ action: "none" });
  });

  it("does not let a malformed remote value win, or be published", () => {
    // The awkward pair: the account's value is not an accent, but the device's
    // is. The account's is dropped rather than applied, and the device's is then
    // published to replace it — never the other way round, or a renamed accent
    // on the server would both paint nothing and erase a working choice.
    expect(appearanceSync("emerald", "Emerald")).toEqual({ action: "publish", accent: "emerald" });
    expect(appearanceSync("emerald", 7)).toEqual({ action: "publish", accent: "emerald" });
    expect(appearanceSync("Emerald", 7)).toEqual({ action: "none" });
  });
});
