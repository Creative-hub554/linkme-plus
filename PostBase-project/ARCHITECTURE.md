# LinkMe+ Architecture

## Overview

LinkMe+ is a responsive web platform with public discovery and authenticated social, marketplace, jobs, messaging, advertising, and administration experiences. Start with a modular monolith and clear module boundaries; extract services only when operational evidence justifies it.

```text
Browser / responsive web client
            |
        HTTPS API
            |
Application modules ── Background workers
            |                 |
 Relational database     Queue / scheduler
            |
 Object storage + CDN ── Search index
            |
External providers: email, payment, media processing, observability
```

## Application modules

| Module | Responsibilities |
| --- | --- |
| Identity and access | Authentication, sessions, profiles, roles, privacy, blocking, authorization. |
| Social | Posts, media references, feed, comments, reactions, follows, saves, notifications. |
| Communities | Pages, groups, memberships, roles, rules, moderation authority. |
| Marketplace | Listings, storefronts, variants, inventory, stock movements, buyer/seller contact. |
| Jobs | Companies, job listings, applications, applicant state. |
| Advertising | Inventory, creatives, bookings, campaigns, delivery eligibility, metrics. |
| Trust and safety | Reports, moderation queues/actions, rate limits, audit logs, appeals. |
| Discovery | Search indexing, filters, public discovery, recommendation interfaces. |
| Administration | Moderation, categories, policy decisions, campaign review, controlled operations. |

## Data and storage

Use a relational database as the source of truth for the entities named in the product requirements. Enforce tenant-like ownership and role checks in the application and database constraints where practical. Use object storage for uploads; store metadata and references in the database, never user media blobs. Deliver approved media through a CDN.

Use an asynchronous queue for notifications, media processing, search indexing, campaign scheduling, metric aggregation, and low-stock alerts. Workers must be idempotent, retry safely, and record failures for operators.

Search is a derived index, not the source of truth. It must respect visibility, blocks, removals, and category/location filters before returning results.

## Request and authorization model

Every request is authenticated where required, validated at the boundary, and authorized server-side against ownership, role, content visibility, group/page membership, and moderation status. Clients never decide whether an action is permitted.

Public reads must enforce visibility rules. State-changing requests need anti-abuse controls, audit fields, and idempotency where they touch payments, inventory, bookings, or campaign changes.

## Advertising delivery

Campaign delivery is eligibility-driven: campaign status, payment, review, date range, placement, inventory reservation, item availability, policy state, targeting, frequency cap, and user controls must all pass before an impression is eligible. Paid delivery is always labelled Sponsored or Advertisement. Metrics are aggregated so advertisers do not receive identifiable viewer data.

Material creative edits, removal of the destination content, serious reports, failed payment, or depleted/invalid inventory pause delivery immediately.

## Security, privacy, and operations

- Hash passwords using a modern adaptive algorithm; encrypt secrets and use managed secret storage.
- Validate uploads, scan media, constrain formats/sizes, and validate destination URLs before advertising submission.
- Record consent for personalized recommendations and advertising; provide opt-out controls.
- Keep structured audit logs for administrator, payment/refund, campaign, and material moderation actions.
- Apply rate limits to authentication, posting, messaging, listings, jobs, and advertising submissions.
- Monitor availability, background-job failures, latency, abuse signals, and security events; maintain backups and a restore runbook.

## AI boundary

AI is optional and may assist only in Social/Feed, Marketplace, and Jobs. It may produce suggestions or drafts, never publish or decide on a user's behalf. It must not access private messages, account settings, payment flows, advertising approval, moderation decisions, or private group/page management.

## Evolution rules

Prefer versioned APIs, database migrations, feature flags, and append-only audit events. Introduce separate services only when a module needs independent scaling, release cadence, data isolation, or reliability boundaries.
