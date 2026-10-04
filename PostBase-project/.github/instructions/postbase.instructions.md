---
description: "Use when editing PostBase/LinkMe+ app code, routes, database models, worker logic, or tests. Covers Next.js, TypeScript, Drizzle, auth rules, accessibility, and release safety conventions."
name: "PostBase project guidance"
applyTo: ["src/**", "drizzle/**", "worker/**", ".freebuff/**"]
---

# PostBase / LinkMe+ coding guidance

## Default operating principles

- Keep each change focused and scoped to the user story or bug. Do not mix unrelated refactors, formatting churn, and feature work in the same patch.
- Favor the smallest change that satisfies the requirement and keeps the codebase easy to reason about.
- Prefer explicit, typed TypeScript over implicit `any`, loose casts, or ad-hoc data guessing.
- Preserve existing project boundaries: app routes live under `src/app`, reusable UI under `src/components`, shared logic under `src/lib`, and server-side data access under the existing patterns already used by the repo.
- Keep user-facing behavior accessible, responsive, and keyboard friendly. Use semantic HTML and visible focus states before introducing custom styling.

## Frontend and app structure

- When adding a page or route, follow the existing Next.js app-router patterns under `src/app`.
- Keep client-only behavior explicit with `"use client"` only when required by browser APIs or interactive state.
- Prefer composeable UI patterns and reusable components instead of duplicating markup across routes.
- Use Tailwind utility classes and existing UI primitives where possible; avoid one-off CSS unless there is a clear, project-specific reason.
- Preserve responsive behavior across mobile, tablet, and desktop layouts.

## Backend, validation, and authorization

- Treat all untrusted input as hostile. Validate and sanitize it at the boundary.
- Enforce authorization server-side; do not allow the client to decide whether an action is permitted.
- Respect visibility, ownership, moderation, and privacy rules in DB queries and API handlers.
- For social, marketplace, jobs, and admin flows, prefer explicit checks for access control and edge-case failures.
- Avoid unsafe queries, broad reads, or unbounded result sets. Paginate or use cursor-based patterns for feeds and search.
- Do not log credentials, sensitive content, or private account data.

## Database and worker changes

- Use the existing Drizzle schema and migration structure. Prefer schema-first changes and reversible migrations or clearly documented rollback plans.
- Keep worker and background job behavior idempotent, retry-safe, and observable.
- Treat payments, inventory, campaigns, moderation actions, uploads, and other high-risk flows as sensitive paths; add validation and negative-path testing.
- Store uploads and media metadata intentionally; keep database records as the source of truth and do not bypass the established storage patterns.

## Testing expectations

- Add or update tests for the behavior you change, especially for validation, authorization, and failure modes.
- Prefer targeted Vitest tests that exercise the real behavior rather than only asserting implementation details.
- Cover both the happy path and the negative path when security or user permissions are involved.

## Safe AI / policy boundaries

- AI assistance is optional and must stay within the approved product scope.
- Do not let AI auto-publish content, make final moderation decisions, or act on private messages, payment flows, admin privileges, or other sensitive paths without explicit human approval.
- Keep AI features limited to approved areas such as assistive draft generation and discovery support, never as an autonomous final decision-maker.

## Delivery checklist before finishing work

- Run the relevant lint, typecheck, and tests for the code you changed.
- Confirm the change matches the product requirement and does not widen scope.
- Review secrets, credentials, and personal data exposure before committing.
- Update docs, TODOs, or migration notes when the change materially alters behavior or rollout requirements.
