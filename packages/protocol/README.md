# @nanocore/protocol

Everything about the Livtra NanoCore that doesn't need a browser:

- `src/data/` — the effect-block model (8 blocks, their types and parameters, CC numbers and ranges)
- `src/midi/` — the CC/SysEx protocol: frame builders and parsers, live-state and saved-state decoding,
  AMP/FX2 profile upload, value scaling, the `MidiTransport` interface
- `src/patch/` — patch state, defaults, validation, routing rules
- `src/device/` — `NanoCoreDevice`: send changes, read the current patch back (`readSnapshot` +
  `applySnapshotToPatch`), listen to the device's own pushes (`startLive`), save, rename, upload profiles —
  through any `MidiTransport`

It holds no browser APIs, so it runs in plain Node. The web editor (`../../app`) and the MCP server (`../mcp`)
are its two consumers; each brings its own transport (Web MIDI there, a Node MIDI library for the server).
The package is consumed as TypeScript source (`exports` point at `src/`), no build step.

```bash
npm test                 # from the repository root: runs every workspace's tests
npm run typecheck        # tsc over this package
```

The protocol itself is documented in [`docs/MIDI_MAPPING_NOTES.md`](../../docs/MIDI_MAPPING_NOTES.md).
