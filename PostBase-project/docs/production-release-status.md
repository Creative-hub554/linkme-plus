# Production release status — 2026-10-27

## Released

Browser walkthrough follow-up: version `56968403-1143-4ad9-be0b-eafecc61314d`
adds a direct sign-in link when a signed-out visitor clicks Apply on a job.
Four JobCard tests, ESLint, build, and deployment passed. The live browser
confirmed the new link points to `/login`. Jobs, marketplace filters, listing
details, and sign-in/recovery controls loaded in the browser. No messages or
signed-in applications were submitted. Authenticated posting and messaging
still require a signed-in walkthrough.

Follow-up release: `7adc82ce-a016-4aff-b222-adc354e45e0f` on 2026-10-27 adds
separate KHR/USD merchant settings without a schema change. Its 40 targeted
tests, TypeScript, lint, and production build passed. The owner-designated
`theowumicrosoft@gmail.com` auth account now has a public profile and admin
role, with an audit record. The owner deferred ad prices, booking limits,
and merchant QR configuration to focus on building and running the site.
No paid placements or merchant settings were invented or created.

The owner explicitly requested deployment after reporting the password change.
Production was deployed successfully on 2026-10-27 to `linkmeplus.com` and
`www.linkmeplus.com`.

- Worker version: `383e8213-7b96-44c9-890c-4ca49192d13e`.
- Applied Supabase migration:
  `linkmeplus_theme_and_remaining_workflows_20261027`.
- Verified four new RLS tables, theme column, five unique indexes, and two
  policies. All five existing creator tables remain present. No creator data
  was dropped. The deployment uses the application directory the owner identified;
  no separate creator implementation was found or added.
- Preserved existing Worker variables, secrets, and resource bindings using
  Wrangler `--keep-vars`; no secret values were read or replaced in this release.
- First asset upload failed with Cloudflare code 10013; the retry succeeded.
- Live checks passed: both domains, jobs, marketplace, forgot/reset password,
  signed-out redirects for advertising/job management/inventory, signed-out
  rejection for the advertising API and admin POST endpoint, and database-backed
  ad serving for all three placements. Unsupported admin GET/PUT methods return
  405 as expected; POST returns 401 when signed out.
- Build and packaging passed. The prior full test run passed 2,662 tests with
  one skipped. Authenticated payment submission/approval and real bank credit
  were not exercised against production.

Remaining setup: an administrator must configure merchant KHQR and placements
on `/advertising`, then verify the first real payment in the bank before approval.
Do not treat a payment screenshot or reference alone as proof of bank credit.
Preview credential propagation was verified on 2026-10-27 after the release:
`GET /api/jobs` returned seeded rows on both preview hosts, so both preview
secret sets and the live Worker accept the rotated password (see the ledger in
`credential-rotation.md`).

The following sections retain the pre-release findings for reference.

## Release prerequisites

1. Complete the database password rotation in `credential-rotation.md`.
   The owner subsequently reported changing the password on 2026-10-27. A
   fresh local `SELECT 1` succeeded using `.env.local`; production `/`, `/jobs`,
   and `/marketplace` returned HTTP 200 without a server-error page. The
   propagation follow-up landed the same day: `GET /api/jobs` returned seeded
   rows on both preview hosts and both production domains, so each consumer
   accepts the rotated password. Rejection of the old password is implied by
   the provider's reset, not tested directly. Never paste the password into
   chat.
2. Reconcile production creator functionality before replacing Worker code.
   Production's Supabase migration history includes creator boost, creator
   hub, collaboration/index, and scheduled drafts through migration 0024.
   Local source lacks those features. An isolated read of remote HEAD
   `9ed0a72c0bf62ba3aba5c3628c0904be23e00fbf` also found no creator feature
   filenames or creator schema declarations. Public route checks returned 404
   for `/creator`, `/creator-hub`, and `/creator-boost`; these paths do not
   establish whether other authenticated creator routes exist. Database
   migration history alone does not prove those features are deployed. The same
   three paths were re-probed after the 2026-10-27 release on `linkmeplus.com`,
   `www.linkmeplus.com` and both preview hosts and answered 404 everywhere, so
   the deployed Worker serves no creator page at those paths; orphaned
   migration history remains the simplest explanation. Authenticated-only
   creator routes still cannot be ruled out by URL probing.
3. Apply only compatible additive migrations after preflight. Production uses
   a different migration history: do not replay the local Drizzle journal.
   Local `0014_peaceful_franklin_richards.sql` and
   `0015_remaining_workflows.sql` require distinct production migration names
   and inspection against current columns, policies, and indexes.

## Confirmed production target

The Codex projects labelled `Websitebuildertoolsai` and `LinkMePlus` both point
to `C:\Workspace\Websitebuildertoolsai`; the labels are not separate checkouts.
Remote branch inspection found `master`, `ci/remove-inert-deploy-jobs`,
`coverage/schema-and-social-dialogs`, and `feat/legacy-auth-forwarders`.
The observed live Worker version was uploaded through Wrangler and has no
source-commit annotation. Its metadata therefore cannot identify a release
checkout. The owner identified `C:\Workspace\Websitebuildertoolsai` or its
`PostBase-project` child as the deployment location on 2026-10-27. These are
the same repository and its application directory, not competing projects.
The application package, Worker entry, and Wrangler deployment configuration
are in `PostBase-project`; use that directory for application commands.
This establishes the intended local source location, but does not establish
which uncommitted source files were present at the October 23 deployment.

- Supabase: `yimclwfiyxngszejoikz` (`wwww.linkmeplus.com`).
- Cloudflare Worker: `linkme-plus`, top-level `wrangler.jsonc` configuration.
  No named production environment is configured; do not pass `--env production`.
- Observed live version: `78d479e1-356e-4bc9-89bb-b151b1ed7a17`
  (100% deployment, 2026-10-23). Retain for code rollback; code rollback does
  not undo schema changes or restore an invalidated database password.
- Both custom domains answered HTTP 200 during inspection.
- Existing duplicate groups were zero for company/page, job application/user,
  inventory/listing, and ad metrics/campaign/date uniqueness targets.

## Local verification

Build, TypeScript, and ESLint passed. Targeted API/schema/auth/inventory/UI
tests passed (107 tests); UI and convention guards passed (255 tests);
preview preflight passed (27 tests). A subsequent complete default Vitest run
passed on 2026-10-27: 199 files, 2,662 tests passed, one skipped (241.45 seconds).
The separately configured coverage mutation suite is excluded from that default
run. Full output: `.tmp/release-full-suite.log`. The generated production
Wrangler configuration also passed `deploy --dry-run`; nothing was uploaded.

Manual KHQR confirmation is now deployed. Production still needs the
merchant QR/settings configured and a real admin-reviewed payment exercise
after the release prerequisites are resolved.
