# LinkMe+ Deployment Guide

## Prerequisites

1. **Cloudflare Account** - Sign up at https://dash.cloudflare.com
2. **Node.js 18+** - Install from https://nodejs.org
3. **Wrangler CLI** - Installed locally with the project; use it through the npm scripts below.
4. **PostgreSQL Database** - Use Neon, Supabase, or Railway

## Initial Setup

### 1. Authenticate Wrangler

```bash
npx wrangler login
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
- `AUTH_SECRET` - Generate with `openssl rand -base64 32`
- `R2_ACCOUNT_ID` - Your Cloudflare account ID
- `R2_ACCESS_KEY_ID` - R2 API token access key
- `R2_SECRET_ACCESS_KEY` - R2 API token secret key
- `R2_BUCKET_NAME` - "linkme-plus-uploads"
- `R2_PUBLIC_URL` - Your R2 public domain

### 6. Initialize Database

```bash
npm run db:push
npm run db:seed
```

### 7. Grant the First Administrator

The admin dashboard — moderation, the verification review queue, campaign
approval, and reports — serves only the accounts whose `admin` role the owner
grants. Nothing in the application can donate the role, so elevation happens
from a machine that holds `DATABASE_URL`:

```bash
npm run admin:grant -- you@example.com
```

The run prints the account's resulting role, so a grant leaves its own
evidence in the terminal. List who holds the role, or take it back:

```bash
npm run admin:grant -- --list
npm run admin:grant -- --revoke you@example.com
```

Verification review needs at least one such admin: the reviewer queue at
`/admin` lists pending applications to administrators only, and a reviewer's
approval is what sets a member's public verified badge.

## Development

```bash
npm run dev
```

Visit http://localhost:3000

### Verifying the API against a scratch Postgres branch

One command stands up a disposable Postgres in Docker, applies the full
migration set (per file, recorded so it is rerunnable), seeds the demo data,
and runs the live-Postgres smokes — the moderation and verification flows
through the real handlers, the rendered moderation and verification-review
dashboards, and the reports board — against
that branch. Run it whenever the migrations, the seed, or the admin surface
change; it cleans up after itself, so it is safe to repeat against one
branch:

```bash
npm run smoke:postgres
```

Requires Docker. When you are done with the branch, tear it down:

`docker rm -f linkme-smoke-pg`

### The verification queue's nightly alarm

Verification is never self-awarded: a member submits an application from
Settings, and only an administrator's approve at `/admin` → Verification flips
the public badge. That makes an unwatched queue the one state the admin surface
cannot rescue by itself, so the nightly gate is where someone is watching.

`nightly.yml` runs the full CI gate on a schedule, and its queue-alarm test
(`src/test/verification-queue-alarm.test.ts`) reads the pending applications and
fails the night when one has waited past its review window — 48 hours by
default; `QUEUE_ALARM_MAX_HOURS` moves it. The gate's red is the paging channel:
the failure message names the handles owed, oldest first, and the action —
approve at `/admin` → Verification, or grant an admin first if nobody holds the
role (`npm run admin:grant -- <email>`); the nightly report's same-named section
renders the judgment as rows. The alarm stops paging the moment a reviewer has
acted, so nothing else has to be told.

Arming the alarm for the production database is one secret,
`NIGHTLY_QUEUE_DATABASE_URL`, defined in the repository's GitHub Actions secrets
— not `.env.local` and not the Worker secret store, because the alarm rides the
gate the nightly job runs, not the app runtime. Its value is a
least-privilege DSN that can only read `verification_requests` and `users`: mint
the role at the same provider that holds the production `DATABASE_URL`, and on a
provider with row-level security on by default (Supabase), add the two
role-scoped SELECT policies the same block names. The full mint, verify probe,
refusal assertions, and arm-check are pinned statement for statement in
`.freebuff/run.md`'s "The verification queue's nightly alarm" section, and
`npm run alarm:drill` replays that grant set against the smoke Postgres so the
claims stay earned whenever the schema moves near the alarm's read surface.
Leave the secret undefined and the alarm skips — it pages nobody and never
pretends green about a queue it cannot read; the suite line on any night's log
(`6 tests` when armed vs `6 tests | 1 skipped` when parked) says which state it
is in to anyone reading the run page.

## Production Deployment

### 1. Set Production Secrets

```bash
wrangler secret put DATABASE_URL
wrangler secret put AUTH_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put FACEBOOK_CLIENT_ID
wrangler secret put FACEBOOK_CLIENT_SECRET
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_BUCKET_NAME
wrangler secret put R2_PUBLIC_URL
```

### 2. Deploy

```bash
npm run deploy
```

### 3. Custom Domain (Optional)

1. Go to Cloudflare Dashboard > Workers & Pages
2. Select your worker
3. Go to Settings > Triggers > Custom Domains
4. Add your domain

## Staging Environment

Staging needs its own Cloudflare resource identifiers. Do not deploy the
production configuration with `--env staging`: Worker environment bindings are
not inherited, and that can connect a staging Worker to production KV, R2, or
Durable Object state. Add an `env.staging` block to `wrangler.jsonc` only after
creating and recording all of the following staging resources:

- a staging Worker name and route or preview domain;
- a staging KV namespace ID;
- a staging R2 bucket name;
- a staging Durable Object binding and migration; and
- staging secrets (including a non-production database URL).

Then build with `CLOUDFLARE_ENV=staging` and deploy the same named environment:

```bash
CLOUDFLARE_ENV=staging npm run build
npx wrangler deploy --env staging
```

## Environment Variables Reference

### Required

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db` |
| `AUTH_SECRET` | Auth.js secret key | `openssl rand -base64 32` |
| `R2_ACCOUNT_ID` | Cloudflare account ID | `abc123` |
| `R2_ACCESS_KEY_ID` | R2 API access key | `...` |
| `R2_SECRET_ACCESS_KEY` | R2 API secret key | `...` |
| `R2_BUCKET_NAME` | R2 bucket name | `linkme-plus-uploads` |
| `R2_PUBLIC_URL` | R2 public URL | `https://pub-xxx.r2.dev` |

### OAuth Providers

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `FACEBOOK_CLIENT_ID` | Facebook App ID |
| `FACEBOOK_CLIENT_SECRET` | Facebook App Secret |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |

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

### Durable Object Errors

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
5. **The nightly CI gate and its verification-queue alarm** - `nightly.yml` on a
   schedule, paged through the gate's red (see "The verification queue's nightly
   alarm" above); the same run also carries the moderation report and coverage
   trend for the next operator

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
