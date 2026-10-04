/**
 * Enough of the accessible-name computation to catch a control nobody can name.
 *
 * This is not a full implementation of accname — it is the subset that decides
 * whether a button, link, field or menu item has *any* name at all, which is the
 * failure the app shipped once already: the mobile menu button was a nameless
 * `<Button>` with an icon in it, so it announced "button" and nothing else. An
 * audit that only understands `aria-label` would not have caught it either,
 * because the fix was to give it one.
 *
 * What it understands, in the order the spec prefers:
 *
 * 1. `aria-labelledby` → the text of the element(s) it points at;
 * 2. `aria-label`;
 * 3. what the control is: an image's `alt`, a submit input's `value`, a field's
 *    `<label>`, a field's `placeholder` (the spec's own last resort);
 * 4. the text inside it, counted the way a reader would get it — descendants
 *    flagged `aria-hidden` are skipped, images contribute their `alt`;
 * 5. the `title` attribute.
 *
 * Two things jsdom forces, both of which are stated rather than hidden:
 *
 * - **No CSS.** `display:none` cannot be computed, so an element is treated as
 *   unrendered when its class list carries a bare `hidden` with no breakpoint
 *   that brings it back (`hidden md:flex` is rendered; `hidden` is not). That is
 *   a heuristic over class names, and it is the only reason the composer's
 *   `className="hidden"` file input is not reported.
 * - **No pseudo-content**, and no `::before`/`::after` text, which nothing in
 *   this app relies on for a name.
 */

/** Roles that make an element a control a reader has to be able to name. */
const CONTROL_ROLES = [
  "button",
  "link",
  "menuitem",
  "menuitemradio",
  "menuitemcheckbox",
  "tab",
  "switch",
  "checkbox",
  "radio",
  "option",
  "combobox",
  "searchbox",
  "textbox",
  "slider",
  "spinbutton",
];

const CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  ...CONTROL_ROLES.map((role) => `[role="${role}"]`),
].join(", ");

const RE_SHOW_AT_BREAKPOINT = /^(sm|md|lg|xl|2xl):(block|flex|grid|inline|inline-block|inline-flex|table)$/;

/**
 * Roles that take their name from the author and never from their contents.
 *
 * This matters for containers: the marketplace's filter row is a
 * `role="group"` full of chips, and name-from-content would hand it the chips'
 * own labels as its name — so an *unlabelled* row would look named, which is the
 * bug (an `aria-label` on a plain `div` is ignored, so those rows had no name at
 * all until the role was added).
 */
const AUTHOR_NAMED_ROLES = new Set([
  "group",
  "radiogroup",
  "listbox",
  // `tablist` belongs here for the same reason `group` does, and its absence
  // was found the moment a nameless one was tested: without it the container
  // took its name from the *tabs inside it*, so "Reports Users Content
  // Analytics" looked like a name and an unnamed tablist read as named. ARIA
  // says the same thing — `tablist` is name-from-author, not from contents.
  "tablist",
  "menu",
  "menubar",
  "toolbar",
  "tabpanel",
  "dialog",
  "alertdialog",
  "region",
  "navigation",
  "banner",
  "complementary",
  "contentinfo",
  "main",
  "form",
  "search",
  "img",
  "progressbar",
  "separator",
]);

function classesOf(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** Whether the element would be in the accessibility tree, as far as jsdom can tell. */
export function isRendered(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (node.hasAttribute("hidden")) return false;
    if (/display\s*:\s*none/.test(node.getAttribute("style") ?? "")) return false;

    const classes = classesOf(node);
    if (classes.includes("hidden") && !classes.some((name) => RE_SHOW_AT_BREAKPOINT.test(name))) {
      return false;
    }
  }
  return true;
}

/** The readable text inside a subtree, as a reader would receive it. */
function subtreeText(element: Element): string {
  let text = "";

  for (const node of element.childNodes) {
    if (node.nodeType === 3) {
      text += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== 1) continue;

    const child = node as Element;
    if (child.getAttribute("aria-hidden") === "true") continue;
    if (child.tagName === "IMG") {
      text += ` ${child.getAttribute("alt") ?? ""} `;
      continue;
    }
    if (child.tagName === "SVG") continue;
    text += ` ${subtreeText(child)} `;
  }

  return text.replace(/\s+/g, " ").trim();
}

/** The `<label>` written for a field, by `for=` or by wrapping it. */
function labelFor(element: Element): string {
  const id = element.getAttribute("id");
  if (id) {
    const explicit = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (explicit && subtreeText(explicit)) return subtreeText(explicit);
  }
  const wrapping = element.closest("label");
  return wrapping ? subtreeText(wrapping) : "";
}

function intrinsicName(element: Element): string {
  const tag = element.tagName;

  if (tag === "IMG") return element.getAttribute("alt")?.trim() ?? "";

  if (tag === "INPUT") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "submit" || type === "reset" || type === "button") {
      return (element.getAttribute("value") ?? "").trim();
    }
    if (type === "image") return (element.getAttribute("alt") ?? "").trim();
    // `placeholder` is the spec's own last resort for a field with no label.
    return labelFor(element) || (element.getAttribute("placeholder") ?? "").trim();
  }

  // A `textarea` gets the same last-resort placeholder a text `input` does —
  // this is where the composer sits: its box is named "What's on your mind?" by
  // its placeholder and nothing else, and a real browser announces exactly that.
  // Calling that nameless would have made the audit report the app for the way
  // it is written rather than for something being wrong with it.
  if (tag === "TEXTAREA") return labelFor(element) || (element.getAttribute("placeholder") ?? "").trim();

  // A `select` has no placeholder to fall back to: no label means no name.
  if (tag === "SELECT") return labelFor(element);

  return "";
}

/**
 * The name a reader would hear for this element, or `""` if there is none.
 *
 * The order is the spec's: an explicit reference, then an explicit label, then
 * what the element itself says, then the text inside it.
 */
export function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const referred = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => node.getAttribute("aria-label")?.trim() || subtreeText(node))
      .join(" ")
      .trim();
    if (referred) return referred;
  }

  const label = element.getAttribute("aria-label")?.trim();
  if (label) return label;

  const intrinsic = intrinsicName(element);
  if (intrinsic) return intrinsic;

  // A container's name is the author's to give. Before the content step, so a
  // group cannot borrow the words inside it.
  const role = element.getAttribute("role");
  if (role && AUTHOR_NAMED_ROLES.has(role)) return element.getAttribute("title")?.trim() ?? "";

  // Name from content is a per-role rule, and these roles are not on the list:
  // what is written inside an `input`, a `textarea` or a `select` is its *value*,
  // not its name — a select whose options read "Public / Followers / Only me"
  // announces its current choice, not what it is. Everything else here (buttons,
  // links, menu items, options, tabs) does take its name from its content.
  const takesNameFromContent = !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
  if (takesNameFromContent) {
    const content = subtreeText(element);
    if (content) return content;
  }

  return element.getAttribute("title")?.trim() ?? "";
}

export interface UnnamedControl {
  /** What a reader hears instead of a name: the tag and its role. */
  control: string;
  /** The markup, trimmed — enough to find it without opening a debugger. */
  html: string;
}

/**
 * Every control a reader can reach in `root`, named or not.
 *
 * Exported because an audit has to be able to say it had something to look at.
 * `unnamedControls` over a document that rendered nothing is `[]`, so an empty
 * page passes a nameless-control audit perfectly — there is nothing in it to be
 * unnamed — and a green check that inspected nothing is worse than a red one.
 * Sharing this enumeration rather than repeating the selector is the point: two
 * lists of "what counts as a control" would eventually disagree.
 */
export function reachableControls(root: ParentNode): Element[] {
  return [...root.querySelectorAll(CONTROL_SELECTOR)].filter((element) => {
    if (element.tagName === "INPUT" && (element.getAttribute("type") ?? "").toLowerCase() === "hidden") {
      return false;
    }
    return isRendered(element);
  });
}

/**
 * Every control in `root` that a reader could reach but not name.
 *
 * `root` should be the document, not the mount container: Radix renders menus,
 * tooltips and dialogs into a portal on `document.body`, and those are exactly
 * the controls most likely to be missed by eye.
 */
export function unnamedControls(root: ParentNode): UnnamedControl[] {
  const found: UnnamedControl[] = [];

  for (const element of reachableControls(root)) {
    if (accessibleName(element)) continue;

    const role = element.getAttribute("role");
    found.push({
      control: role ? `${element.tagName.toLowerCase()}[role=${role}]` : element.tagName.toLowerCase(),
      html: (element.outerHTML ?? "").replace(/\s+/g, " ").slice(0, 160),
    });
  }

  return found;
}

/** A failure message that lists what is wrong rather than only how many. */
export function describeUnnamed(offenders: UnnamedControl[]): string {
  if (offenders.length === 0) return "every control has a name";
  return [
    `${offenders.length} control(s) with no accessible name:`,
    ...offenders.map((offender) => `  - ${offender.control}  ${offender.html}`),
  ].join("\n");
}

/**
 * Attributes that say which option in a set is the chosen one.
 *
 * Four, because there are four correct spellings and the right one depends on
 * what the options *are*: a toggle says `aria-pressed`, a radio or a menu's
 * `menuitemradio` says `aria-checked`, a tab or a listbox option says
 * `aria-selected`, and a row that marks the current page says `aria-current`.
 * The rule does not dictate which — it asks whether *any* member says anything,
 * because "the chosen one is the filled one" said in a different vocabulary is
 * still said, and demanding the spec's attribute per role would have flagged
 * Radix's own tabs. `aria-selected` was the one missing, and its absence is why
 * the tabs looked silent: Radix writes it on every trigger, including the
 * unselected ones, and the rule was not reading it.
 */
const OPTION_STATE_ATTRIBUTES = [
  "aria-pressed",
  "aria-checked",
  "aria-selected",
  "aria-current",
] as const;

/**
 * Attributes that report the state of a region this element owns.
 *
 * Which one is right depends on what the element *is*: a disclosure says
 * `aria-expanded`, a tab says `aria-selected`, a row that reveals a detail says
 * `aria-expanded` again. What is not allowed is owning a region and reporting
 * nothing about it — which is what a hamburger that turns into an × does when
 * nobody writes the attribute.
 */
const OWNED_REGION_STATE_ATTRIBUTES = [
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-pressed",
] as const;

export interface StateViolation {
  /** The invariant, named so a failure says what kind of thing is wrong. */
  rule: string;
  /** What the reader is not being told. */
  why: string;
  html: string;
}

function stateViolation(rule: string, element: Element, why: string): StateViolation {
  return { rule, why, html: (element.outerHTML ?? "").replace(/\s+/g, " ").slice(0, 200) };
}

/**
 * The roles that throw a description away, so a hint hung on one is never read.
 *
 * `generic` is the role a bare `div` or `span` gets, and ARIA does not merely
 * ignore `aria-describedby` there — it prohibits it, because there is no
 * accessibility object to attach a description to. `none` and `presentation`
 * strip the element out of the tree for the same reason.
 */
const ROLE_DESCRIPTION_IS_LOST = new Set(["generic", "none", "presentation"]);

/**
 * Whether a reader could ever be given a description for this element at all.
 *
 * Two ways in, and the split is the point. A **control** — whatever a reader can
 * operate — always supports a description, and that is the case a hint exists
 * for. And **anything carrying a role of its own** does too, because every
 * widget, landmark and container role supports `aria-describedby`; a described
 * `radiogroup` or `region` is correct ARIA, not a defect, and reporting it would
 * be the audit objecting to a decision the standard endorses — the same mistake
 * the `listbox` exemption exists to avoid.
 *
 * What is left is the real failure, and the one this half is here for:
 * `aria-describedby` on a bare `<div>` or `<span>`. With no role, the element's
 * role is `generic`, which does not support a description, so the hint can be
 * written, its target can exist, and *no reader is ever given it*. That is the
 * silent loss `dangling-description` names, one step over: there the description
 * is missing; here the thing that would be described cannot be described.
 */
function canBeDescribed(element: Element): boolean {
  if (element.matches(CONTROL_SELECTOR)) return true;

  // A `role` is a space-separated fallback list; the first token is the one that
  // applies when it is supported, which is what a reader gets here.
  const role = (element.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
  return role !== "" && !ROLE_DESCRIPTION_IS_LOST.has(role);
}

/** The elements HTML calls *labelable* — the only things a `<label for>` attaches to. */
const LABELABLE_TAGS = new Set(["BUTTON", "INPUT", "METER", "OUTPUT", "PROGRESS", "SELECT", "TEXTAREA"]);

/**
 * Whether a `<label for>` can actually attach to this element.
 *
 * The spec's own list, and it is short for a reason: `for` associates a label
 * with a *labelable* element, and nothing else. A hidden `input` is excluded
 * too — it is unlabelable by definition. This matters because pointing `for` at
 * something that merely *exists* is not the same as pointing it at something it
 * can attach to: a `<div id="email">` is a real element, resolves in full, and
 * still leaves the label wired to nothing, which is the same silence as a
 * dangling id wearing a green light.
 *
 * Note this is deliberately *not* the audit's own `CONTROL_SELECTOR`: a
 * `role="textbox"` on a `<div>` is a control, but `for` does not associate with
 * it — an ARIA widget takes its label through `aria-labelledby`/`aria-label`,
 * not through `for`. So the two sets differ on purpose, and this one is the
 * narrower, spec-exact one.
 */
function isLabelable(element: Element): boolean {
  if (!LABELABLE_TAGS.has(element.tagName)) return false;
  if (element.tagName === "INPUT" && (element.getAttribute("type") ?? "").toLowerCase() === "hidden") {
    return false;
  }
  return true;
}

/**
 * The containers that are asked for a name, because nothing else says what
 * their options are *for*.
 *
 * `radiogroup` is the one with a spec'd meaning — a set of radio buttons, one of
 * which is chosen — and it is the shape the app's theme and accent pickers use;
 * `group` is what its chip rows use and what Radix renders for a menu's radio
 * group; `tablist` is the shape the search and admin pages switch sections with,
 * which are named now for the same reason the chip rows are ("Filter listings",
 * "Post audience"). The first version of this rule knew only about `group`,
 * which left the one form of "choose one of these" that has an actual standard
 * as the one form the audit could not see.
 */
const NAMED_CHOICE_GROUP_SELECTOR = '[role="group"], [role="radiogroup"], [role="tablist"]';

/**
 * Every container that holds a set of options a reader chooses one of.
 *
 * Exactly one role wider than the named set, and that one is deliberate rather
 * than an oversight. A `listbox` here is Radix's `Select` popup, and it is the
 * one container in this app that is *not* supposed to carry a name of its own:
 * the combobox trigger that owns it carries the label (the settings page's is
 * named through `htmlFor="visibility"`), and the popup is that control's face —
 * Radix renders it unnamed, and asking it for a name would report the app for a
 * decision the component library made. The state question has no such exception:
 * a listbox that does not say which option is chosen is unreadable however it is
 * named, and a tablist is unreadable twice over — no name *and* no choice.
 */
const CHOICE_GROUP_SELECTOR = `${NAMED_CHOICE_GROUP_SELECTOR}, [role="listbox"]`;

/**
 * The members a choice is made between.
 *
 * `radio`, `menuitemradio`, `option` and `tab` as well as `button`, because what
 * the rule is about is the options and not the tag they are written with. The
 * app spells its radio groups as `<button role="radio">`, a menu's group as
 * Radix `menuitemradio`s and these two as Radix `option`s and `tab`s — and a
 * rule that counted only `<button>`s would call each of those "a group with no
 * options" and pass it, silently, which is the worst way for a rule to be wrong.
 */
const CHOICE_OPTION_SELECTOR =
  'button, [role="radio"], [role="menuitemradio"], [role="option"], [role="tab"]';

/**
 * State the screen is showing and the announcement is not — and the references a
 * control writes, which is the other way the two come apart.
 *
 * The name audit asks whether a control can be *called* something. This asks the
 * next question: having found it, does it say what it is doing? And having said
 * it, does what it pointed at exist? Both families are the same failure wearing
 * different clothes: something is claimed — a choice, a state, a region, a name —
 * and the reader does not get it. The app has four shapes of that — a row of options where the chosen one is the filled one, a
 * status drawn as a colour, a control that opens a region, and a group of
 * options with no name — and three of the four are checkable from the DOM:
 *
 * - **A group of options must be named.** `role="group"` and
 *   `role="radiogroup"` both put a label on a set of things that are chosen
 *   between; with no name, the reader is told there are four buttons and not what
 *   they are for. (An `aria-label` on a plain `div` is ignored, which is how
 *   those rows were nameless with a label written on them.) This half is asked
 *   of every choice container except the `listbox` — see the note on
 *   `NAMED_CHOICE_GROUP_SELECTOR`.
 * - **A named group of options must say which one is chosen.** Any of
 *   `aria-pressed`, `aria-checked` or `aria-current` on any member is enough:
 *   the first two always emit their value, `aria-current` is only correct on the
 *   chosen one, and both are ways of saying it. What fails is a row where *no*
 *   member carries anything — the filled chip announcing nothing, which is what
 *   four of this app's rows shipped.
 * - **A control that owns a region must report a state for it**, and must not
 *   claim it is expanded when the region is not in the page. This is the
 *   disclosure shape: a hamburger that turns into an × and reports nothing. The
 *   attribute is not dictated — a tab correctly says `aria-selected` — only that
 *   there *is* one.
 * - **And the region it names has to exist.** A control that says which region
 *   it owns, and points at an id nothing renders, is a broken reference whether
 *   or not it is expanded: the panel was renamed, deleted, or the id was a typo,
 *   and what the reader gets is a control that does nothing. Two names, because
 *   the two claims differ — `absent-region` for "I am open" over a missing
 *   region, `dangling-region` for a reference to nothing at all. The one case
 *   that is not a violation is a control that reports itself **collapsed**:
 *   nothing mounts a closed popover's region, so a dangling reference there is
 *   the normal state rather than a defect.
 * - **And the names it points at have to exist too** — the same defect one step
 *   further in, and the one no other rule can see. A broken `aria-labelledby`
 *   does not leave a control nameless: the name computation falls through to
 *   `aria-label`, then to the element's own contents, so the first question is
 *   answered and the reference is what quietly stopped working. Six such
 *   references were sitting on the profile page's panels, each pointing at a
 *   tab that page never rendered.
 * - **And the descriptions, checked twice over, because a hint is lost in two
 *   ways and neither shows on screen.** `aria-describedby` is the same reference
 *   shape as `aria-labelledby`, but a hint has nowhere to fall through to: a
 *   label that does not resolve is at least replaced by the element's own
 *   contents, whereas a description *is* the only place the hint lives. So a
 *   hint pointing at an id nothing renders is simply never read — no control
 *   looks unnamed, nothing on screen looks wrong — and the reference is the only
 *   thing left to check. The other loss is on the near side: a hint hung on a
 *   bare `<div>` is never given either, because `generic` does not support a
 *   description at all, and there the target can exist in full and still reach
 *   nobody.
 * - **And the ids all three of those rules resolve against must be unique.** An
 *   `id` is a promise the document makes once, so two elements sharing one make
 *   every reference above ambiguous at the same time — the parser hands back the
 *   first and the other element is silently unreachable. It is the substrate of
 *   the three reference rules rather than a fourth question, and the failure a
 *   hardcoded id produces the moment a component is mounted twice.
 * - **And a label's `for` has to resolve too**, because it names a *field* the
 *   same way the rules above name regions and descriptions: a `<label for>`
 *   whose id is not in the page is attached to nothing, which is the nameless
 *   field wearing its most plausible disguise — the label text is right there,
 *   just not wired to the control it reads beside. And "resolve" means to a
 *   **labelable** element, not merely to one that exists: `for` attaches only to
 *   the spec's short list, so a `for` aimed at a real `<div>` satisfies every
 *   reference check and is still wired to nothing.
 *
 * The fourth shape is a status drawn only as a colour, and it is deliberately
 * not here: "is this dot conveying state?" is not answerable from the DOM — a
 * decorative bullet and a presence indicator are the same three spans. That one
 * is prevented by construction instead, in `StatusIndicator`, which has no
 * spelling without a label.
 */
export function stateViolations(root: ParentNode): StateViolation[] {
  const found: StateViolation[] = [];

  for (const group of root.querySelectorAll(CHOICE_GROUP_SELECTOR)) {
    if (!isRendered(group)) continue;

    if (group.matches(NAMED_CHOICE_GROUP_SELECTOR) && !accessibleName(group)) {
      found.push(
        stateViolation(
          "unnamed-group",
          group,
          "a group of options has no name, so nothing says what is being chosen between",
        ),
      );
    }

    const options = [...group.querySelectorAll(CHOICE_OPTION_SELECTOR)].filter(isRendered);
    if (options.length === 0) continue;
    const stating = options.filter((option) =>
      OPTION_STATE_ATTRIBUTES.some((attribute) => option.hasAttribute(attribute)),
    );
    if (stating.length === 0) {
      found.push(
        stateViolation(
          "silent-choice",
          group,
          `a group of ${options.length} options says nothing about which one is chosen`,
        ),
      );
    }
  }

  for (const control of root.querySelectorAll("[aria-controls]")) {
    if (!isRendered(control)) continue;

    if (!OWNED_REGION_STATE_ATTRIBUTES.some((attribute) => control.hasAttribute(attribute))) {
      found.push(
        stateViolation(
          "silent-region",
          control,
          "names a region it controls but reports no state for it",
        ),
      );
      continue;
    }

    // A control that reports itself *collapsed* may legitimately have no region
    // in the page — that is what every popover in this app does, and what
    // Radix's menus, selects and tooltips do — so the reference is allowed to
    // dangle exactly when the control says it is closed. The attribute that
    // reports "closed" is the same attribute that explains the absence.
    const expanded = control.getAttribute("aria-expanded");
    if (expanded === "false") continue;

    const id = control.getAttribute("aria-controls") ?? "";
    const region = root.querySelector(`#${CSS.escape(id)}`);

    // Two claims, named apart: one says the region is open when it is not there
    // at all, the other points at an address nothing lives at.
    if (!region) {
      found.push(
        stateViolation(
          expanded === "true" ? "absent-region" : "dangling-region",
          control,
          expanded === "true"
            ? `says it is expanded, but #${id} is not in the page`
            : `names #${id}, which is not in the page`,
        ),
      );
      continue;
    }

    // Existence is enough for the weaker claim — an unselected tab's panel is
    // in the page and `hidden`, which is correct and is not this rule's
    // business. Only "I am expanded" has to be true of something on screen.
    if (expanded === "true" && !isRendered(region)) {
      found.push(
        stateViolation("absent-region", control, `says it is expanded, but #${id} is not in the page`),
      );
    }
  }

  /**
   * And the names it points at, which is the same defect one step further in.
   *
   * This has to be its own rule for the reason it is easy to miss: when an
   * `aria-labelledby` does not resolve, `accessibleName` **falls through** to the
   * next step — `aria-label`, then the element's own contents, then `title` — so
   * a control whose label element was deleted or renamed still announces
   * something. It just does not announce what the author wrote, and nothing in
   * the page looks wrong. The reference is the thing that quietly stopped
   * working, so the reference is what has to be checked.
   *
   * Existence is the whole test, as it is in `accessibleName` itself: a label
   * that is hidden is still a label a reader is given when it is named directly.
   */
  for (const element of root.querySelectorAll("[aria-labelledby]")) {
    if (!isRendered(element)) continue;

    const missing = (element.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((id) => element.ownerDocument.getElementById(id) === null);

    if (missing.length > 0) {
      found.push(
        stateViolation("dangling-label", element, `points at #${missing.join(", #")}, which is not in the page`),
      );
    }
  }

  /**
   * And the descriptions, checked in both of the ways a hint is lost without
   * anything on the page looking wrong.
   *
   * **The target has to exist.** A label that does not resolve *falls through*:
   * the control still announces `aria-label`, or its own contents, or its
   * `title`. A description has nothing to fall through to. `aria-describedby` is
   * the only spelling for a hint, so a reference to an id nothing renders means
   * the hint is not spoken at all — and nothing about the page looks wrong to
   * make up for it. Existence is the whole test for this half, exactly as it is
   * for the label above: a description that is `hidden` is still one a reader is
   * given when it is named directly.
   *
   * **And the thing it is hung on has to be able to carry one.** A hint written
   * on a bare `<div>` is lost the other way: the attribute is there, its target
   * may be too, and *no reader is ever given it*, because `generic` does not
   * support a description. That is the half this rule exists for and the one a
   * reference check cannot see. See `canBeDescribed` for why it stops at
   * "a control or anything with a role" rather than demanding a control.
   */
  for (const element of root.querySelectorAll("[aria-describedby]")) {
    if (!isRendered(element)) continue;

    // Reported before the target question, and on its own: a hint no reader can
    // be given is the root cause, and where it points does not arise.
    if (!canBeDescribed(element)) {
      found.push(
        stateViolation(
          "misplaced-description",
          element,
          "carries a hint, but is not a control and has no role that supports a description, so no reader is ever given it",
        ),
      );
      continue;
    }

    const missing = (element.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((id) => element.ownerDocument.getElementById(id) === null);

    if (missing.length > 0) {
      found.push(
        stateViolation(
          "dangling-description",
          element,
          `describes itself with #${missing.join(", #")}, which is not in the page`,
        ),
      );
    }
  }

  /**
   * And the ids every reference above is written against.
   *
   * A reference is only as good as the id it names, and an `id` is a promise the
   * document makes **once**. Two elements sharing one make every
   * `getElementById` — and so every `aria-labelledby`, `aria-describedby` and
   * `aria-controls` that targets it — ambiguous: the reader is handed whichever
   * the parser returns first, and the other element is silently unreachable.
   * That is why this belongs with the reference rules rather than beside them: a
   * duplicate id is the one way all three of them break *at once*, and from the
   * outside nothing looks wrong. It is also the failure a hardcoded id produces
   * the moment a component is mounted twice, which is exactly why the pickers
   * here generate theirs with `useId` — and why a written one would go unnoticed
   * until two of them shared a screen.
   *
   * Existence is not filtered by `isRendered`, unlike every rule above: a hidden
   * duplicate still answers `getElementById`, so it breaks a reference just as
   * well as a visible one. Reported **once per duplicated id**, and named, so a
   * failure points at the id rather than at a count. An empty `id` is skipped —
   * it is not an id, and two of them make nothing ambiguous.
   */
  const holdersById = new Map<string, Element[]>();
  for (const element of root.querySelectorAll("[id]")) {
    const id = element.getAttribute("id") ?? "";
    if (id === "") continue;

    const holders = holdersById.get(id);
    if (holders) holders.push(element);
    else holdersById.set(id, [element]);
  }

  for (const [id, holders] of holdersById) {
    if (holders.length < 2) continue;
    found.push(
      stateViolation(
        "duplicate-id",
        holders[0],
        `"${id}" is used by ${holders.length} elements, so every reference to it is ambiguous`,
      ),
    );
  }

  /**
   * And the labels' own `for` (React's `htmlFor`), which names a *field* rather
   * than a region.
   *
   * The same reference defect as the three above, one step out, and the one that
   * decides whether a field has a label at all: a `<label for>` attaches to the
   * control whose id it names, and when that id is not in the page the label
   * attaches to nothing — it is the trap `a11y.test.ts` pins as unnamed, a
   * `Label` rendered *beside* a control rather than wired to it. Nothing about
   * the page looks wrong; the words are right there, just not connected.
   *
   * Reported even when the label wraps its control and so still names it, for the
   * same reason `dangling-label` reports a label whose control still announces
   * something: the reference is the thing that quietly stopped working. And a
   * `<label for>` that reaches a `hidden` field is doing its job — existence and
   * labelability are the whole test, not visibility.
   *
   * Two failures, named apart: **`dangling-field`** when the id is not in the page
   * at all, and **`unlabelable-target`** when it is there but is not something a
   * label can attach to. The second is the quiet one — the id resolves, every
   * tool that checks references is satisfied, and the label is still wired to
   * nothing — which is why existence alone was not enough.
   */
  for (const label of root.querySelectorAll("label[for]")) {
    if (!isRendered(label)) continue;

    const id = label.getAttribute("for") ?? "";
    if (id === "") continue;

    const target = label.ownerDocument.getElementById(id);
    if (target === null) {
      found.push(
        stateViolation(
          "dangling-field",
          label,
          `names #${id}, which is not in the page, so the field it labels has no label`,
        ),
      );
      continue;
    }

    if (!isLabelable(target)) {
      found.push(
        stateViolation(
          "unlabelable-target",
          label,
          `names #${id}, which is a <${target.tagName.toLowerCase()}>, and a label cannot attach to it`,
        ),
      );
    }
  }

  return found;
}

/** A failure message that says which rule broke, not only how often. */
export function describeStateViolations(violations: StateViolation[]): string {
  if (violations.length === 0) return "every control states its state";
  return [
    `${violations.length} control(s) whose state is drawn but not said:`,
    ...violations.map((violation) => `  - [${violation.rule}] ${violation.why}\n      ${violation.html}`),
  ].join("\n");
}

const HEADING_SELECTOR = ["h1", "h2", "h3", "h4", "h5", "h6", '[role="heading"]'].join(", ");

/**
 * The level a heading claims, or `null` for one that claims none.
 *
 * `h1`–`h6` say their level in the tag itself; an ARIA heading says it in
 * `aria-level`, and one without the attribute is left out rather than guessed at,
 * because the outline below is about the levels the page states.
 */
function headingLevel(element: Element): number | null {
  const fromTag = /^h([1-6])$/.exec(element.tagName.toLowerCase());
  if (fromTag) return Number(fromTag[1]);

  if (element.getAttribute("role") === "heading") {
    const level = Number(element.getAttribute("aria-level"));
    return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
  }

  return null;
}

export interface HeadingViolation {
  /** The invariant, named so a failure says what kind of thing is wrong. */
  rule: string;
  /** What the outline does not say. */
  why: string;
  html: string;
}

function headingViolation(rule: string, element: Element | null, why: string): HeadingViolation {
  return { rule, why, html: (element?.outerHTML ?? "").replace(/\s+/g, " ").slice(0, 200) };
}

/**
 * Whether a page's headings form the outline a reader can move by.
 *
 * Two claims, both about the page rather than any one heading:
 *
 * - **Exactly one `h1`.** A page has one subject, and a reader stepping through
 *   its headings should land on that subject once. None means the subject is
 *   not in the outline at all; more than one means the page claims several —
 *   which is what a wrapper's heading and the content's own heading do when they
 *   are drawn on top of each other, and neither reader nor crawler can tell
 *   which one the page is about.
 * - **No level skipped on the way down.** `h1` then `h3` leaves `h2` unannounced
 *   and a reader descending finds a level that was never there. Rising is not a
 *   skip — an `h2` after an `h3` is a new section — so only a descent of more
 *   than one level at a time is reported.
 *
 * Hidden headings are left out: what a reader cannot reach cannot mislead them.
 * This is a whole-page rule, so it belongs to surfaces that are pages — a nav or
 * a composer has no `h1` and is not making a claim about one.
 */
export function headingViolations(root: ParentNode): HeadingViolation[] {
  const found: HeadingViolation[] = [];
  const headings: { element: Element; level: number }[] = [];

  for (const element of root.querySelectorAll(HEADING_SELECTOR)) {
    if (!isRendered(element)) continue;
    const level = headingLevel(element);
    if (level !== null) headings.push({ element, level });
  }

  const topLevel = headings.filter((heading) => heading.level === 1);
  if (topLevel.length === 0) {
    found.push(
      headingViolation(
        "no-h1",
        headings[0]?.element ?? null,
        "the page has no level-1 heading to name its own subject",
      ),
    );
  } else {
    for (const heading of topLevel.slice(1)) {
      found.push(
        headingViolation(
          "many-h1",
          heading.element,
          "a second level-1 heading, so the page names more than one subject",
        ),
      );
    }
  }

  let previous: number | null = null;
  for (const heading of headings) {
    if (previous !== null && heading.level > previous + 1) {
      found.push(
        headingViolation(
          "skipped-level",
          heading.element,
          `jumps from h${previous} to h${heading.level}, so h${previous + 1} is never announced`,
        ),
      );
    }
    previous = heading.level;
  }

  return found;
}

/** A failure message that says which rule broke, not only how often. */
export function describeHeadingViolations(violations: HeadingViolation[]): string {
  if (violations.length === 0) return "the headings form one outline";
  return [
    `${violations.length} heading violation(s):`,
    ...violations.map((violation) => `  - [${violation.rule}] ${violation.why}\n      ${violation.html}`),
  ].join("\n");
}
