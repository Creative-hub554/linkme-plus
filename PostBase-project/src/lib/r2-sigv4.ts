/**
 * A workerd-native SigV4 signer for the R2 S3 API.
 *
 * The bundled AWS SDK is unusable inside a Cloudflare Worker build: the vite
 * bundle resolves it to its node flavor and the unenv polyfills stub what that
 * flavor calls, so even signing dies with `[unenv] fs.readFile is not
 * implemented!`. Wrangler's own bundling keeps native modules and the same SDK
 * works there — the divergence is purely in how the module gets built.
 *
 * Everything that must talk to the bucket's S3 API without the SDK — the health
 * probe, the Node dev server, the seed scripts — signs its own requests here:
 * SigV4 needs only SHA-2 hashing and HMAC, both available natively through
 * `crypto.subtle`, and produces exactly the headers R2's S3 API expects.
 * Configuration follows `@/lib/r2` (the same account and credential
 * variables), read lazily like `@/lib/db`'s connection string so a runtime
 * without these variables still boots its top-level scope. Callers that have
 * the platform's `UPLOADS` binding available do not come through this module
 * at all (they use the binding directly from `@/lib/r2-bucket`); this module
 * is the credential path, and it throws the same way `assertStorageConfigured`
 * does when the credentials are absent.
 */

const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** Strips the quotes some secret editors leave around a pasted value. */
function trimQuotes(value: string): string {
  if ((value.startsWith(`"`) && value.endsWith(`"`)) || (value.startsWith(`'`) && value.endsWith(`'`))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * The credentials at call time — each name read explicitly off the env alias, so
 * a read of one credential is a read of one name, not a lookup a letter builds.
 * `undefined` answers as empty, keeping a runtime without these variables boots
 * its top-level scope exactly like `@/lib/db`'s missing connection string does.
 */
function envValues(): { account: string; accessKeyId: string; secretAccessKey: string } {
  return {
    account: trimQuotes(runtimeEnv.R2_ACCOUNT_ID ?? ""),
    accessKeyId: trimQuotes(runtimeEnv.R2_ACCESS_KEY_ID ?? ""),
    secretAccessKey: trimQuotes(runtimeEnv.R2_SECRET_ACCESS_KEY ?? ""),
  };
}

export interface R2Credentials {
  account: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** The S3-API credentials, or `null` when the runtime carries none of them. */
export function r2ApiCredentials(): R2Credentials | null {
  const { account, accessKeyId, secretAccessKey } = envValues();
  if (!account || !accessKeyId || !secretAccessKey) return null;
  return { account, accessKeyId, secretAccessKey };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input) as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const encoder = new TextEncoder();

async function hmac(keyBytes: Uint8Array, input: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes as unknown as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(input) as unknown as BufferSource));
}

/** The empty-body SHA-256 every non-payload-bearing request signs with. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function amzDates(when: Date): { amzDate: string; dateStamp: string } {
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  const amzDate = `${when.getUTCFullYear()}${pad(when.getUTCMonth() + 1, 2)}${pad(when.getUTCDate(), 2)}T${pad(when.getUTCHours(), 2)}${pad(when.getUTCMinutes(), 2)}${pad(when.getUTCSeconds(), 2)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export type R2ApiMethod = "HEAD" | "GET" | "PUT" | "DELETE";

export interface R2ApiRequest {
  method: R2ApiMethod;
  bucket: string;
  /** The object key; empty for a bucket-level operation such as the HEAD probe. */
  key?: string;
  /** Sent with the request and signed with it — only a payload-bearing PUT has one. */
  contentType?: string;
  /** Raw payload bytes for a PUT; every other method signs the empty body. */
  body?: Uint8Array;
  /** Injectable only for a fixed-clock signature the tests can pin deterministically. */
  now?: Date;
}

export interface SignedR2Request {
  url: string;
  method: R2ApiMethod;
  headers: { authorization: string; "x-amz-content-sha256": string; "x-amz-date": string };
}

async function sign({
  method,
  bucket,
  key,
  contentType,
  body,
  credentials,
  amzDate,
  dateStamp,
}: Required<Pick<R2ApiRequest, "method" | "bucket">> &
  Pick<R2ApiRequest, "key" | "contentType" | "body"> & {
    credentials: R2Credentials;
    amzDate: string;
    dateStamp: string;
  }): Promise<SignedR2Request> {
  const host = `${credentials.account}.r2.cloudflarestorage.com`;
  const objectPath = key ? `/${bucket}/${key}` : `/${bucket}`;
  const payloadHash = body ? await sha256HexBytes(body) : EMPTY_SHA256;

  // The canonical header set is exactly what this request will carry, sorted
  // by name as SigV4 requires — a body-bearing request signs its content type
  // along with the common three, and everything else signs only those three.
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType !== undefined) headers["content-type"] = contentType;
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name]}`).join("\n") + "\n";
  const signedHeaders = headerNames.join(";");

  const canonicalRequest = [
    method,
    objectPath,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const region = "auto";
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(encoder.encode(`AWS4${credentials.secretAccessKey}`) as unknown as Uint8Array, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = [...await hmac(kSigning, stringToSign)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return {
    url: `https://${host}${objectPath}`,
    method,
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  };
}

/**
 * Signs one S3-API request against the configured bucket. Throws when the
 * runtime carries no credentials — the exception callers with a binding never
 * see, since they never sign.
 */
export async function signR2Request(request: R2ApiRequest): Promise<SignedR2Request> {
  const credentials = r2ApiCredentials();
  if (!credentials) throw new Error("Cloudflare R2 storage is not configured: missing R2_ACCOUNT_ID");
  const { amzDate, dateStamp } = amzDates(request.now ?? new Date());
  return sign({ ...request, credentials, amzDate, dateStamp });
}

/**
 * The bucket probe the health check uses on credential-only runtimes: a real
 * authenticated `HEAD` against the bucket itself, with the fixed request shape
 * its deterministic-signature tests pin.
 */
export async function signR2HeadRequest(bucket: string, now: Date = new Date()): Promise<SignedR2Request> {
  const credentials = r2ApiCredentials();
  if (!credentials) throw new Error("Cloudflare R2 signing is not configured");
  const { amzDate, dateStamp } = amzDates(now);
  return sign({ method: "HEAD", bucket, credentials, amzDate, dateStamp });
}

export type R2ProbeError = "unreachable";

export interface R2ProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: R2ProbeError;
}

/**
 * Real authenticated round-trip against the configured bucket through the S3
 * API: a signed `HEAD` request. Used where no platform binding exists (the
 * Node dev server and the scripts); a runtime that holds the `UPLOADS` binding
 * probes the binding instead, so the credentials are not needed there.
 * 200 means the bucket answers under the deployment's credentials — the
 * strongest public signal a health endpoint can give without touching any
 * object. Anything else, including a 403 for bad credentials and a fetch-level
 * failure, is one failure shape from outside: `unreachable`.
 */
export async function checkR2Bucket(bucket: string): Promise<R2ProbeResult> {
  const started = performance.now();
  try {
    const request = await signR2HeadRequest(bucket);
    const response = await fetch(request.url, { method: request.method, headers: request.headers });
    if (response.status === 200) {
      return { ok: true, latencyMs: Math.round(performance.now() - started) };
    }
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: "unreachable" };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: "unreachable" };
  }
}
