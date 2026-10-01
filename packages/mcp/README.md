# @nanocore/mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant work on a Livtra NanoCore
directly: read what the pedal is playing, change effects and parameters, reorder the chain, rename and
save presets, change the global settings, and load AMP/FX2 profiles — over USB MIDI, through the same
protocol layer as the web editor (`@nanocore/protocol`).

**Status:** verified on a real NanoCore over USB (2026-10-01): connect and patch/global-settings reads, parameter and block edits read back from a fresh connection, chain reorder and AMP model change confirmed on the pedal's display, preset recall, and `save_to_slot` (rename + edit saved to a slot, then recalled from a fresh connection). Also tested end to end against a scripted pedal that replays real captured frames. `upload_profile` too (a `.ead` into slot 30: the 199 requests are byte-identical to the official app's, every reply status 0, the catalog shows the new name). Also over Bluetooth (the pedal paired in Audio MIDI Setup): the same reads, edits and upload work; the device splits its replies into segments there, which the protocol layer reassembles (see `docs/MIDI_MAPPING_NOTES.md`). An upload takes about 17 s that way.

Unofficial, like the rest of this repository. It talks to the pedal with SysEx and CC, the way the
official app does.

## Use it

```bash
npm install                  # once, at the repository root
npm run build:mcp            # -> packages/mcp/dist/index.js (one self-contained file)
```

Register it with your MCP client. For Claude Code:

```bash
claude mcp add nanocore -- node /absolute/path/to/livtra-nanocore-editor/packages/mcp/dist/index.js
```

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nanocore": {
      "command": "node",
      "args": ["/absolute/path/to/livtra-nanocore-editor/packages/mcp/dist/index.js"]
    }
  }
}
```

Plug the NanoCore in over USB and **close the official ToneCommand app** — only one app can hold the pedal
at a time. Then ask the assistant to connect.

## Tools

| Tool | What it does |
| --- | --- |
| `list_midi_ports` | MIDI ports on this computer |
| `connect` / `disconnect` | Connect to the pedal (port named "Nanocore") and read its patch / release it |
| `get_patch` | The live patch: preset number and name, chain order, every block's on/off, effect type and parameters in real units |
| `describe_block` | Every effect type of a block with its parameters, units, ranges and options |
| `set_block` | Block on/off and/or effect type (by name) |
| `set_param` | One parameter, by label, in real units (or an option name) |
| `set_chain_order` | Order of the 8 blocks |
| `rename_patch` | Rename the live patch (8 characters) |
| `recall_preset` | Load preset 1-128 |
| `save_to_slot` | Save the live patch into preset 1-64 — **overwrites**, needs `confirm: true` |
| `get_global_settings` / `set_global_setting` | Wireless, loopback, input gain, USB/BT volume, MIDI channel |
| `list_profiles` | The 38 AMP/FX2 profile slots and their names |
| `upload_profile` | Load a local `.ead` file into a profile slot — **overwrites**, needs `confirm: true` |

Edits are **live**: like turning a knob on the pedal, they are lost at the next preset change until
`save_to_slot` keeps them. Tools that overwrite stored data are marked destructive and require an explicit
`confirm`, so a client can ask before they run.

## Limits worth knowing

- The pedal cannot report an AMP or CAB model, or the chain order, when changed but not saved. The server
  remembers what it set and shows that, until the preset changes; after a reconnect it shows the saved values.
- Preset numbers are the ones the pedal's display shows (1-based).
- Over Bluetooth, pair the NanoCore in Audio MIDI Setup first (toggle Bluetooth off/on on the pedal to wake its advertising, and make sure the phone app is not holding it); it then shows up as a normal MIDI port. Everything is slower there — an upload takes ~17 s.
- The server has no way to hear the pedal's audio. It changes settings; judging the sound is up to you.

## Development

```bash
npm test --workspace packages/mcp      # tools exercised end to end (in-memory MCP client) against a scripted pedal
npm run typecheck --workspace packages/mcp
```

`src/nodeMidiTransport.ts` is the Node transport (RtMidi via `@julusian/midi`), `src/session.ts` holds the
connection and the server's picture of the patch, `src/tools.ts` the tool definitions. The protocol itself
lives in `../protocol` and is documented in [`docs/MIDI_MAPPING_NOTES.md`](../../docs/MIDI_MAPPING_NOTES.md).
