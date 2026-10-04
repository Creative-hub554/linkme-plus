import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Flat config for Next 15. `eslint-config-next` still ships eslintrc-style
 * shareable configs, so they are bridged through `FlatCompat`.
 *
 * Global ignores: build output and machine-generated declaration files, which
 * would otherwise be linted (and fail) when `eslint .` walks the tree.
 */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".vinext/**",
      ".wrangler/**",
      "dist/**",
      "node_modules/**",
      "next-env.d.ts",
      "worker-configuration.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Back to an error now that every pre-existing site has been typed: the
      // loosely-typed payloads use `unknown` plus narrowing, or a small
      // interface describing the request body. Keep new `any`s out.
      "@typescript-eslint/no-explicit-any": "error",
      // A `_`-prefixed name is a deliberate unused binding — a parameter kept
      // for signature symmetry, or a destructured field kept for shape.
      // Anywhere else an unused binding is a real finding.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Off, deliberately, rather than converted to `next/image`. vinext's
      // `next/image` shim (node_modules/vinext/dist/shims/image.js) only routes
      // *local* sources (starting with `/`) through the Cloudflare Images
      // optimizer, and this app has no `public/` directory to hold any:
      //   - A remote URL matching `images.remotePatterns` renders as a plain
      //     `<img>` under `fill`, and through `@unpic/react` under width/height —
      //     and `*.r2.dev` is not a transform-capable CDN, so neither is
      //     optimized. The `/_next/image` + `imagesOptimizer()` path never runs
      //     for these images.
      //   - A remote URL that does *not* match a pattern makes the shim `return
      //     null` in production, so the image disappears. Seeded content stores
      //     arbitrary external URLs (`post_media.url` "is whatever `POST
      //     /api/posts` was handed"), which no allowlist can cover.
      //   - Local previews are `blob:`/`data:` URLs (file-upload and post-composer
      //     object URLs, Cover Studio's canvas, the TOTP QR code). The shim does
      //     not treat those as remote, so it would send them to `/_next/image`,
      //     which rejects a url that does not start with `/`.
      //   - `MediaImage` in `src/components/ui/media.tsx` is a deliberate `<img>`
      //     that records which source failed and offers an opt-in fallback; with
      //     no `public/` there is no default placeholder to fall back to.
      // `next.config.mjs` lists the real R2 public host (`**.r2.dev`, plus the
      // `R2_PUBLIC_URL` host when it is set at build time), so a future
      // `next/image` use is allowed — but converting today would change nothing
      // visually while risking blank images. One documented rule-off beats
      // eighteen identical `eslint-disable` comments.
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
