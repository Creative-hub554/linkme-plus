/**
 * Hosts the `next/image` shim is allowed to load remote images from.
 *
 * Cloudflare R2's managed public bucket host is `https://pub-<hash>.r2.dev`
 * (see `docs/DEPLOYMENT.md`); the hash varies per bucket and per environment,
 * so match any public dev subdomain. The previous entry here —
 * `**.r2.cloudflarestorage.com` — was the S3 *API* endpoint, which never serves
 * a public object, so it allowed nothing a real image URL would match.
 */
const remotePatterns = [{ protocol: "https", hostname: "**.r2.dev" }];

/**
 * A deployment can serve media from a custom domain instead of r2.dev. That
 * host is whatever `R2_PUBLIC_URL` points at, so derive it when it is present
 * at build time; it cannot be guessed from the account id, and an unlisted host
 * makes the shim drop the image in production.
 */
const publicUrl = process.env.R2_PUBLIC_URL;
if (publicUrl) {
  try {
    const { hostname } = new URL(publicUrl);
    if (hostname && !remotePatterns.some((pattern) => pattern.hostname === hostname)) {
      remotePatterns.push({ protocol: "https", hostname });
    }
  } catch {
    // A malformed R2_PUBLIC_URL is rejected at runtime by
    // `assertStorageConfigured`; it contributes no image pattern here.
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns,
  },
};

export default nextConfig;
