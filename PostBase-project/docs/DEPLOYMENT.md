# LinkMe+ Deployment Guide

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
- `AUTH_SECRET` - Generate with `openssl rand -base64 32`
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
