# The Google Drive media archive

PostBase keeps every uploaded object — avatars, covers, post media, listing
photos, documents — in one R2 bucket and serves it from `R2_PUBLIC_URL`. That
is the hot tier, and it is deliberately short-lived: **an object spends its
first three days on R2 and is then archived to Google Drive**, with the
database rewritten to point at the Drive copy. Everything that was already in
the bucket when this shipped (old profile pictures, old posts) is past the
grace period by definition, so the same hourly pass drains it in the first day
or two — with a per-run batch limit, so "drain" means "a few hours", not
"one heroic cron".

| Tier | Lives | Serves | For how long |
|---|---|---|---|
| Hot | R2 (`linkme-plus-uploads`) | `R2_PUBLIC_URL` | first 3 days of an object's life, then only until the next hourly pass |
| Cold | Google Drive (your account) | `lh3.googleusercontent.com` / `drive.google.com` links | indefinitely |

R2 is also where uploads *land* — before any row points at them, since the
post or comment that references a file is created by a later request. The
same hourly cron therefore runs two passes, in this order: **eviction**
deletes uploads nothing ever referenced (see
[Eviction: the other direction](#eviction-the-other-direction)), and then
the archive moves everything old enough that remains to Drive. This document
is mostly about the second one.

The moving parts, in the order a pass runs them:

- `src/lib/gdrive.ts` — refresh-token auth, Drive's resumable upload protocol,
  the public-permission call, and the URL forms archived media is served from.
- `src/lib/media-archive.ts` — the pass itself: list → age → upload → verify →
  record → rewrite → delete, plus the batched SQL that rewrites every column
  that may hold an old URL.
- `src/lib/media-eviction.ts` — the eviction pass: list every covered folder
  (the post uploads folder, the demo seeder's folder) → age → skip
  archive-owned keys → prove each candidate unreferenced against the same
  column list the archive rewrites → delete the orphans. It runs first, so an
  orphan is deleted rather than shipped to Drive and kept there.
- `archived_objects` (table, migration `0014`) — one row per moved object: the
  R2 key, the Drive file id, and both URLs. This row is the archive's memory:
  it lets a crashed run resume without re-uploading, and it is the allow-list
  `deleteStoredObjects` consults before removing anything from Drive. It is
  also eviction's *deny*-list: a key with a mapping row is never evicted.
- `worker/index.ts` `scheduled()` + the `17 * * *` cron in `wrangler.jsonc` —
  the hourly trigger, running eviction then the archive. Each pass decides
  for itself what a half-configured setup means: no Drive secrets is one log
  line and nothing moved, no `R2_PUBLIC_URL` is the eviction pass declining.

## One-time setup

1. **Google Cloud project** — <https://console.cloud.google.com>, new project.
   Enable the **Google Drive API** (APIs & Services → Library).
2. **OAuth consent screen** (APIs & Services → OAuth consent screen):
   External, your own Google account as a test user. **Publish the app** —
   even "publish for yourself" counts. While the app sits in *Testing*, every
   refresh token expires after **7 days** and the archive stops with
   `invalid_grant` a week later. This is the single most common way this
   feature silently dies; the auth helper and the error message both say so.
3. **OAuth client** (APIs & Services → Credentials → Create credentials →
   OAuth client ID, application type **Desktop app**). Copy the client id and
   secret.
4. **Consent dance** — put the two values in `.env.local`
   (`GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`) and run:

   ```
   npm run gdrive:auth
   ```

   It prints/opens Google's consent URL, listens on `127.0.0.1:53682` for the
   redirect, and prints a `GDRIVE_REFRESH_TOKEN` to paste back into
   `.env.local`. Treat that token like a password.
5. **Secrets on the Worker** (the cron reads them from the deployed
   environment, not from `.env.local`):

   ```
   wrangler secret put GDRIVE_CLIENT_ID
   wrangler secret put GDRIVE_CLIENT_SECRET
   wrangler secret put GDRIVE_REFRESH_TOKEN
   ```

   Optional: `GDRIVE_FOLDER_ID` archives into a folder you already keep
   (share nothing; the archive acts as you). Without it, files land in a
   folder named by their R2 key structure under My Drive's root.
6. **Optional dry run** — set `ARCHIVE_DRY_RUN=1` (secret or `.dev.vars`),
   trigger a pass, and read the log: it lists exactly which keys a real run
   would upload and delete, having touched nothing. Remove it when the list
   looks right.

Then deploy (`npm run deploy`). The cron travels with the Worker.

## Tuning

| Variable | Default | Meaning |
|---|---|---|
| `ARCHIVE_GRACE_DAYS` | `3` | days an object stays on R2 before the pass may move it |
| `ARCHIVE_BATCH_LIMIT` | `10` | objects uploaded per hourly pass — raise to drain a backlog faster, lower if a run ever brushes the cron's CPU/subrequest budget (videos are the worst case: ~15 Drive calls per 100 MB file) |
| `ARCHIVE_DRY_RUN` | off | `1`/`true`: list and log, touch nothing |
| `R2_PUBLIC_URL` | — | must be set; it is the prefix rewritten away |

## What the archived URLs look like — and the one caveat

Drive documents no stable raw-bytes URL for every media type, so
`drivePublicUrl` picks the best-known form per type:

- **Images** → `https://lh3.googleusercontent.com/d/{id}` — loads anonymously
  in an `<img>` tag. Long-standing and widely relied upon, but *convention,
  not documented API*.
- **PDFs** → `https://drive.google.com/file/d/{id}/preview` — Drive's own
  viewer, so a CV or document renders instead of downloading.
- **Everything else, video above all** →
  `https://drive.google.com/uc?export=download&id={id}` — **the caveat**.
  Google documents no guaranteed hotlink for video; this form streams files
  in the range our 100 MB upload cap allows, but may serve larger ones an
  interstitial. **After the first pass, verify one archived video plays.**
  If it does not, the videos are still intact on Drive and the mapping table
  records every one of them — the fix is a different serving story (e.g.
  Cloudflare Stream for cold video), not a lost file.

Making each file world-readable (`permissions.create`, `type: anyone,
role: reader`) is a separate API call the pass makes after every upload and
*before* any Drive URL is written into the database, so a URL can never exist
in a row while the file is still private.

## Failure, resume, and deletion semantics

The pass is hourly and never throws; a failure is a line in its report and a
retry next hour. The ordering makes every crash window safe:

- Crash **during upload** → nothing recorded, nothing rewritten, R2 object
  intact; next run re-uploads (an orphaned Drive copy from a crash mid-upload
  is possible and harmless — it is never referenced).
- Crash **after recording, before rewriting** → the mapping row exists and
  the R2 object survived; the next run *resumes*: it rewrites the URLs and
  deletes the object, uploading nothing.
- Crash **during rewrite** → the run stops before any delete; rows still
  point at R2, the app still works, and the next run resumes as above.
- R2's copy is verified against Drive's (**size always, md5 when both sides
  know one**) before anything is recorded or deleted. A mismatch fails the
  object, never the file.

Deleting content after it is archived keeps working because
`deleteStoredObjects` handles both homes: R2 URLs are deleted by key as
before, and Drive URLs are deleted **only when `archived_objects` records
them** — a Drive-shaped URL a client put in a row (a stranger's public file)
is never touched, because the mapping table is the allow-list.

## Eviction: the other direction

Uploads are public URLs before they are rows: `/api/uploads` and
`/api/posts/media` answer immediately, and the post or comment that
references the file is created by a *later* request. When that request never
comes — abandoned composer, lost tab, publish that failed client-side — the
object is stranded in the bucket. Left alone, the archive would eventually
move it to Drive and keep it there forever. The demo seeder strands objects
the same way: it uploads every asset before the rows that reference them are
written, and a re-seed with fewer posts or members leaves the old objects
referenced by nothing. The eviction pass reclaims those orphans, and runs
first in the same cron so a stray upload is deleted rather than archived.

One pass, and the order is the safety argument:

1. **List** every folder the pass covers — the post folder and the demo
   seeder's folder, each derived from `getFolderForPurpose` the same way its
   writers derive their keys (`"post"` for the upload routes, `"seed"` for the
   seeder, the one `putObject` caller outside a route), so the pass cannot
   drift from what it cleans up after.
2. **Age** the objects past `EVICT_GRACE_HOURS` (24 by default) — the window
   a slow publisher gets between uploading a photo and creating the post that
   claims it.
3. **Skip** anything `archived_objects` maps: the archive owns those keys and
   its resume path may still be about to rewrite rows pointing at them.
4. **Prove each candidate unreferenced** against the same column list the
   archive rewrites (`ARCHIVE_REWRITE_TARGETS`): no `post_media` or
   `comment_media` row, no seeded avatar or Page cover naming it, no URL
   pasted in a post's, comment's or message's text. Reusing that list is the
   point — a URL-holding column added later
   protects objects from eviction automatically, and `media-archive.test.ts`
   guards the list against schema drift.
5. **Delete** the proven orphans, oldest first, under `EVICT_BATCH_LIMIT`.

The pass **fails closed**: if the listing, the ownership lookup, or the
reference check errors, nothing is deleted that hour — an unknown reference
state reads as "referenced". False keeps are possible and safe (the `like`
predicates over-match; a URL pasted anywhere keeps its object), and a false
delete is exactly what the ordering rules out.

| Variable | Default | Meaning |
|---|---|---|
| `EVICT_GRACE_HOURS` | `24` | hours an unreferenced upload survives; **must stay below `ARCHIVE_GRACE_DAYS`** (3 days) or orphans reach Drive before this pass sees them |
| `EVICT_BATCH_LIMIT` | `50` | objects checked-and-deleted per hourly pass — deletes are one call each, so this can exceed the archive's much costlier batch |
| `EVICT_DRY_RUN` | off | `1`/`true`: list and log the keys a real run would delete, touch nothing |

No Drive credentials are involved: eviction only lists and deletes in R2.

## Quotas and known costs

- Drive upload quota is generous (750 GB/day) and the batch limit keeps the
  pass far under it; API request quota is the tighter constraint for large
  backlogs — drain slowly by raising the batch limit a step at a time.
- The rewrite runs one `update` per column per pass with `like`/`= any`
  predicates; statements that match nothing are no-ops. Tables are
  seq-scanned per statement — fine at this project's scale, worth revisiting
  with partial indexes past a few million rows.
- The mapping rows are kept forever: they are the provenance of every
  Drive-hosted URL the app serves and the delete allow-list.

## Migration note

`drizzle/0014_media_archive.sql` + the journal entry create
`archived_objects` for fresh environments. The current database arrived via
`db:push` (its `__drizzle_migrations` history is empty, so `db:migrate` has
nothing to say about it); the table was therefore created directly with the
migration's exact, idempotent `create table if not exists` statement.

## Sources

Verified against current documentation in October 2026; `src/lib/gdrive.ts` cites this
section where a URL form's provenance matters:

- Resumable uploads: <https://developers.google.com/drive/api/guides/manage-uploads>
- Making files public: <https://developers.google.com/drive/api/guides/public-file>
- Permissions API: <https://developers.google.com/drive/api/guides/manage-permissions>
- Refresh-token expiry in Testing: <https://developers.google.com/identity/protocols/oauth2#testing>
