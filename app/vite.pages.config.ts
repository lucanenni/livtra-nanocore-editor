import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Build for GitHub Pages, served at https://<user>.github.io/livtra-nanocore-editor/ — a
 * project page, not a custom domain or a <user>.github.io repo, so asset URLs need the repo
 * name as a base path. Kept as a separate config (rather than adding `base` to the main
 * vite.config.ts) so `npm run dev` / `npm run build` are unaffected and still serve from `/`.
 * Built and deployed automatically by .github/workflows/pages.yml (actions/deploy-pages) on
 * every push to main — run `npm run build:pages` locally only to preview the output; it's not
 * meant to be deployed by hand.
 */
export default defineConfig({
  base: '/livtra-nanocore-editor/',
  plugins: [react()],
  build: {
    outDir: 'dist-pages',
  },
})
