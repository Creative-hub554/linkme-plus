# LinkMe+ Design Direction

This document records the visual and interaction direction represented by the supplied LinkMe+ concept image. It is a design reference, not a statement of implemented functionality or a replacement for the product requirements.

## Product character

LinkMe+ should feel optimistic, capable, and familiar: a social platform that also supports marketplace activity, jobs, communities, creator tools, and platform administration. The experience should make a broad feature set feel organised rather than dense.

The reference establishes three visual traits:

- **Trustworthy and professional:** deep navy text and navigation, structured cards, predictable controls.
- **Friendly and social:** rounded surfaces, profile imagery, story-like media, bright accent colours.
- **Modern and productive:** clean white workspace, light-blue borders, compact dashboards, and strong primary actions.

## Brand and visual language

Use the LinkMe+ icon plus a bold wordmark in navy. The dominant primary colour is a saturated blue; violet/purple is a supporting brand accent visible in the mark and selected highlights. Use bright contextual accents sparingly: red for video/attention states, green for successful/active states, and warm yellow/orange for reactions or status.

| Token | Intended use |
| --- | --- |
| Navy | Wordmark, primary navigation, headings, high-emphasis text, dark footer. |
| Primary blue | Primary buttons, selected tabs, links, active navigation, focus treatment. |
| Purple accent | Brand moments, AI/tool cues, decorative gradient support. |
| White surface | Page and card backgrounds. |
| Cool light blue | Page canvas, subtle borders, dividers, inactive controls. |
| Neutral gray | Supporting text, metadata, disabled states. |

Prefer clean, high-legibility sans-serif typography. Headings are compact and strong; body text is small but readable with generous contrast. Avoid relying on colour alone for selected, warning, or status states.

## Layout system

The desktop product uses a wide, card-based canvas with consistent gutters and small-to-medium rounded corners. At larger widths, use a persistent top navigation and module-specific columns. Cards use a white background, fine cool-blue border, restrained shadow, and internal spacing that groups related controls.

### Primary navigation

The reference has two levels of navigation:

1. A global header with the brand, high-level product promise, and shortcut icons for major modules such as Social, Marketplace, Jobs, Business, AI Tools, Groups, Video, and More.
2. A contextual application bar with search, notifications, account controls, and module navigation.

On small screens, prioritise the current task, search, notifications, and a compact bottom navigation. Do not simply scale down the desktop’s complete navigation set.

### Responsive behavior

| Breakpoint intent | Layout behavior |
| --- | --- |
| Mobile | Single primary column; sticky compact top bar and bottom module navigation; cards become edge-aware rather than tiny. |
| Tablet | Two-column layouts where content benefits; secondary panels may move below the main feed. |
| Desktop | Multi-column social/feed layout, dashboard grids, and side-by-side editor panels. |

Maintain touch targets of at least 44 by 44 CSS pixels, usable keyboard focus, and no interaction that depends on hover alone.

## Component patterns

### Cards

Cards are the core organisational unit for feed posts, listings, jobs, groups, admin data, and tool panels. Use a compact header, a clear content region, and a footer/actions area. Keep metadata muted and action buttons visually secondary until a commitment action is required.

### Buttons and controls

Use solid blue for the primary action (for example, Save, Apply, Post a Job, or Review). Use outlined or quiet buttons for preview, cancellation, secondary filters, and non-destructive actions. Status chips and compact filter pills should be readable, keyboard-operable, and not overused.

### Data-dense surfaces

Administrative and management screens use summary metric cards, searchable/filterable tables, compact status labels, and a single obvious row action. Tables must collapse or become labelled cards on narrow screens; horizontal scrolling is an acceptable fallback for truly tabular data when headers remain associated with values.

### Media

Feed, story, cover, marketplace, and group media is colourful and prominent. Always reserve space while media loads, provide meaningful alt text, support media status/processing states, and keep critical actions distinct from imagery. User-generated assets must never be used as the sole source of essential information.

## Module guidance

| Module | Primary composition | Key actions |
| --- | --- | --- |
| Social and profile | Feed centre, navigation rail, discovery/sidebar; profile cover and identity panel. | Post, react, comment, share, follow. |
| Marketplace | Product grid with search, category/filter chips, and seller contact paths. | View, save, message seller, manage listing. |
| Jobs | Search and job-result list paired with concise role details. | Apply, save, post job. |
| AI tools | Clear tool list/cards with short purpose statements and explicit draft/review flow. | Start draft, review, save/publish. |
| Cover studio | Large live preview above a templated editing rail or tabs. | Select template, edit, preview, save. |
| Groups and events | Hero media followed by membership/event cards and activity. | Join, invite, RSVP, publish. |
| Administration | Sidebar navigation, dashboard metrics, operational tables, review queues. | Review, approve/reject, save settings. |

## Interaction and safety

Use immediate, clear feedback for saves, reactions, inventory updates, review decisions, and campaign-status changes. Destructive actions require confirmation and explain their effect. Paid or amplified content must be labelled **Sponsored** or **Advertisement** consistently in every layout.

AI features should be visually distinct but not overpowering. They must describe what will be generated, preserve user review before saving or publishing, and never imply automated final decisions for moderation, employment, payments, or account enforcement.

## Accessibility baseline

- Meet WCAG 2.2 AA contrast requirements, including text over media.
- Provide semantic landmarks, labelled controls, logical heading order, and full keyboard operation.
- Use visible focus indicators that match the blue brand language.
- Provide alt-text authoring support and captions/transcripts where media requires them.
- Respect reduced-motion preferences; do not make status or meaning depend on animation.
- Test feed, marketplace, job application, campaign, and administration flows with screen readers and keyboard-only navigation.

## Design delivery checklist

- [ ] A page has a clear primary task and one visually dominant primary action.
- [ ] Mobile, tablet, and desktop layouts have been designed deliberately.
- [ ] Loading, empty, error, success, permission, and moderation states are included.
- [ ] Components use the shared tokens and patterns rather than one-off styling.
- [ ] User-generated content, paid content, and AI output have clear labels and safe controls.
- [ ] Accessibility requirements are reviewed before engineering handoff.
