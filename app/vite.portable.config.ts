import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { inlineFavicon } from './vite.inlineFavicon.ts'

/**
 * Produces the "portable" build: a single self-contained HTML file (JS + CSS + the SVG
 * favicon all inlined, zero external requests) meant to be downloaded and opened directly —
 * double-click it, or drop it on a USB stick, a static file server, GitHub Pages, anywhere.
 * No `npm install`, no build step for the end user, just a browser. This is the same idea as
 * suckyble/PocketEdit's single-`index.html` distribution.
 *
 * Unlike `vite.artifact.config.ts` (built for embedding inside a sandboxed Claude Artifact
 * iframe, where real Web MIDI hardware access is unreliable), this file is meant to be opened
 * as a plain local file or hosted normally — both are full secure contexts in Chromium browsers,
 * so real Web MIDI works here exactly as it does with `npm run build` / `npm run dev`. The
 * Simulator transport also works fully offline, no device required.
 *
 * Run with `npm run build:portable`; output is `dist-portable/nanocore-editor-portable.html`.
 */
export default defineConfig({
  base: './',
  // Nothing under public/ (just favicon.svg) needs to survive as a standalone file — the
  // inlineFavicon plugin embeds it as a data URI instead, so skip copying it in and keep the
  // output to exactly one file.
  publicDir: false,
  plugins: [react(), inlineFavicon(), viteSingleFile()],
  build: {
    outDir: 'dist-portable',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
})
