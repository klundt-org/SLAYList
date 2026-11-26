// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bundles the transcoder into ONE self-contained ESM file (dist/index.mjs) with esbuild.
 *
 * Why bundle (Sprint 6.1): `@slaylist/shared` is a `workspace:*` package with no build of its own
 * (its `main` is a .ts file), and the Docker build context is `./transcoder` — so the image could
 * never resolve it at runtime. Bundling inlines shared + the Azure SDKs, so the image needs only
 * `node` + `ffmpeg` + this one file: no node_modules, no pnpm, no workspace in the container.
 * (Contrast the SWA API, which can't bundle without touching its fragile deploy pipeline — D46.)
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  legalComments: 'external', // third-party license headers -> dist/index.mjs.LEGAL.txt (shipped in the image)
  // Some bundled deps are CommonJS and call `require` for Node built-ins; give the ESM bundle one.
  banner: {
    js: "import { createRequire as __slayCreateRequire } from 'node:module'; const require = __slayCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
