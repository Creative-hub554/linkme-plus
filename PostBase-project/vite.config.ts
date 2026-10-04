import "./src/lib/weak-ref-polyfill.ts";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

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

export default defineConfig(({ command }) => ({
  // The edge RSC bundle references WeakRef before the application layout is
  // evaluated. The transform makes the fallback local to that vendor module.
  define: {
    WeakRef: weakRefRuntimeFallback,
  },
  plugins: [weakRefRscPlugin,
    vinext({
      images: { optimizer: imagesOptimizer() },
    }),
    // Cloudflare's edge runtime does not expose WeakRef, while Vinext's
    // development RSC client currently requires it. Keep local development
    // on Node and use the Cloudflare environment for the production build.
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
}));
