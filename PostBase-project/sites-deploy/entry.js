// Freebuff Sites serves the deployed asset tree through the reserved ASSETS
// binding, and asset-first routing is what keeps native asset semantics (cache
// headers, redirects) working. This entry mirrors the platform's own OpenNext
// entry shape: file-ish GET/HEAD requests try ASSETS first, and only an
// unmatched 404 falls through to the vinext worker — SSR routes, /api/*, /ws
// and scheduled jobs are untouched.
import worker, { WebSocketRoom } from "./vinext-worker.js";

export { WebSocketRoom };

const FILE_PREFIXES = [`/_next/`, `/_vinext/`];
const FILE_EXACT = new Set([
  `/vinext-client-entry-manifest.json`,
  `/favicon.ico`,
  `/robots.txt`,
  `/sitemap.xml`,
]);

function looksLikeFile(pathname) {
  const last = pathname.slice(pathname.lastIndexOf(`/`) + 1);
  return last.includes(`.`) && last !== ``;
}

export default {
  async fetch(request, env, ctx) {
    if (env.ASSETS) {
      const method = request.method;
      const url = new URL(request.url);
      const pathname = url.pathname;
      if (
        (method === `GET` || method === `HEAD`) &&
        (FILE_PREFIXES.some((p) => pathname.startsWith(p)) || looksLikeFile(pathname) || FILE_EXACT.has(pathname))
      ) {
        const assetResponse = await env.ASSETS.fetch(new Request(request.url, request));
        if (assetResponse.status !== 404) return assetResponse;
      }
    }
    return worker.fetch(request, env, ctx);
  },
};
