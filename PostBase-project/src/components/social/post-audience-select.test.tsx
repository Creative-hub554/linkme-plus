import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PostAudienceSelect, audienceOptionsFor } from "@/components/social/post-audience-select";
import { AudienceIcon } from "@/components/social/audience-icon";
import { audienceLabel, composerAudiences, postAudiences } from "@/lib/post-audiences";

/**
 * The picker is written in terms of the shared audience list, so what is worth
 * pinning here is that it stayed that way: the menu offers the declared
 * audiences and no others, and it says what the list says they are called.
 */
describe("audienceOptionsFor", () => {
  test("offers every audience a composer can honour, in the order the list declares them", () => {
    expect(audienceOptionsFor().map((option) => option.value)).toEqual([...composerAudiences]);
  });

  test("does not offer the group audience, which no composer chooses", () => {
    // `group` exists and is enforced, but it is not a choice: a post carries it
    // because it was written inside a group, and the group's own composer sets
    // it. Offered here it would be a picker option with nothing behind it, and
    // picking it on an ordinary post would produce one nobody can read.
    expect(postAudiences).toContain("group");
    expect(audienceOptionsFor().map((option) => option.value)).not.toContain("group");
  });

  test("names each option with the audience's own name", () => {
    // A second spelling of "Only me" here is how the menu and the post's pill
    // would start calling the same audience two different things.
    for (const option of audienceOptionsFor()) {
      expect(option.label).toBe(audienceLabel[option.value]);
    }
  });

  test("describes every option, and describes each one differently", () => {
    const descriptions = audienceOptionsFor().map((option) => option.description);
    expect(descriptions.every((description) => description.trim().length > 0)).toBe(true);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  test("says whose followers, and names the Page when a Page is speaking", () => {
    // The one audience whose meaning depends on the speaker. The rule gates a
    // Page's `followers` post on the edge to the *Page*, so copy written for the
    // typist would promise the wrong readers — the same crossing this picker
    // used to be unable to make.
    const member = audienceOptionsFor().find((option) => option.value === "followers");
    const page = audienceOptionsFor("Northwind Studio").find(
      (option) => option.value === "followers",
    );
    expect(member?.description).toBe("People who follow you");
    expect(page?.description).toBe("People who follow Northwind Studio");
  });

  test("changes nothing else about a Page's options", () => {
    // Names, order and the other two descriptions are the member's, so the only
    // thing a subject can move is the sentence that depends on it.
    const member = audienceOptionsFor();
    const page = audienceOptionsFor("Northwind Studio");
    expect(page.map((option) => option.label)).toEqual(member.map((option) => option.label));
    expect(page.map((option) => option.value)).toEqual(member.map((option) => option.value));
    for (const option of page) {
      if (option.value === "followers") continue;
      expect(option.description).toBe(member.find((own) => own.value === option.value)?.description);
    }
    expect(new Set(page.map((option) => option.description)).size).toBe(page.length);
  });
});

describe("the picker's own name", () => {
  test("carries the audience it is currently set to, for every audience it offers", () => {
    // The visible label is the audience's name; a name that did not contain it
    // would be a WCAG 2.5.3 failure, and it would hide the one fact the control
    // exists to state. Loop the list the picker actually offers, which is the
    // set of values it can be given by the surfaces that render it.
    for (const audience of composerAudiences) {
      const html = renderToStaticMarkup(
        <PostAudienceSelect value={audience} onChange={() => {}} />
      );
      expect(html, `the name does not say "${audience}"`).toContain(
        `aria-label="Post audience: ${audienceLabel[audience]}"`
      );
      // …and the same words are on screen, so the name and the label agree.
      expect(html, `"${audience}" is not drawn on the control`).toContain(audienceLabel[audience]);
    }
  });

  test("is not the same string whatever is chosen", () => {
    // The old name was the constant "Choose post audience", which told a reader
    // nothing about the setting it sits next to.
    const names = composerAudiences.map((audience) => {
      const html = renderToStaticMarkup(
        <PostAudienceSelect value={audience} onChange={() => {}} />
      );
      return html.match(/aria-label="([^"]*)"/)?.[1];
    });
    expect(new Set(names).size).toBe(composerAudiences.length);
  });
});

describe("AudienceIcon", () => {
  test("draws something for every audience", () => {
    // The map is keyed by the audience type, so a new audience is a compile
    // error; this catches the other half — an entry that renders nothing.
    for (const audience of postAudiences) {
      const html = renderToStaticMarkup(<AudienceIcon audience={audience} />);
      expect(html, `no icon rendered for "${audience}"`).toContain("<svg");
    }
  });

  test("is the same symbol the picker and the post card draw", () => {
    // Not a restatement of the symbol, only that one component owns it: the
    // picker's options carry no icon of their own to drift with.
    expect(audienceOptionsFor().every((option) => !("icon" in option))).toBe(true);
  });
});
