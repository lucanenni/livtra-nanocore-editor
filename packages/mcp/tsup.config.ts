import { defineConfig } from 'tsup';

// One self-contained file: the workspace package is TypeScript source, so it is bundled in; the
// SDK, zod and the native MIDI binding stay external (installed alongside).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  noExternal: ['@nanocore/protocol'],
  banner: { js: '#!/usr/bin/env node' },
});
