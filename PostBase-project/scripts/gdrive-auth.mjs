#!/usr/bin/env node
/**
 * The one-time Google consent dance for the media archive.
 *
 * Run `npm run gdrive:auth` with GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET in
 * the environment (a `.env.local` is read automatically), visit the URL this
 * prints, approve access with the Google account whose Drive should hold the
 * archive, and this script writes the resulting GDRIVE_REFRESH_TOKEN to the
 * terminal. That token is the archive's permanent credential: it is exchanged
 * for short-lived access tokens by src/lib/gdrive.ts, and it never expires on
 * its own — *as long as the OAuth consent screen is published*, which is the
 * one step this script cannot do for you and the most common way the setup
 * silently dies seven days later (see docs/GOOGLE-DRIVE-ARCHIVE.md).
 *
 * The redirect comes back to a loopback server this script starts for the
 * duration of the consent, which is Google's own recommended pattern for
 * installed tools — the out-of-band (`urn:ietf:wg:oauth:2.0:oob`) flow it
 * replaces was retired in 2022. A random `state` is round-tripped and checked
 * so a page other than Google's cannot hand this script somebody else's code.
 *
 * No dependencies: Node 18+ ships everything used here.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";

const CLIENT_ID = process.env.GDRIVE_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET?.trim();
// `drive`, not `drive.file`: the archive may be pointed at a folder the
// operator already keeps (which `drive.file` apps cannot see), and this is a
// single-account automation. Kept in sync with DRIVE_SCOPE in src/lib/gdrive.ts.
const SCOPE = "https://www.googleapis.com/auth/drive";
const PORT = readFlag("--port") ? Number(readFlag("--port")) : 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function die(message) {
  console.error(`\ngdrive-auth: ${message}`);
  process.exit(1);
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  die(
    "GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET must be set.\n" +
      "  Create them at https://console.cloud.google.com/apis/credentials\n" +
      "  (type: OAuth client ID, application: Desktop app), then either export\n" +
      "  them or put them in .env.local and re-run `npm run gdrive:auth`.",
  );
}

const state = cryptoRandom();

function cryptoRandom() {
  // 128 bits from whatever the platform considers cryptographic; enough to
  // make a forged `code` parameter useless to whoever shuffled it in.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function openBrowser(url) {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  // Best effort: the URL is printed either way, and a headless box failing to
  // open a tab is not a reason to kill the consent.
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    /* printed below is the fallback */
  }
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    die(`exchanging the code failed (${response.status}): ${json.error ?? response.status} ${json.error_description ?? ""}`.trim());
  }
  return json;
}

const consentUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Forces the refresh token to be issued even on a re-consent — without
    // it, a second run of this script would answer with a code that exchanges
    // to nothing.
    prompt: "consent",
    state,
  }).toString();

console.log("\nApprove the archive's access to Google Drive:\n");
console.log(`  ${consentUrl}\n`);
console.log(`Waiting for Google to redirect to ${REDIRECT_URI} (this window closes in 5 minutes)…`);
openBrowser(consentUrl);

const timeout = setTimeout(() => {
  server.close();
  die("timed out waiting for the consent redirect");
}, CONSENT_TIMEOUT_MS);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", REDIRECT_URI);

  if (url.pathname !== "/") {
    response.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error) {
    response.writeHead(200, { "Content-Type": "text/plain" }).end("Denied — you can close this tab.");
    server.close();
    clearTimeout(timeout);
    die(`Google answered: ${error}`);
  }
  if (!code || url.searchParams.get("state") !== state) {
    // Anything that is not *this* consent's redirect gets nothing: a stray
    // request to the open port must not be able to complete the exchange.
    response.writeHead(400).end("Unexpected request — you can close this tab.");
    return;
  }

  response
    .writeHead(200, { "Content-Type": "text/plain" })
    .end("Approved. You can close this tab and return to the terminal.");

  exchangeCode(code)
    .then((tokens) => {
      server.close();
      clearTimeout(timeout);
      if (!tokens.refresh_token) {
        die(
          "Google issued no refresh token. Revoke the app's access at " +
            "https://myaccount.google.com/permissions and run this script again — " +
            "prompt=consent normally guarantees one.",
        );
      }
      console.log("\nDone. Put these in .env.local for local runs, and on the Worker for production:");
      console.log("\n  wrangler secret put GDRIVE_REFRESH_TOKEN   # value printed below\n");
      // The token is the whole credential — printed because that is this
      // script's job, and labelled because it must never be shared or committed.
      console.log(`  GDRIVE_CLIENT_ID=${CLIENT_ID}`);
      console.log(`  GDRIVE_CLIENT_SECRET=${CLIENT_SECRET}`);
      console.log(`  GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log(
        "\n⚠ Tokens issued to an OAuth app still in *Testing* status expire after 7 days.\n" +
          "  Publish the consent screen (even just for yourself) at\n" +
          "  https://console.cloud.google.com/apis/credentials/consent — see\n" +
          "  docs/GOOGLE-DRIVE-ARCHIVE.md — or the archive stops with invalid_grant\n" +
          "  exactly one week from now.\n",
      );
      process.exit(0);
    })
    .catch((error) => {
      server.close();
      clearTimeout(timeout);
      die(`exchanging the code failed: ${error.message ?? error}`);
    });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`(listening on ${REDIRECT_URI} for the redirect)`);
});
