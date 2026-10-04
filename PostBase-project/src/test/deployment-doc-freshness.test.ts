import { describe, it } from "vitest";

import { expectDocSelfHeld, expectHeld, readSource } from "./doc-freshness";

/**
 * `docs/DEPLOYMENT.md` is the runbook a new operator follows to stand this project
 * up, and every load-bearing string in it is a claim about a file in the checkout:
 * `npm run` scripts that must exist in `package.json`, environment variables that
 * must exist in `.env.example` (the template the `cp` command names), an R2 bucket
 * that must match `wrangler.jsonc`'s binding, and the bindings themselves. A guide
 * that nothing compiled against ages silently — a renamed script or a dropped env
 * var leaves a fresh operator stranded at step one. These cases hold the guide's
 * quoted strings against those artifacts, byte-exact, through the shared
 * `./doc-freshness` helper.
 *
 * Deliberately outside the hold, stated here so the exclusion is a decision and not
 * an omission: the third-party command shapes (`wrangler login`, `wrangler secret
 * put …`, `psql $DATABASE_URL`) whose truth lives in Cloudflare's CLI, not here; the
 * provisioning instructions (bucket/namespace creation, dashboard walks); the
 * staging config, which the guide *creates* (`cp wrangler.jsonc
 * wrangler.staging.jsonc`) and so cannot pre-assert; the cost table and the
 * performance/security checklists, which are prose about external services; and
 * `NEXTAUTH_URL`/`CLOUDFLARE_*`/`CLOUDFLARE_STREAM_*`, which `.env.example` carries
 * but the guide does not quote.
 */

const doc = readSource("docs/DEPLOYMENT.md");
const pkg = readSource("package.json");
const envExample = readSource(".env.example");
const wrangler = readSource("wrangler.jsonc");

/** The guide's load-bearing strings, and the artifacts they must still be true of. */
const DOC_NEEDLES: Record<string, string> = {
  devScript: "npm run dev",
  buildScript: "npm run build",
  deployStagingScript: "npm run deploy:staging",
  dbPushScript: "npm run db:push",
  dbPushForce: "npm run db:push --force",
  cleanScript: "npm run clean",
  npmInstall: "npm install",
  envCopy: "cp .env.example .env.local",
  kvNamespace: "wrangler kv namespace create CACHE",
  bucketCreate: "wrangler r2 bucket create linkme-plus-uploads",
  bucketName: "linkme-plus-uploads",
  databaseUrl: "`DATABASE_URL`",
  r2PublicUrl: "`R2_PUBLIC_URL`",
  telegramToken: "`TELEGRAM_BOT_TOKEN`",
  meilisearchKey: "`MEILISEARCH_API_KEY`",
  googleSecret: "`GOOGLE_CLIENT_SECRET`",
  twilioToken: "`TWILIO_AUTH_TOKEN`",
};

describe("the deployment guide against the files it instructs about", () => {
  it("is quoted accurately: the strings it quotes exist in the doc itself", () => {
    expectDocSelfHeld(DOC_NEEDLES, doc, "DEPLOYMENT.md");
  });

  it("names npm scripts that exist in package.json", () => {
    // Every command the guide tells an operator to type must still be a script the
    // checkout defines — a renamed or removed script strands the guide's reader at
    // the step that names it.
    for (const needle of [
      '"dev":',
      '"build":',
      '"deploy:staging":',
      '"db:push":',
      '"clean":',
    ]) {
      expectHeld(needle, pkg, "package.json");
    }
  });

  it("names environment variables .env.example still templates", () => {
    // `.env.example` is the file the guide's `cp` names, so the template is the
    // contract: a variable the guide calls required must still have a row there.
    for (const needle of [
      "DATABASE_URL=",
      "AUTH_SECRET=",
      "R2_ACCOUNT_ID=",
      "R2_ACCESS_KEY_ID=",
      "R2_SECRET_ACCESS_KEY=",
      "R2_BUCKET_NAME=",
      "R2_PUBLIC_URL=",
      "GOOGLE_CLIENT_ID=",
      "GOOGLE_CLIENT_SECRET=",
      "FACEBOOK_CLIENT_ID=",
      "FACEBOOK_CLIENT_SECRET=",
      "TELEGRAM_BOT_TOKEN=",
      "TWILIO_ACCOUNT_SID=",
      "TWILIO_AUTH_TOKEN=",
      "TWILIO_PHONE_NUMBER=",
      "RESEND_API_KEY=",
      "MEILISEARCH_HOST=",
      "MEILISEARCH_API_KEY=",
    ]) {
      expectHeld(needle, envExample, ".env.example");
    }
  });

  it("describes the R2 bucket and KV binding wrangler.jsonc really configures", () => {
    // The bucket the guide creates and the CACHE namespace the guide's KV command
    // names are the two bindings an operator touches from this document; both must
    // still be what `wrangler.jsonc` declares.
    expectHeld(DOC_NEEDLES.bucketName, wrangler, "wrangler.jsonc");
    expectHeld('"binding": "CACHE",', wrangler, "wrangler.jsonc");
    expectHeld(DOC_NEEDLES.bucketName, envExample, ".env.example");
  });
});
