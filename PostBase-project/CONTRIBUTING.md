# Contributing to LinkMe+

Thanks for contributing. LinkMe+ handles public content, private account data, marketplace activity, jobs, and paid promotion, so changes must be safe, accessible, and auditable.

## Before you start

1. Read the [product requirements](docs/postbase-product-requirements.md), [roadmap](ROADMAP.md), and [architecture](ARCHITECTURE.md).
2. Choose work from [TODO.md](TODO.md), or open an issue/proposal for work that changes scope or policy.
3. Keep each change focused. Do not mix refactors, feature work, and unrelated formatting.

## Development workflow

1. Create a branch using the `codex/` prefix, for example `codex/profile-privacy-controls`.
2. Make the smallest change that completes the user journey.
3. Add or update automated tests, including authorization and negative-path tests.
4. Run the project formatter, linter, type checks, tests, and relevant build before requesting review.
5. Update documentation, migrations, configuration examples, and release notes when applicable.
6. Submit a pull request with a clear summary, verification steps, screenshots for UI changes, and any migration or rollout notes.

## Engineering expectations

- Validate all untrusted input on the server and enforce authorization server-side.
- Protect privacy: collect only required data, respect visibility and blocks, and never log credentials or sensitive content.
- Treat uploads, URLs, payments, inventory, campaign state, and moderation actions as high-risk paths; test failure cases and preserve auditability.
- Preserve accessibility: keyboard operation, semantic structure, visible focus, adequate contrast, meaningful labels, and alt text support.
- Make responsive behavior intentional across mobile, tablet, and desktop.
- Avoid unbounded queries; paginate or use cursor-based loading for feeds and search.
- Do not add AI behavior outside its approved scope or permit it to make final user-impacting decisions.

## Pull-request checklist

- [ ] Scope matches an approved requirement or issue.
- [ ] Tests cover expected behavior, validation, and authorization.
- [ ] No secrets, personal data, or production credentials are committed.
- [ ] Accessibility and responsive behavior were checked.
- [ ] Policy-sensitive changes include review/rollout notes.
- [ ] Database migrations are reversible or have a documented recovery plan.
- [ ] Documentation and TODO status are current.

## Reporting vulnerabilities

Do not open a public issue for a suspected security or privacy vulnerability. Report it privately to the maintainers with affected area, reproduction details, potential impact, and any suggested mitigation.
