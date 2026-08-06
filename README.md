# NanoCore Editor

An unofficial, browser-based editor for the **Livtra NanoCore** mini multi-effect
processor. Build a patch — 8 effect blocks, each with its own type and
parameters — and push it live to the device over MIDI, straight from a static
web page. No install, no backend.

Built ahead of owning the hardware: everything can be exercised end-to-end
today via a built-in **Simulator** transport, and switched to real **Web MIDI**
the moment a NanoCore is plugged in.

## Status

The device is not in hand yet, so nothing here has been confirmed against real
hardware. The parameter map (CC numbers, on/off conventions, type IDs) is taken
directly from Livtra's own PDFs; the exact 0-127 ↔ real-world-range scaling is
an documented-but-unverified convention. See
[`docs/MIDI_MAPPING_NOTES.md`](docs/MIDI_MAPPING_NOTES.md) for the full list of
assumptions and known gaps (chain reordering, global settings, tuner reference
pitch — none of which have a documented CC).

**When hardware arrives:** connect via USB, pick "Web MIDI" in the connection
panel, select the NanoCore's port, set the channel to match the device, and
sweep a few parameters while watching the actual sound/display — then fix up
any range in `app/src/data/blocks/*.ts` that doesn't match, and remove the
caveat from `MIDI_MAPPING_NOTES.md`.

## Source material

- `docs/NANOCORE-User-Manual.pdf` — effect descriptions & real-world parameter ranges
- `docs/NANOCORE-MIDI-Control-User-Guide.pdf` — CC numbers & value rules
- `docs/manual.txt`, `docs/midi.txt` — extracted plain text of the above, handy for diffing against future firmware/manual revisions
- `docs/MIDI_MAPPING_NOTES.md` — assumptions made while turning those PDFs into code

## Running it

```bash
cd app
npm install
npm run dev
```

Open the printed localhost URL. The app defaults to the **Simulator**
transport so it's fully usable without a device — every control still "sends"
a MIDI-shaped message, visible (with a human-readable description) in the
**MIDI Activity** tab.

To build a static bundle for hosting anywhere (GitHub Pages, Netlify, a plain
file server…):

```bash
npm run build   # outputs to app/dist
```

Web MIDI (the real hardware path) needs a Chromium-based browser (Chrome,
Edge, Opera, …) and — outside of `localhost` — HTTPS, per the Web MIDI API spec.

## How it's organized

```
app/src/
  data/            NanoCore spec: 8 blocks × effect types × parameters,
                    encoded from the two PDFs (data/blocks/*.ts)
  midi/            Web MIDI + Simulator transports behind one interface,
                    plus the CC↔real-value scaling helpers
  store/           zustand store: current patch, MIDI connection state,
                    activity log, local preset library
  components/      the editor UI
  i18n/            react-i18next setup; en.json is the reference locale
```

**Send-only, by design.** The MIDI guide documents no way to read a patch back
off the device (no SysEx dump), so the editor doesn't try to pretend otherwise:
you build a patch here and push it out with **Send patch to device**, or ask
the device to recall one of its own stored presets with Program Change. What
you build in the editor and what's live on the hardware can only be kept in
sync by convention, not by feedback.

**Local preset library.** Since there's no readback, "presets" in this editor
are just named patches saved in the browser's `localStorage`
(`Presets → Save as new preset`), exportable/importable as JSON so they survive
a cleared cache or move between machines. Pushing a preset to the device edits
its *current* live patch; saving it into one of the device's own 64 slots is
still a manual step on the hardware itself (long-press MASTER, per the manual).

## Translations

The UI is built to be translated from the start via `react-i18next`.
`app/src/i18n/locales/en.json` is the reference; `it.json` ships a full
translation of the interface chrome as a working example. Effect/parameter
names and descriptions (hundreds of strings pulled straight from the manual)
aren't duplicated into every locale file — they're looked up as
`t(key, englishDefault)`, so English always works even for keys a locale
hasn't translated yet. To add a language, copy `en.json`, translate its
values, register it in `app/src/i18n/index.ts`, and add it to
`SUPPORTED_LANGUAGES`; translating the data-driven content is optional and
incremental (add matching `type.*` / `param.*` keys as you go).

## Deploying (e.g. GitHub Pages)

The repo is local-only for now. When you're ready to publish:

```bash
cd app
npm run build          # -> app/dist/
```

`app/dist/` is a static site — drop it on any static host. For **GitHub Pages**
specifically:

1. Push this repo to GitHub.
2. If the Pages site will live at `https://<user>.github.io/<repo>/` (a
   project page, not a custom domain or a `<user>.github.io` repo), add
   `base: '/<repo>/'` to the `defineConfig({...})` in `app/vite.config.ts`
   before building — otherwise the bundled asset paths will 404.
3. Either commit `app/dist/` to a `gh-pages` branch and enable Pages on that
   branch in the repo settings, or use the `gh-pages` npm package
   (`npm i -D gh-pages`, add a `"deploy": "gh-pages -d dist"` script, `npm run
   build && npm run deploy`) — no GitHub Actions/paid plan required, Pages is
   free on public repos.

Note: **Web MIDI needs HTTPS** (except on `localhost`) — GitHub Pages serves
over HTTPS by default, so hardware connection will work fine there once you
have a NanoCore to test against.

There's also a self-contained single-file build for quick, no-hosting-needed
sharing/testing (e.g. as a Claude Artifact) — `npm run build:artifact` outputs
`app/dist-artifact/index.html` with all JS/CSS inlined. Note this path is best
for exercising the Simulator; the artifact sandbox's iframe may block real Web
MIDI hardware access, so use the regular deployed build (or `npm run dev`)
once actual hardware is involved.

## Known limitations (see MIDI_MAPPING_NOTES.md for detail)

- Effect chain **reorder** isn't exposed via MIDI — order is fixed in the editor.
- **Global settings** (loopback, input gain, USB/BT volume, MIDI channel,
  tuner reference pitch) have no documented CC — they're shown as a reference
  scratchpad only, never transmitted.
- CC68-73 are **shared** between MOD and FX2's Pitch/Envelope Wah/Wah types;
  the editor warns when this conflict is live in the current patch.

## License

[MIT](LICENSE) — this is an unofficial, independent project and isn't
affiliated with or endorsed by Livtra. "NanoCore" and any product names
referenced are trademarks of their respective owners; see the trademark
statement on the last page of `docs/NANOCORE-User-Manual.pdf`.
