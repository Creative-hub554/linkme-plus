import "./src/lib/weak-ref-polyfill.ts";
import { defineConfig, loadEnv } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import { devWebSocketPlugin } from "./src/lib/realtime/dev-websocket.ts";

const weakRefRuntimeFallback =
  "globalThis.WeakRef ?? (globalThis.WeakRef = class WeakRefFallback { constructor(target) { this.target = target; } deref() { return this.target; } })";

const weakRefRscPlugin = {
  name: "weak-ref-rsc-polyfill",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.includes("@vitejs/plugin-rsc") || !code.includes("WeakRef")) return;

    return {
      code: `const WeakRef = ${weakRefRuntimeFallback};\n${code}`,
      map: null,
    };
  },
};

export default defineConfig(({ command, mode }) => {
  // The `/ws` door verifies session cookies in development too, so the dev
  // plugin is handed the Supabase coordinates explicitly from Vite's own env
  // loading — an explicit input rather than a question about which layer, if
  // any, happened to populate `process.env`.
  const env = loadEnv(mode, process.cwd(), ["NEXT_PUBLIC_"]);

  return {
    // The edge RSC bundle references WeakRef before the application layout is
    // evaluated. The transform makes the fallback local to that vendor module.
    define: {
      WeakRef: weakRefRuntimeFallback,
    },
    plugins: [
      weakRefRscPlugin,
      // The `/ws` door: this plugin answers it in development, where the
      // Durable Object that answers it in production does not exist. It registers
      // an upgrade listener and nothing else, so `command === "build"` carries it
      // without effect.
      devWebSocketPlugin({
        supabase: {
          supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
          supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        },
      }),
      vinext({
        images: { optimizer: imagesOptimizer() },
      }),
      // Cloudflare's edge runtime does not expose WeakRef, while Vinext's
      // development RSC client currently requires it. Keep local development
      // on Node and use the Cloudflare environment for the production build.
      // The deployment target is one configuration (wrangler.jsonc): the
      // default and the Sites-compatible build no longer diverge, so there is
      // no override to thread through.
      ...(command === "build"
        ? [
            cloudflare({
              viteEnvironment: {
                name: "rsc",
                childEnvironments: ["ssr"],
              },
            }),
          ]
        : []),
    ],
  };
});
