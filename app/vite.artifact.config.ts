import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { inlineFavicon } from './vite.inlineFavicon.ts'

/**
 * Produces a single self-contained HTML file (JS + CSS inlined, no external requests) for
 * publishing as a Claude Artifact — useful to try the editor (Simulator mode) from a phone or
 * share a link before real hardware is available. Real Web MIDI hardware access may be blocked
 * by the artifact iframe's sandbox; the normal `npm run build` output is the one to actually
 * deploy for hardware use. Run with `npm run build:artifact`.
 */
export default defineConfig({
  // Nothing under public/ (just favicon.svg) needs to survive as a standalone file — the
  // inlineFavicon plugin embeds it as a data URI instead, so skip copying it in and keep the
  // output to exactly one file.
  publicDir: false,
  plugins: [react(), inlineFavicon(), viteSingleFile()],
  build: {
    outDir: 'dist-artifact',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
})
