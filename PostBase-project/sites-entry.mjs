// Freebuff Sites runs the Worker before its asset router, but the vinext
// build targets an assets-first runtime: its fetch handler only reaches
// `env.ASSETS` for image-optimization URLs and leaves direct `/_next/*`
// (and other file-like) requests to its app router, which then 404s them.
// This entry wraps the built worker with the behavior the platform expects:
// file-ish requests try the asset store first and only fall back to the app
// worker when no asset matches, so SSR routes, /api/*, /ws and scheduled jobs
// are untouched.
import inner, { WebSocketRoom } from "./dist/server/index.js";

export { WebSocketRoom };

const FILE_PREFIXES = [`/_next/`];
const FILE_EXACT = new Set([`/vinext-client-entry-manifest.json`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`]);

function looksLikeFile(pathname) {
  const last = pathname.slice(pathname.lastIndexOf(`/`) + 1);
  return last.includes(`.`) && last !== ``;
}

// The named binding keeps the entry's own conventions lintable (the default
// export is a real object, not an anonymous one), and nothing else imports it.
const sitesEntry = {
  async fetch(request, env, ctx) {
    if (env.ASSETS) {
      const method = request.method;
      const url = new URL(request.url);
      const pathname = url.pathname;
      if ((method === `GET` || method === `HEAD`) && (FILE_PREFIXES.some((p) => pathname.startsWith(p)) || looksLikeFile(pathname) || FILE_EXACT.has(pathname))) {
        const assetResponse = await env.ASSETS.fetch(new Request(request.url, request));
        if (assetResponse.status !== 404) return assetResponse;
      }
    }
    return inner.fetch(request, env, ctx);
  },
};

export default sitesEntry;
