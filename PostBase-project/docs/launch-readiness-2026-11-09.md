# LinkMe+ launch readiness — 9 November 2026 (Asia/Phnom_Penh)

Status: **not cleared for a public launch**. This is an evidence ledger and an
operational handover, not a production deployment record.

## Checks and local repairs

- TypeScript, ESLint, and the production build passed on the repaired tree.
- Seven targeted suites passed: 251 tests covering job APIs, admin job review,
  publication allowances, registration, commerce flows, rendered accessibility,
  and test teardown conventions. These use mocks and do not establish real email
  delivery, production database authorization, or bank settlement.
- Fixed a real workflow mismatch: new jobs previously bypassed the review UI and
  were inserted as active. They now require private office evidence and enter
  the administrator queue as drafts with the publishing account recorded.
- Changes to approved jobs are queued as revisions while the approved content
  remains intact. Unapproved jobs cannot be exposed by setting active or closed.
  Revisions to unapproved jobs return to the review queue.
- New jobs use manual administrator review, including identity-verified accounts.
  The form now states this accurately. Automatic approval is not enabled.
- Added negative-path tests for missing evidence and publication-status bypasses.
- Corrected stale test navigation, registration teardown, and the accessibility
  harness for the private upload component. Added the missing AUTH_SECRET name
  and minimum length to the environment template; no secret was generated/read.
- Preserved pre-existing layout/auth-shell/site-frame changes in the checkout.

## Live read-only checks

Run from the application directory:

```powershell
node scripts/launch-smoke.mjs https://linkmeplus.com
```

On this date, six HTML pages passed: home, login, jobs, marketplace, privacy,
and terms. Signed-out `/api/admin/reports` and `/api/messages` correctly returned
401. `/api/admin/overview`, `/api/admin/jobs`, and `/api/verification` returned
404 although their routes exist locally. These 404s indicate a release mismatch
to reconcile; they are not evidence of an authorization bypass. Overall: 8 of
11 checks passed. HTTP availability does not prove client hydration or workflows.

The browser sign-in page also still showed Facebook, whereas the October release
record says it was removed. The current live release must be identified before
deploying. The browser had no existing signed-in session; the owner supplied an
account email, and sign-in is awaiting the owner's direct interaction.

## Required release gates

| Gate | Evidence required before launch | Current state |
| --- | --- | --- |
| Final automated checks | Full suite green on the final source | Targeted checks green; full run interrupted after it stopped progressing |
| Production source parity | Identify current Worker version and compare with intended build | Local/live route and login differences observed |
| Database rollout | Inspect current schema; test additive migrations and quotas in isolated PostgreSQL | Not verified; do not replay local historical migrations |
| Private evidence | Separate private bucket; public access off; scoped storage credentials; signing secret >=32 characters | Not verified remotely |
| Retention | Hourly purge runs successfully; failures reach an operator | Cron exists in source; live execution/alert not verified |
| Authentication | Owner login; second test account; email confirmation; recovery; logout; session refresh | Waiting for signed-in walkthrough and inbox evidence |
| Privacy/permissions | Two accounts cannot read/edit each other's private data; blocks and reports work | Unit tests exist; live acceptance not verified |
| Backups | Confirm scheduled backups and media recovery; restore a backup into isolated storage/database and record result | No restore evidence collected |
| Monitoring | External uptime check, server errors, alert recipient, tested alert delivery | Worker observability configured; end-to-end alerts not verified |
| Support | Verify support inbox receives mail; name moderation/support owner and escalation route | UI advertises support@linkmeplus.com; delivery not verified |
| Policies | Review policy promises against actual deletion/export/evidence handling | Pages exist; operational promises need verification |
| Paid ads | Owner prices, KHQR configuration, payment review, bank-credit verification | Required only before enabling paid placements |

## Acceptance walkthrough after sign-in

Use two designated test accounts and clearly marked disposable content. Do not
use real identity documents or customer CVs to exercise uploads.

1. Verify Google/email sign-in, confirmation delivery to a test inbox, refresh,
   sign-out, and password recovery (owner enters any new password directly).
2. Publish a test text/image post, interact from the second account, verify
   notifications, then exercise visibility and blocking from both accounts.
3. Create a listing, contact the seller, and verify the conversation is private.
4. Submit a test job with synthetic office imagery, verify it remains absent
   publicly, review it as administrator, then verify approval and revision rules.
5. Submit a report and verify the admin decision and audit record. Do not change
   real members' moderation status during testing.
6. Check keyboard navigation and mobile layouts in a real browser. Automated
   accessibility tests do not establish full WCAG conformance.

## Operations before opening registration widely

- Assign one operator to uptime/error alerts and one owner for moderation/support.
- Point an existing monitoring service at the public domain; test an alert using
  its test function or a staging failure, rather than taking production down.
- Record backup schedule, retention, last successful restore, and recovery time.
  Restore into isolated resources; never overwrite production for a drill.
- Record the current Worker version before deployment. A code rollback does not
  undo migrations; record database recovery separately and preserve user uploads.
- Confirm support mail reception with a designated test sender and recipient.
- Keep paid services disabled until owner-defined prices and settlement checks
  are complete. A screenshot is not evidence that money reached the bank.
- After all release gates pass, run a small invited pilot, resolve blocking
  issues, and obtain the owner's public-launch decision.

No production migration, deployment, payment, email send, or moderation action
was performed during these checks.

## Authenticated follow-up after owner sign-in

The owner signed in directly in the browser. The account menu confirmed the
designated email and Theo Wu / @theowu profile. The session persisted through
navigation between Profile, Settings, Jobs, Marketplace, and Feed. This proves
an existing-account login/session walkthrough, not new-signup mail delivery,
password recovery, cross-account privacy, or the precise sign-in provider used.

Observed live behavior:

- Profile and Settings loaded. Settings showed public-link verification and
  authenticator setup; no deletion/export controls were visible. No settings,
  credentials, or authenticator enrollment were changed.
- `/admin` failed to load on initial navigation and one reload. The UI alone
  does not establish whether the account currently has an administrator role.
- Jobs loaded two listings. Clicking Post a Job produced no navigation or form.
  Direct navigation to the source-defined `/jobs/new` rendered an explicit 404.
- Marketplace loaded two listings. Sell Item produced no navigation or form.
  `/marketplace/new` rendered an explicit 404. Selecting Electronics changed
  the filter and rendered its empty state, so at least this control hydrated.
- Feed rendered “Feed unavailable / We couldn't load the social feed right
  now.” One retry reproduced the failure. No posts, applications, listings,
  verification requests, reports, or messages were submitted.

### Confirmed live release identity

Using the existing Wrangler configuration and the owner's authenticated CLI,
read the deployment history and version metadata (no secret values). The latest
listed deployment was `f17ef9bf-7cc4-402c-80f7-56f1ff90d353`, created
2026-11-04T13:31:31Z, sending 100% to Worker version
`8afc50b9-ebe5-4dcb-b881-53ba578e8346`. Its annotation identifies
`LinkMePlus e5e3109 with verified standalone login wordmark`.

Commit `e5e3109b01639a9bed613920b8e7aa1569942f8d` exists locally on the
`feat/legacy-auth-forwarders` worktree. It differs from this checkout's master
across 260 files under app/lib alone, including media and creator/security work.
The October release ledger is historical and cannot identify the current live
source. Reconcile from this confirmed release before deploying the current tree;
deploying master wholesale could remove other live functionality.

Live binding names include the public uploads bucket and Auth/database/R2 secret
names, but no private-evidence bucket name, CACHE binding, or WEBSOCKET_ROOM
binding. Names alone do not establish secret values or runtime reachability.

### Feed error investigation

Follow-up: replaying the logged media query through the checkout's configured
Postgres pooler returned SQLSTATE `42703`. That connection targets
`selorshhkdpydjtypgfq`, while the public Auth URL targets `yimclwfiyxngszejoikz`.
All 20 post IDs from the live error matched rows in `selorshhkdpydjtypgfq`.
Its `post_media` has 20 rows and lacks `thumbnail_url`, `duration_seconds`,
`byte_size`, and the two checks introduced by release migration 0025. The
designated account has the admin role in that database. These observations
strongly identify the schema mismatch behind the Feed failure. The live
Worker's secret value was not inspected.

The exact `0025_post_video_media.sql` from the `e5e3109` release was exercised
against isolated PostgreSQL via PGlite. The media read failed with `42703`
before migration and succeeded afterward. Existing media was preserved, and
both checks rejected invalid values. An attached worktree pins the live
source. Pending owner approval, apply only migration 0025 to the database
matching the live Feed in a transaction with a short lock timeout. Then check
the columns and constraints, rerun the failed query, and verify the signed-in
Feed in the browser. Reconcile the applied change with migration history before
any later journal rollout. No connection target change is proposed.

A short, filtered Wrangler tail captured the reproduced request and was stopped.
The logged error was a failed query selecting media metadata from `post_media`
for a page of posts. It did not include a useful underlying SQLSTATE/cause.
Do not infer that a particular column is missing from that wrapper message.

Read-only inspection of production Supabase project `yimclwfiyxngszejoikz`
confirmed all selected columns, including thumbnail_url, duration_seconds,
byte_size, and processing_status. A zero-row projection of the same columns
succeeded. Health advisors returned no findings. A focused Postgres log search
returned no post_media events. The follow-up above explains why this first
project inspection did not reproduce the failure. No production migration or
credential replacement was applied.

## Additional configuration findings

Local configuration has a signing secret meeting the 32-character minimum, but
no private bucket name. Private evidence uploads must remain closed until that
storage is provisioned and tested. No secret value was printed. RESEND_API_KEY
is also absent locally; this does not establish whether the authentication
provider's own SMTP service is configured or delivers email.

The privacy page promises account deletion through Settings and data-copy
requests. The inspected users API exposes GET/PUT, and no deletion/export control
was found in Settings. Confirm and implement those promises, or have the owner
review an accurate supported request process, before launch.

The existing gate manifest predated the hourly retention cron in wrangler.jsonc.
Reviewed the exact cron addition against the scheduled retention handler and
updated only that configuration's pin. All 50 pinned gate files now match. This
does not verify that the cron or alert delivery works in production.

After the initial seven suites (251 tests), the final jobs/public-application
changes passed two suites (67 tests, overlapping the initial jobs suite). Public
discovery now requires an approved review status; applications reject unapproved
jobs, including legacy rows still marked active. Employer management responses
include review status/note only for authenticated company administrators.
Final TypeScript, lint, build, and diff-whitespace checks passed again.

The separate infrastructure run passed the 65 gate-drift tests. Preview
preflight initially failed 16/27 checks under restricted networking; with
loopback access allowed, 25/27 passed. The two remaining failures exercise real
Windows port-owner/process-command lookup, which returned an unknown/info state
instead of the expected known owner. The environment also denied a direct CIM
process lookup. This limitation remains unresolved; the checks were not skipped
or weakened. Logs: `.tmp/launch-infrastructure-tests.log` and
`.tmp/launch-preflight-network.log`.

The broad suite did not complete and was interrupted after progress stopped.
No full-suite success or total is claimed. A final source change occurred while
that broad run was outstanding; use the separate final jobs run for those
changes. Before public release, complete a clean full run on a stable tree.
