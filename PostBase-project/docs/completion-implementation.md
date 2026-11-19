# Completion implementation — work in progress

This document tracks the owner-approved completion plan. It is not a launch
certificate. Production has not been migrated or redeployed for this work.

## Implemented in the working tree

- Ten stable English/Khmer post categories, required by personal, page, group,
  and edit forms and enforced by publishing APIs. Legacy content remains nullable.
- Account feed preferences stored through an atomic merge, preserving appearance
  settings. Home-feed reads, realtime hydration, and pagination apply the selected
  topics/formats after the existing privacy checks. Cursors bind to preferences.
- Seller entitlement model: Free 50 stored/30 public, Pro 200/200, Plus 500/500,
  Ultra without a commercial count cap. Account locks protect product creation
  and new publication. Downgrade reads retain the oldest permitted public products.
- Private evidence upload/read APIs, image processing, member/admin authorization,
  session-bound short-lived signatures, and no public-bucket fallback.
- National ID submission and manual admin review, revocation, audit records, and
  evidence retention scheduled 30 days after decisions. Existing verification
  records are preserved and are not assumed to establish National ID verification.
- Job publication review separated from open/closed state; office evidence is
  required even for verified publishers. Flagged/unverified submissions await admin
  review. Material edits preserve the previous approved version while queued.
- Lifetime job publication ledger retaining usage when a job is deleted; 10 free
  approvals followed by 30 paid approvals per anchored billing month. Existing
  publications do not consume a new credit on reopen. All approval paths share
  the same locked quota service.
- Admin job/identity review panels and owner-facing evidence/usage screens.

## Migrations and deployment prerequisites

`0016_completion_foundations.sql` and `0017_job_review_private_evidence.sql`
are generated/snapshotted migrations. The latter explicitly preserves the existing
production verification enum/table and adds private verification fields.
Do not replay historical local migrations against production.

Before deploying:

1. Finish the full suite, browser/accessibility checks, and build on the final tree.
2. Test migrations and concurrent quotas on an isolated PostgreSQL environment.
3. Provision and verify a separate private R2 bucket: no public developer URL,
   custom domain, or public object access. Configure `R2_PRIVATE_BUCKET_NAME` and
   access credentials authorized for that bucket. It must not be the media bucket.
4. Confirm `AUTH_SECRET` is at least 32 characters and present at runtime.
5. Review legacy jobs: they acquire pending review status; no publisher identity
   is invented. They must not be silently auto-approved or charged retrospectively.
6. Verify the hourly retention trigger and failure alerts before accepting IDs.

Uploads fail closed while private storage/signing is unavailable. Never ask users
to paste identity documents, bot credentials, passwords, or private storage URLs
into chat or public posts.

## Remaining completion work

- Product tags and public product cards on posts/Shorts; live eligibility updates.
- Verified 180-second vertical Shorts processing/playback and background-media jobs.
- Plan catalog, owner-defined KHR/USD prices, paid subscriptions, manual KHQR
  order review, renewal history, idempotent receipts, and refund recording.
- Seller publication selection UI and complete variant/stock management.
- Creator drafts/scheduling, collaboration, communities, and support workflows.
- Promotion extensions to member posts, Shorts, and profiles, respecting feed filters.
- Full Khmer/English localization, email delivery verification, export/deletion,
  CV-private storage, rate limits, appeals, isolated staging, monitoring, restore/
  rollback drills, load tests, and authenticated user acceptance walkthroughs.

No paid AI, Telegram/Facebook login, native apps, escrow/delivery, or creator
payouts are included. No claim that the complete platform is ready should be made
until the remaining work and owner launch inputs are verified.
