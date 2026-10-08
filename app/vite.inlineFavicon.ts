import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * vite-plugin-singlefile inlines JS/CSS but leaves `<link rel="icon" href="/favicon.svg">`
 * pointing at a separate file — fine for the normal deployed build, but it breaks the whole
 * point of the portable/artifact builds (a single file with zero external requests): opened
 * standalone (e.g. from a GitHub Release asset, or a `file://` double-click), the favicon
 * would 404 and the browser would issue a request the "single file" promise says shouldn't
 * exist. This inlines it as a `data:` URI instead, for real single-file output.
 */
export function inlineFavicon(): Plugin {
  return {
    name: 'inline-favicon',
    enforce: 'post',
    transformIndexHtml(html) {
      const appDir = path.dirname(fileURLToPath(import.meta.url))
      const svg = readFileSync(path.join(appDir, 'public/favicon.svg'), 'utf-8')
      const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
      // Vite rewrites the favicon href against `base` before this hook sees it (e.g. to
      // "/favicon.svg" or "./favicon.svg" depending on config), so match either form rather
      // than a single literal path.
      return html.replace(/href="\.?\/favicon\.svg"/, `href="${dataUri}"`)
    },
  }
}
