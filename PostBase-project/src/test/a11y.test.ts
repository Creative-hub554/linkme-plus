// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import {
  accessibleName,
  describeHeadingViolations,
  headingViolations,
  isRendered,
  stateViolations,
  unnamedControls,
} from "@/test/a11y";

/**
 * The audit on a rendered page is only worth anything if the thing doing the
 * judging is right, and in both directions: a helper that reports too little
 * would let a nameless button through, and one that reports too much would be
 * turned off. These are the cases that decide it, written against hand-made
 * markup rather than a mounted component so each one tests a single rule.
 */
function dom(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("what has no name", () => {
  test("a button whose only content is a decorative icon", () => {
    // The shape that shipped: an icon-only control that announces "button".
    const root = dom(`<button><svg aria-hidden="true"></svg></button>`);
    const offenders = unnamedControls(root);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].control).toBe("button");
  });

  test("a field whose label sits beside it but is not attached", () => {
    // `for=` or wrapping is what names a field — a `Label` on the next line is
    // just text next to a control, which is the trap the cover studio fell in.
    const root = dom(`<label>Color</label><input type="color">`);
    expect(unnamedControls(root)).toHaveLength(1);
  });

  test("a menu item with Radix's role and nothing in it", () => {
    const root = dom(`<div role="menu"><div role="menuitemradio"></div></div>`);
    expect(unnamedControls(root)).toHaveLength(1);
  });
});

describe("what does have a name", () => {
  test("visible text", () => {
    expect(unnamedControls(dom(`<button>Save</button>`))).toHaveLength(0);
  });

  test("text meant only for a screen reader", () => {
    // `sr-only` content is text: it is hidden from the eye, not the reader.
    const html = `<button><svg aria-hidden="true"></svg><span class="sr-only">Save</span></button>`;
    expect(unnamedControls(dom(html))).toHaveLength(0);
  });

  test("an aria-label", () => {
    expect(unnamedControls(dom(`<button aria-label="Save listing"></button>`))).toHaveLength(0);
  });

  test("an aria-labelledby pointing at text elsewhere", () => {
    const html = `<span id="t">Save listing</span><button aria-labelledby="t"></button>`;
    expect(unnamedControls(dom(html))).toHaveLength(0);
  });

  test("an image's alt text inside the control", () => {
    expect(unnamedControls(dom(`<button><img alt="Save"></button>`))).toHaveLength(0);
  });

  test("a field's own label, attached either way", () => {
    const explicit = dom(`<label for="a">Email</label><input id="a">`);
    const wrapping = dom(`<label>Email<input id="b"></label>`);
    expect(unnamedControls(explicit)).toHaveLength(0);
    expect(unnamedControls(wrapping)).toHaveLength(0);
  });

  test("a field's placeholder, which is the spec's own last resort", () => {
    expect(unnamedControls(dom(`<input placeholder="Search conversations..." />`))).toHaveLength(0);
    expect(unnamedControls(dom(`<textarea placeholder="What's on your mind?"></textarea>`))).toHaveLength(0);
  });

  test("a select with nothing but its options", () => {
    // Unlike the two above, a `select` has no placeholder to fall back on: an
    // unlabelled one is genuinely nameless, which is why the app's selects
    // carry their own names.
    const root = dom(`<select><option>Public</option></select>`);
    expect(unnamedControls(root)).toHaveLength(1);
  });

  test("the title attribute", () => {
    expect(unnamedControls(dom(`<button title="Save"></button>`))).toHaveLength(0);
  });
});

describe("what is not there to be named", () => {
  test("a control hidden from everyone", () => {
    expect(unnamedControls(dom(`<button class="hidden"><svg></svg></button>`))).toHaveLength(0);
  });

  test("a control hidden from a screen reader", () => {
    expect(unnamedControls(dom(`<div aria-hidden="true"><button></button></div>`))).toHaveLength(0);
  });

  test("a hidden input", () => {
    expect(unnamedControls(dom(`<input type="hidden" value="x">`))).toHaveLength(0);
  });
});

describe("isRendered", () => {
  test("treats a bare hidden class as hidden but a breakpointed one as shown", () => {
    // jsdom computes no CSS, so `display: none` has to be read off the class
    // list. `hidden md:flex` is on screen at desktop width and must be audited.
    const [bare, atBreakpoint, mobileOnly] = Array.from(
      dom(
        `<button class="hidden"></button>` +
          `<button class="hidden md:flex"></button>` +
          `<button class="md:hidden"></button>`
      ).children
    );
    expect(isRendered(bare)).toBe(false);
    expect(isRendered(atBreakpoint)).toBe(true);
    expect(isRendered(mobileOnly)).toBe(true);
  });
});

describe("accessibleName", () => {
  test("prefers the reference to the label to the text inside", () => {
    const html = `<span id="t">Referenced</span><button aria-labelledby="t" aria-label="Label">Inside</button>`;
    const button = dom(html).querySelector("button")!;
    // The spec's order, not a preference: `aria-labelledby` outranks `aria-label`.
    expect(accessibleName(button)).toBe("Referenced");
  });

  test("joins the text a reader would get, not the markup", () => {
    const button = dom(`<button>Save <strong>this</strong> listing</button>`).querySelector("button")!;
    expect(accessibleName(button)).toBe("Save this listing");
  });

  test("does not let a container borrow the words inside it", () => {
    // The trap the group rule exists for: a `role="group"` of chips would look
    // named if a container took its name from its contents, and `role="group"`
    // is an author-named role. An `aria-label` on a plain `div` is ignored, so
    // these rows were nameless with the label written right there.
    const group = dom(
      `<div role="group"><button aria-pressed="true">Electronics</button></div>`,
    ).querySelector('[role="group"]')!;
    expect(accessibleName(group)).toBe("");
  });
});

/**
 * The state rules, one case at a time.
 *
 * These are the audit's judgements, so they are settled here on hand-made markup
 * before they are trusted to judge a page. In particular the two cases that made
 * the rules role-aware: a chosen option stated by `aria-current` on one member
 * only is correct, and a tab owning a panel says `aria-selected` rather than
 * `aria-expanded`. The group cases are role-aware in the same way: a choice can
 * be spelled as `group` or `radiogroup`, and its options as buttons, `radio`s or
 * a menu's `menuitemradio`s, and the rule is about the choice rather than the
 * spelling. The region rules are the other half of the same idea (a control that
 * owns something should say so, and what it names should be there), and the
 * choice rules also arrive as Radix shapes — a `tablist` of `tab`s,
 * which is asked both halves of the rule, and a `listbox` of `option`s, which is
 * asked only the state half because the combobox that owns it carries the name —
 * and these cases pin that difference in both directions.
 */
describe("state that is drawn but not said", () => {
  test("a group of options with no name", () => {
    const root = dom(`<div role="group"><button aria-pressed="false">All</button></div>`);
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unnamed-group");
  });

  test("a named group of options where none says it is chosen", () => {
    // The shape four of this app's filter rows shipped in: the fill was there,
    // the announcement was not, and nothing in the row said which was on.
    const root = dom(
      `<div role="group" aria-label="Filter listings">` +
        `<button>All</button><button>Electronics</button>` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("silent-choice");
  });

  test("a named group where one member carries the state", () => {
    // `aria-current` is only written on the chosen member — its absence is how
    // the others say "not me" — so one is enough.
    const root = dom(
      `<div role="group" aria-label="Preview slides">` +
        `<button aria-current="true">One</button><button>Two</button>` +
        `</div>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a control that owns a region but reports nothing for it", () => {
    // What a disclosure without `aria-expanded` is: the region is named and its
    // state is nowhere.
    const found = stateViolations(dom(`<button aria-controls="panel">Menu</button>`));
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("silent-region");
  });

  test("a control that says it is expanded while the region is absent", () => {
    const found = stateViolations(
      dom(`<button aria-controls="panel" aria-expanded="true">Menu</button>`),
    );
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("absent-region");
  });

  test("an expanded control whose region is there", () => {
    const root = dom(
      `<button aria-controls="panel" aria-expanded="true">Menu</button>` +
        `<div id="panel">The panel</div>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a collapsed control whose region is not", () => {
    // The normal state of a disclosure, and of every popover in this app: the
    // button is closed and the region it will open has not been mounted. A
    // reference to nothing is allowed here and only here, because the control's
    // own report explains the absence.
    expect(
      stateViolations(dom(`<button aria-controls="panel" aria-expanded="false">Menu</button>`)),
    ).toHaveLength(0);
  });

  test("a control that names a region nothing renders", () => {
    // The broken-reference shape: a tab whose panel was renamed, deleted, or
    // written with the wrong id. The reader gets a control that does nothing,
    // and nothing else in this file would notice — which is how a panel can go
    // missing without a test going red.
    const root = dom(
      `<div role="tablist" aria-label="Admin sections">` +
        `<button role="tab" aria-selected="true" aria-controls="gone">Reports</button>` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("dangling-region");
  });

  test("a control whose label points at nothing, while still having a name", () => {
    // The whole reason this rule exists, in one case: `accessibleName`
    // **falls through** a reference that does not resolve, so the control is
    // still named — by its own text — and the name audit is perfectly happy.
    // What quietly stopped working is the reference the author wrote.
    const root = dom(`<button aria-labelledby="gone">Save listing</button>`);
    expect(unnamedControls(root)).toHaveLength(0);
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("dangling-label");
  });

  test("a label reference that names one real element and one that is gone", () => {
    // Only the missing id is reported, and by name: the other half of the
    // reference is doing its job, and reporting it would be noise.
    const root = dom(
      `<span id="there">Theme</span><button aria-labelledby="there gone">Light</button>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].why).toContain("#gone");
    expect(found[0].why).not.toContain("#there");
  });

  test("a label reference that resolves, and an empty one", () => {
    // An empty `aria-labelledby` names nothing and points at nothing — it is not
    // a dangling reference, and treating it as one would be this rule inventing
    // a second question to answer.
    const root = dom(
      `<span id="there">Theme</span>` +
        `<button aria-labelledby="there">Light</button>` +
        `<button aria-labelledby="">Dark</button>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a hint pointing at a description nothing renders, on a control that is fine", () => {
    // The reason this rule exists, and the worse half of the label problem: the
    // field is named, rendered and reachable, and `accessibleName` is happy. The
    // hint it points at is simply not there, and — unlike a label — a description
    // has nothing to fall through to, so it is never read at all. Nothing on the
    // page looks wrong; only the reference is broken.
    const root = dom(
      `<label for="email">Email</label>` +
        `<input id="email" aria-describedby="email-hint">`,
    );
    expect(unnamedControls(root)).toHaveLength(0);
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("dangling-description");
  });

  test("a description reference that names one real element and one that is gone", () => {
    // Only the missing id is reported, and by name — the other half is doing its
    // job, and reporting it would be noise.
    const root = dom(
      `<span id="real">Must be at least 8 characters</span>` +
        `<input aria-describedby="real gone">`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].why).toContain("#gone");
    expect(found[0].why).not.toContain("#real");
  });

  test("a description reference that resolves, and an empty one", () => {
    // A hint that is there is not a violation, and an empty `aria-describedby`
    // points at nothing and claims nothing — inventing a failure for it would be
    // this rule answering a question nobody asked.
    const root = dom(
      `<span id="hint">Must be at least 8 characters</span>` +
        `<input aria-describedby="hint">` +
        `<input aria-describedby="">`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a hidden description still counts as one that is rendered", () => {
    // Existence is the whole test, as it is for a label: a description that is
    // `hidden` on screen is still handed to a reader when it is named directly,
    // so this must stay silent.
    const root = dom(
      `<span id="hint" hidden>Must be at least 8 characters</span>` +
        `<input aria-describedby="hint">`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a hint hung on a wrapper that is not a control", () => {
    // The defect this half exists for, and the one a reference check cannot
    // see: the target is right there, the attribute is written, and no reader is
    // ever given the hint — because a bare `<div>` has the `generic` role, which
    // does not support a description. The field itself is fine, so nothing on the
    // page looks wrong. Pointed at an id that **exists**, to isolate the rule:
    // the only thing being settled here is *where* the hint is attached.
    const root = dom(
      `<span id="hint">Must be at least 8 characters</span>` +
        `<div aria-describedby="hint">` +
        `<label for="pw">Password</label><input id="pw">` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("misplaced-description");
  });

  test("a hint hung on a wrapper that points at nothing as well", () => {
    // Both halves are broken — nothing to read and nowhere to read it — and the
    // rule reports the root cause once rather than two symptoms of the same
    // mistake.
    const root = dom(`<div aria-describedby="gone">Password field</div>`);
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("misplaced-description");
  });

  test("a hint on a container with a role of its own", () => {
    // A described `region` is correct ARIA, and so is a described `radiogroup`
    // or `group`. The rule stops at "a control **or** anything with a role"
    // rather than demanding a control, so it does not report the app for a
    // decision the standard endorses — the same reason the `listbox` is exempt
    // from the name half.
    const root = dom(
      `<div role="region" aria-label="Password help" aria-describedby="hint">` +
        `<span id="hint">Must be at least 8 characters</span>` +
        `</div>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a hint on a control, which is where it belongs", () => {
    // The case the hint is for, stated beside the wrapper case above so the
    // pair makes the rule's boundary explicit.
    const root = dom(
      `<label for="pw">Password</label>` +
        `<input id="pw" aria-describedby="hint">` +
        `<span id="hint">Must be at least 8 characters</span>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("two elements sharing one id", () => {
    // The substrate of every reference rule above: the id is a promise made
    // once, and the second element to claim it is the one that is never reached.
    // Reported once, and by name, so a failure points at the id.
    const root = dom(`<span id="hint">One</span><span id="hint">Two</span>`);
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("duplicate-id");
    expect(found[0].why).toContain("hint");
  });

  test("one id claimed by three elements", () => {
    // Counted rather than repeated: three claimants are one broken id, not two
    // failures, and the message says how many.
    const root = dom(
      `<span id="dup">a</span><span id="dup">b</span><span id="dup">c</span>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].why).toContain("3 elements");
  });

  test("a duplicated id that is hidden", () => {
    // `isRendered` is deliberately not applied here, unlike every rule above: a
    // hidden element still answers `getElementById`, so it breaks a reference
    // just as well as a visible one, and the ambiguity is about the id rather
    // than about what is on screen.
    const root = dom(`<span id="hint">One</span><span id="hint" hidden>Two</span>`);
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("duplicate-id");
  });

  test("ids that are distinct, and ids that are empty", () => {
    // An empty `id` is not an id — nothing resolves to it — so two of them make
    // nothing ambiguous and treating them as a duplicate would be noise.
    const root = dom(
      `<span id="a">a</span><span id="b">b</span>` +
        `<span id="">c</span><span id="">d</span>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a label whose `for` names a field that is not there", () => {
    // The nameless field in its most plausible disguise: the words are rendered
    // and look attached, but `for` points at an id the page never renders, so the
    // label is connected to nothing — exactly the `Label` rendered *beside* a
    // control that `a field whose label sits beside it but is not attached`
    // covers from the other side.
    const found = stateViolations(dom(`<label for="email">Email</label>`));
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("dangling-field");
    expect(found[0].why).toContain("#email");
  });

  test("a label whose `for` resolves to its field", () => {
    // The real shape, and the one every field in this app is written with.
    const root = dom(
      `<label for="email">Email</label><input id="email" type="email">`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a label whose `for` is empty, and a label that wraps instead", () => {
    // An empty `for` points at nothing and claims nothing, like an empty
    // `aria-labelledby`. A wrapping label has no `for` at all, so this rule has
    // no opinion about it — naming-by-wrapping is the name audit's business.
    const root = dom(
      `<label for="">Email</label>` +
        `<label>Password<input type="password"></label>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a label whose `for` points at a field that is hidden", () => {
    // Existence is the whole test, as it is for every reference above: a hidden
    // field is still a field, and a label pointing at it is doing its job.
    const root = dom(
      `<label for="email">Email</label><input id="email" hidden>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a label that wraps its field but still has a broken `for`", () => {
    // Reported even though the field is still named by the wrapping label, for
    // the same reason `dangling-label` fires on a control that still announces
    // something: the reference is what quietly stopped working.
    const root = dom(`<label for="gone">Email<input type="email"></label>`);
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("dangling-field");
  });

  test("a label whose `for` points at something that exists but cannot be labelled", () => {
    // The quiet one, and the reason existence was not enough: the id resolves in
    // full, every reference check is satisfied, and the label is still wired to
    // nothing — because `for` attaches only to a labelable element and a plain
    // `<div>` is not one.
    const root = dom(`<label for="email">Email</label><div id="email"></div>`);
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unlabelable-target");
    expect(found[0].why).toContain("#email");
  });

  test("a label whose `for` points at an ARIA control rather than a labelable one", () => {
    // A `role="textbox"` div is a control the audit knows about, but `for` does
    // not associate with it — an ARIA widget takes its label through
    // `aria-labelledby`/`aria-label`. So the two sets differ on purpose, and this
    // pins that the rule uses the narrower, spec-exact one.
    const root = dom(
      `<label for="email">Email</label><div id="email" role="textbox"></div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unlabelable-target");
  });

  test("a label whose `for` points at a hidden input", () => {
    // `input type="hidden"` is on the spec's list of *unlabelable* inputs, so a
    // `for` reaching one is wired to nothing just as a `<div>` is.
    const root = dom(
      `<label for="token">Session</label><input id="token" type="hidden">`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unlabelable-target");
  });

  test("a label whose `for` points at each kind of labelable field", () => {
    // The real shapes, and what the rule must not report: `input`, `select`,
    // `textarea` and `button` are all labelable, a `button` included (Radix's
    // `SelectTrigger` is one, which is what the settings page labels).
    const root = dom(
      `<label for="a">A</label><input id="a">` +
        `<label for="b">B</label><select id="b"><option>One</option></select>` +
        `<label for="c">C</label><textarea id="c"></textarea>` +
        `<label for="d">D</label><button id="d">Go</button>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a label whose `for` points at a labelable field that is hidden", () => {
    // Labelability and visibility are different questions: a hidden `input` is
    // still labelable, so this must stay silent — the same "existence, not
    // screen presence" stance the reference rules above take.
    const root = dom(`<label for="a">A</label><input id="a" hidden>`);
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a tab whose panel is in the page but hidden", () => {
    // Radix renders every panel and hides the ones that are not on, so the
    // reference resolves and there is nothing to report. The rule asks whether
    // the region *exists*, not whether it is on screen: only "I am expanded"
    // has to be true of something visible.
    const root = dom(
      `<div role="tablist" aria-label="Admin sections">` +
        `<button role="tab" aria-selected="true" aria-controls="p1">Reports</button>` +
        `<button role="tab" aria-selected="false" aria-controls="p2">Users</button>` +
        `</div><div id="p1">Reports</div><div id="p2" hidden>Users</div>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a tab owning a panel, which states itself another way", () => {
    // Radix's tabs were what made the rule stop dictating the attribute: a tab
    // owns its panel and says `aria-selected`, and asking it for `aria-expanded`
    // would have been the rule being wrong about what the control is.
    const root = dom(
      `<div role="tablist" aria-label="Admin sections">` +
        `<button role="tab" aria-selected="true" aria-controls="p1">Reports</button>` +
        `<button role="tab" aria-selected="false" aria-controls="p2">Users</button>` +
        `</div><div id="p1">Reports</div><div id="p2">Users</div>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("says nothing about what it is not asked", () => {
    // A control with no group and no region is not this rule's business; the
    // name audit is what has an opinion about it.
    expect(stateViolations(dom(`<button aria-pressed="true">All</button>`))).toHaveLength(0);
  });

  test("a radiogroup where none of the options says it is chosen", () => {
    // `radiogroup` is the shape with a spec'd meaning — one of these is chosen —
    // and it was the one form of "choose one of these" the rule could not see,
    // because it looked only for `role="group"`. This is the app's theme and
    // accent pickers with their `aria-checked` taken away.
    const root = dom(
      `<div role="radiogroup" aria-label="Theme">` +
        `<button role="radio">Light</button><button role="radio">Dark</button>` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("silent-choice");
  });

  test("a radiogroup whose options are not buttons", () => {
    // The rule is about the options, not the tag: a group of `role="radio"`
    // spans is the same set of choices, and counting only `<button>`s would have
    // called it "a group with no options" and passed it silently.
    const root = dom(
      `<div role="radiogroup" aria-label="Theme">` +
        `<span role="radio">Light</span><span role="radio">Dark</span>` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("silent-choice");
  });

  test("a radiogroup that names its choice, by reference", () => {
    // The real shape, both halves: the group is named through the heading it
    // points at, and every option carries the attribute that says whether it is
    // the chosen one (so the reader is told "not me" as well as "me").
    const root = dom(
      `<p id="t">Theme</p>` +
        `<div role="radiogroup" aria-labelledby="t">` +
        `<button role="radio" aria-checked="false">Light</button>` +
        `<button role="radio" aria-checked="true">Dark</button>` +
        `</div>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a radiogroup with no name", () => {
    // Nameless is the other half of the same rule, and it applies to a
    // `radiogroup` exactly as it does to a `group`.
    const root = dom(
      `<div role="radiogroup"><button role="radio" aria-checked="true">Light</button></div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unnamed-group");
  });

  test("a tablist that neither names itself nor says which tab is selected", () => {
    // Both halves, on the shape the app renders twice (the search page's six
    // tabs and the admin's four). The order is the order the rule asks in: is
    // anything saying what this set is for, and then is anything saying which
    // one is on.
    const root = dom(
      `<div role="tablist">` +
        `<button role="tab">Reports</button><button role="tab">Users</button>` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found.map((violation) => violation.rule)).toEqual(["unnamed-group", "silent-choice"]);
  });

  test("the real tablist: named, with `aria-selected` on every trigger", () => {
    // What Radix renders once the list is given a name — including the `false`
    // ones, because "not me" is also worth saying.
    const root = dom(
      `<div role="tablist" aria-label="Admin sections">` +
        `<button role="tab" aria-selected="true">Reports</button>` +
        `<button role="tab" aria-selected="false">Users</button>` +
        `</div>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a listbox where none of the options says it is chosen", () => {
    // Radix's `Select` content, which is what the settings page's visibility
    // picker opens into — with the `aria-selected` taken out of the options.
    const root = dom(
      `<div role="listbox" aria-label="Who can see this post">` +
        `<div role="option">Public</div><div role="option">Followers</div>` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("silent-choice");
  });

  test("a listbox that says which option is chosen, and names nothing", () => {
    // Unnamed on purpose, because this is what Radix's `Select` renders and what
    // the rule therefore must not object to: the combobox trigger that owns the
    // popup carries the name, and the popup is that control's face. The state is
    // stated and the container is not named — and that is correct.
    const root = dom(
      `<div role="listbox">` +
        `<div role="option" aria-selected="false">Public</div>` +
        `<div role="option" aria-selected="true">Followers</div>` +
        `</div>`,
    );
    expect(stateViolations(root)).toHaveLength(0);
  });

  test("a named listbox whose options are silent", () => {
    // The name is not an answer to the state question: a listbox can be named
    // perfectly and still show nothing about which option is on.
    const root = dom(
      `<div role="listbox" aria-label="Who can see this post">` +
        `<div role="option">Public</div>` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("silent-choice");
  });

  test("a menu's radio group, which is a plain group", () => {
    // Radix renders `DropdownMenuRadioGroup` as `role="group"` holding
    // `menuitemradio`s — the nav's theme menu — so the same rule reaches it
    // through the option selector rather than through the group role.
    const root = dom(
      `<div role="group" aria-label="Theme">` +
        `<div role="menuitemradio">Light</div><div role="menuitemradio">Dark</div>` +
        `</div>`,
    );
    const found = stateViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("silent-choice");
  });
});

describe("the heading outline", () => {
  test("one h1 with the levels in order is the shape a page should be", () => {
    expect(headingViolations(dom(`<h1>Settings</h1><h2>Profile</h2><h3>Photo</h3>`))).toHaveLength(0);
  });

  test("a page with no level-1 heading", () => {
    const found = headingViolations(dom(`<h2>Settings</h2><p>Text</p>`));
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("no-h1");
  });

  test("a second level-1 heading, which splits the page into two subjects", () => {
    const found = headingViolations(dom(`<h1>Settings</h1><h2>Profile</h2><h1>Billing</h1>`));
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("many-h1");
  });

  test("a level skipped on the way down", () => {
    // `h1` then `h3` leaves `h2` unannounced, so a reader descending finds a
    // level that was never there.
    const found = headingViolations(dom(`<h1>Help</h1><h3>Billing</h3>`));
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("skipped-level");
  });

  test("a level risen back up, which is a new section and not a skip", () => {
    expect(
      headingViolations(dom(`<h1>Help</h1><h2>Billing</h2><h3>Refunds</h3><h2>Account</h2>`)),
    ).toHaveLength(0);
  });

  test("an ARIA heading counts by its aria-level", () => {
    // Radix and friends draw a heading as a div with a role; without this the
    // outline would look empty and every page built that way would fail for no
    // reason.
    const root = dom(
      `<div role="heading" aria-level="1">Settings</div>` +
        `<div role="heading" aria-level="2">Profile</div>`,
    );
    expect(headingViolations(root)).toHaveLength(0);
  });

  test("an ARIA heading with no level is not counted as one", () => {
    expect(
      headingViolations(dom(`<h1>Settings</h1><div role="heading">Profile</div>`)),
    ).toHaveLength(0);
  });

  test("a hidden heading is not part of the outline", () => {
    // What a reader cannot reach cannot mislead them: a second `h1` that is
    // closed is not a second subject.
    const root = dom(`<h1>Settings</h1><h1 hidden>Billing</h1><h3 class="hidden">Refunds</h3>`);
    expect(headingViolations(root)).toHaveLength(0);
  });

  test("the failure message names the rule", () => {
    const found = headingViolations(dom(`<h2>Settings</h2>`));
    expect(describeHeadingViolations(found)).toContain("no-h1");
    expect(describeHeadingViolations([])).toBe("the headings form one outline");
  });
});
