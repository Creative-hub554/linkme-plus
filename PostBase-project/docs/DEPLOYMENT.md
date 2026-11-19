# LinkMe+ Deployment Guide

> A live credential (the `DATABASE_URL` password) leaked on 2026-10-21 and must
> be rotated — the procedure, location map and ledger live in
> [credential-rotation.md](credential-rotation.md). Check its checklist before
> any deploy that touches secrets.

## Freebuff Sites deploy pipeline (one command)

The Freebuff Sites hosting target takes a **prebuilt** Worker bundle plus a
static-asset tree — it compiles nothing at upload time, and it caps one Code
deployment at 100 code modules. vinext's own build graph is the wrong shape for
that (a couple of hundred interlinked chunks), so `npm run sites:prepare`
re-packages vinext's build output the way the first Sites deploy was done by
hand:

```bash
npm run sites:prepare
```

One command, no flags, no other inputs. It runs every stage from scratch —
nothing is re-used from a previous run, so a stale dist can never be deployed:

1. **`vinext build`** (via `npm run build`) — produces `dist/client` (the
   asset tree) and `dist/server` (the server graph). Reads `.env.local` itself
   if the shell does not already export those variables, because the build
   prerenders and the server entry loads `DATABASE_URL` at module scope.
2. **Single-file Worker bundle** — esbuild bundles the *built* server entry
   `dist/server/index.js` （not `worker/index.ts` — only the vinext build can
   resolve the `virtual:vinext-*` adapter imports) into
   `sites-deploy/vinext-worker.js`: one module, all dependencies inlined,
   `node:*` builtins and `cloudflare:*` runtime modules left external for
   `nodejs_compat`. The built entry already carries the wrapped worker (the
   per-request database scope and the vinext handler), and the script verifies
   that the bundle still carries a default export before it proceeds.
3. **Asset-first entry** — `sites-deploy/entry.js` is written fresh: file-ish
   GET/HEAD requests try the `ASSETS` binding first (native cache headers and
   redirects), and an unmatched 404 falls through to the worker, so SSR pages,
   `/api/*` and scheduled jobs keep using the worker.
4. **Pruned asset tree** — `dist/client` is copied into `sites-deploy/assets`
   with every dot-entry (`.vite/`, `.assetsignore`, ...) dropped, symlinks
   refused, and a post-pass re-verifies that no hidden file survived anywhere,
   so nothing but the public tree reaches the upload.
5. **`sites.manifest.json`** — the deploy manifest, in the exact shape Sites
   consumes: two ESM modules (`entry.js`, `vinext-worker.js`), `nodejs_compat`,
   and `spa: false` (this app serves HTML per route from the worker).

Everything under `sites-deploy/` is generated: it is gitignored and
lint-ignored, and the script rebuilds it from nothing on a fresh checkout.
The script does **not** upload — deploying means pointing the Sites panel (or
the `sites_deploy` agent tool) at `sites.manifest.json`, preview first, then
production with the user's go-ahead.

Quick reference:

| Step | Command |
|---|---|
| Everything needed to deploy | `npm run sites:prepare` |
| Upload the prepared manifest | Sites panel or `sites_deploy` with `sites.manifest.json` |

## Classic deploy via wrangler (regional Workers, not Sites)

The wrangler flow below predates the Sites pipeline and deploys the same
bundle shape with plain `wrangler deploy`; it is kept for deploys outside the
Sites panel.

## Prerequisites

1. **Cloudflare Account** - Sign up at https://dash.cloudflare.com
2. **Node.js 18+** - Install from https://nodejs.org
3. **Wrangler CLI** - Install globally: `npm install -g wrangler`
4. **PostgreSQL Database** - Use Neon, Supabase, or Railway

## Initial Setup

### 1. Login to Cloudflare

```bash
wrangler login
```

### 2. Create R2 Bucket

```bash
wrangler r2 bucket create linkme-plus-uploads
```

### 3. Create KV Namespace

```bash
wrangler kv namespace create CACHE
wrangler kv namespace create CACHE --preview
```

Update `wrangler.jsonc` with the returned IDs.

### 4. Create Database

Use one of these managed PostgreSQL providers:

**Neon (Recommended)**
1. Sign up at https://neon.tech
2. Create a new project
3. Copy the connection string

**Supabase**
1. Sign up at https://supabase.com
2. Create a new project
3. Go to Settings > Database > Connection string

### 5. Set Up Environment Variables

All user-uploaded objects use the Cloudflare R2 bucket through the S3-compatible API. The same bucket stores avatars, profile covers, post media, marketplace media, documents, and legacy cover-video uploads. Keep the R2 API token server-side only; never expose its secret in browser code.


Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon (public) key
- `R2_ACCOUNT_ID` - Your Cloudflare account ID
- `R2_ACCESS_KEY_ID` - R2 API token access key
- `R2_SECRET_ACCESS_KEY` - R2 API token secret key
- `R2_BUCKET_NAME` - "linkme-plus-uploads"
- `R2_PUBLIC_URL` - Your R2 public domain

### 6. Initialize Database

```bash
npm run db:push
```

## Development

```bash
npm run dev
```

Visit http://localhost:3000

## Production Deployment

### 1. Set Production Secrets

```bash
wrangler secret put DATABASE_URL
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_BUCKET_NAME
wrangler secret put R2_PUBLIC_URL
```

### 2. Deploy

```bash
npm run deploy:production
```

The live Worker uses the top-level configuration in `wrangler.jsonc`, which
already names `linkme-plus` and its two custom domains. There is no named
`production` environment. The production script builds with the existing Vite
integration and deploys its generated `dist/server/wrangler.json`; do not add
`--env production`. Cloudflare's Vite integration selects environments at build
time ([environment reference](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)).

For a packaging check without publishing, after a successful build run:

```bash
npx wrangler deploy --config dist/server/wrangler.json --dry-run
```

Resolve the credential rotation and migration checks in
[production-release-status.md](production-release-status.md) before publishing.

### 3. Custom Domain (Optional)

1. Go to Cloudflare Dashboard > Workers & Pages
2. Select your worker
3. Go to Settings > Triggers > Custom Domains
4. Add your domain

## Staging Environment

### 1. Create Staging wrangler config

```bash
cp wrangler.jsonc wrangler.staging.jsonc
```

Update the name and bindings for staging.

### 2. Deploy to Staging

```bash
npm run deploy:staging
```

## Environment Variables Reference

### Required

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key | `eyJ...` |
| `R2_ACCOUNT_ID` | Cloudflare account ID | `abc123` |
| `R2_ACCESS_KEY_ID` | R2 API access key | `...` |
| `R2_SECRET_ACCESS_KEY` | R2 API secret key | `...` |
| `R2_BUCKET_NAME` | R2 bucket name | `linkme-plus-uploads` |
| `R2_PUBLIC_URL` | R2 public URL | `https://pub-xxx.r2.dev` |

### OAuth Providers

Google and Facebook sign-in are configured in the Supabase dashboard under Authentication → Sign In / Providers, not as environment variables.

### Optional

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID (for phone OTP) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |
| `RESEND_API_KEY` | Resend API key (for emails) |
| `MEILISEARCH_HOST` | Meilisearch instance URL |
| `MEILISEARCH_API_KEY` | Meilisearch API key |

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

### Database Connection Issues

```bash
# Test connection
psql $DATABASE_URL

# Reset database
npm run db:push --force
```

### R2 Upload Issues

```bash
# Check bucket exists
wrangler r2 bucket list

# Test upload
wrangler r2 object put linkme-plus-uploads/test.txt --file=test.txt
```

### Worker Errors

```bash
# Check logs
wrangler tail
```

## Performance Tips

1. **Enable CDN** - Cloudflare CDN is automatic with Workers
2. **Use R2 Public Bucket** - For static assets. Configure the bucket's managed `r2.dev` domain or a custom domain and set it as `R2_PUBLIC_URL`.
3. **Enable Auto-Minify** - In Cloudflare Dashboard > Speed
4. **Use Brotli Compression** - Enabled by default

## Security Checklist

- [ ] All secrets are in environment variables
- [ ] CORS is configured for your domain
- [ ] Rate limiting is enabled
- [ ] CSP headers are set
- [ ] HTTPS is enforced
- [ ] Database connections use SSL

## Monitoring

1. **Cloudflare Analytics** - Dashboard > Analytics
2. **Worker Logs** - `wrangler tail`
3. **Error Tracking** - Set up Sentry integration
4. **Uptime Monitoring** - Use Cloudflare Health Checks

## Cost Estimation

| Service | Free Tier | Estimated Cost |
|---|---|---|
| Workers | 100k requests/day | $0 (free tier) |
| R2 Storage | 10GB | $0.015/GB/month |
| R2 Operations | 10M reads/month | $0.36/million |
| KV | 100k reads/day | $0.50/million |
| Durable Objects | 400k request-minutes | $0.15/million |
| PostgreSQL | Varies by provider | $0-25/month |

Total for small app: **$0-50/month**

## Functional fixes in the local checkout

Password recovery uses Supabase's existing email service and the callback at
`/auth/callback?next=/reset-password`. In Supabase Authentication URL settings,
allow that callback URL on every hostname where this application runs. Reset
emails also depend on your project's configured email delivery. No live Auth
configuration is changed by these code updates.

Marketplace publishing creates a draft, then activates it after any photo upload
succeeds. Photo uploads use the existing R2 configuration. Jobs are published by
administrators of a business Page; the posting form creates its company record
when needed. Prices retain the existing whole-dollar database representation.

The admin dashboard now reads actual records. It supports report dismissal,
recorded warnings, and removal of reported posts, comments, listings, and jobs.
Removal and the decision/audit record commit together. Account restrictions are managed from the admin Users tab and are enforced on
authenticated API requests and protected page access.
Member approvals and revenue figures are no longer shown as sample data.

Messaging refreshes the selected conversation every three seconds and the list
every five seconds. Friends are mutual follows, using the existing follow model.
The remaining workflow features require migration `0015_remaining_workflows.sql`
before the updated application is run. These changes have not been deployed.

### Remaining workflow migration and KHQR setup

Apply the existing migration history in order, including
`0014_peaceful_franklin_richards.sql` and `0015_remaining_workflows.sql`, before
starting this version. The latter adds duplicate protection, account restrictions,
private advertising/payment tables, and member-only notification restrictions.
It does not delete or merge existing records. Check for duplicate company Page
IDs, job/user application pairs, inventory listing IDs, and campaign/date metric
pairs first; a uniqueness failure requires reconciling those records deliberately.
Do not blindly delete duplicate applications or payment-related records.

After migration, an administrator opens `/advertising`, uploads the existing
merchant KHQR, checks the merchant name and the QR's currency (KHR or USD), then
adds placements and daily rates in that currency. Prices use whole currency units.
Advertisers choose a placement and dates; the server calculates the amount.
They pay through their banking app and submit the bank reference and payer name.
The QR and merchant details are captured on each booking so later configuration
changes do not silently redirect an existing booking's payment instructions.

A different administrator must check the actual bank credit, amount, currency,
and reference before selecting payment verification. Content approval is a
separate decision; placement capacity is locked and checked during approval.
No browser-submitted payment flag can activate a campaign. Fully booked dates
must be resolved with the advertiser before approval. Money is never moved by
these screens. Refunds are performed in the bank and then recorded by an admin.

Banners are delivered on the social feed, unfiltered job board, and marketplace.
Boosted Page posts appear in the feed; promoted listings appear in the marketplace
and respect category filters. Sponsored content is withheld on search/price/location
filtered boards. Deleted/private/edited source posts and removed/sold/out-of-stock
listings stop being eligible at delivery time. A modified Page post requires a new
review. A local browser cap limits repeat ad views and offers hide/report controls.
Metrics count signed-in member impressions and clicks once per member per day;
they are not a measure of anonymous reach or a basis for metered billing.

Employers use `/jobs/manage` to review applicants and close/reopen jobs. Sellers use
`/marketplace/inventory` to set up SKU/private cost/threshold values and record
stock movements. Quantity changes and their audit movements commit together.
Base product stock is supported; variant adjustments are explicitly refused by
this endpoint rather than silently changing the base quantity.

Account suspensions expire after the selected period. Bans last until restored.
Both are checked against the server's verified identity on subsequent requests;
existing browser tokens cannot bypass the application check. A database outage
fails these authenticated checks closed. Restriction writes are administrator-only
and audited; an administrator cannot restrict themselves or another administrator.

For Windows test runs, include both Node and Git on PATH and use an OS temporary
directory outside the application folder. Local-server preflight tests require
loopback networking; a sandbox that refuses child-process HTTP with EACCES cannot
validate those tests. The preflight locates Windows system tools even when
System32 is absent from PATH.

The server database connection must retain the privileged server role. Marketplace,
company, hiring, inventory, and advertising tables are accessed through authorized
server endpoints; direct browser Data API access is denied by RLS. Payment details,
private stock costs, and applicant records must never be granted anonymous access.
