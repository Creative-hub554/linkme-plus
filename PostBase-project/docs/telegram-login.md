# Telegram sign-in setup

Archived: the owner chose Google and email/password only on 2026-10-27.
Telegram UI wiring and its feature flag have been removed. The notes below
are historical setup research, not instructions to enable a current feature.

Google and email/password remain available. Facebook is no longer offered.
Telegram buttons on login and registration remain hidden until the provider
is configured. No bot token or client secret belongs in frontend environment
variables or chat.

1. Create or select the LinkMePlus bot in Telegram's verified @BotFather.
   Open its Login Widget settings and obtain the login Client ID and Secret.
2. In Supabase Authentication → Sign In / Providers, create a custom OIDC
   provider with identifier `custom:telegram`, issuer
   `https://oauth.telegram.org`, and the BotFather login credentials. Use
   `openid` and `profile` scopes. Telegram accounts need not supply email;
   configure the provider with `email_optional: true`.
3. Register the callback URL displayed by Supabase in BotFather's Allowed URLs.
   Also allow `https://linkmeplus.com` and `https://www.linkmeplus.com` as
   website origins. Verify Supabase allows both sites' `/auth/callback` URLs.
4. Set `NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED=true` in the build environment, rebuild,
   and deploy. This is a public feature flag, not a credential.
5. Verify a new Telegram user completes authentication, receives an application
   profile, and can reopen the feed. Do not link accounts by Telegram username
   or an unverified email; identity verification belongs to Supabase/OIDC.

Until this complete flow is verified, do not claim Telegram login is active.
The existing callback provisions accounts without email using an internal
`@oauth.local` placeholder. That placeholder is not a deliverable email and
must not be used as a recovery address; a Telegram-only member should continue
with Telegram unless a real email is added and verified through Auth.

References:
- https://core.telegram.org/bots/telegram-login
- https://supabase.com/blog/custom-oauth-oidc-providers
