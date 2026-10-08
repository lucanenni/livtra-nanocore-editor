# NanoCore Editor — app

This is the Vite + React + TypeScript app. See the [project README](../README.md)
for what this is, how the MIDI mapping was derived, and the overall architecture.

The MIDI protocol, spec data and device layer live in
[`packages/protocol`](../packages/protocol) (workspace package `@nanocore/protocol`);
this app is the browser UI and the Web MIDI / Bluetooth / Simulator transports.

```bash
npm install             # at the repository root (npm workspaces)
npm run dev             # start the dev server
npm run build           # production build -> dist/
npm run build:portable  # single-file portable build -> dist-portable/
npm run lint            # oxlint
```

See the project README's [Portable version](../README.md#portable-version-single-html-file)
section for what the portable build is for.
