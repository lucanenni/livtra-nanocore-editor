# MIDI mapping notes — assumptions & open questions

This editor's parameter map is built directly from `NANOCORE-User-Manual.pdf` and
`NANOCORE-MIDI-Control-User-Guide.pdf` (firmware 1.04+, both fetched from
openparcelbox.com and archived in `docs/`). Both documents are precise about CC
*numbers*, but neither states exactly how a real-world range (e.g. "-100.0~0.0 dB")
is expected to map onto the raw MIDI 0-127 value beyond this general rule from the
MIDI guide's "Value rules" table:

> Parameter: 0-127. Lowest to highest value.

The editor therefore assumes **linear scaling**: CC value 0 → the documented
minimum, CC value 127 → the documented maximum, for every parameter CC. This is
the standard convention and is very likely correct, but it is *unverified*
against real hardware. Once a NanoCore unit is available, sweep each parameter
0→127 and confirm the audible/displayed range matches; adjust
`app/src/data/blocks/*.ts` if not.

Other assumptions, called out with a `note` field on the relevant param/type in
the data model:

- **FX2 Envelope Wah `freq` (CC68)**: manual literally prints "10.0~20kHz" for
  this parameter. That is an unusually high base frequency for an envelope
  filter; it may be a manual typo for "10.0~2.0kHz" or similar. Encoded verbatim
  as 10 Hz–20 kHz pending hardware confirmation.
- **FX2 Wah `freq` (CC68)**: manual prints "163~3.5kHz" (missing a decimal
  point/unit on the lower bound). Encoded as 163 Hz–3500 Hz.
- **CAB `level` (CC67)**: listed in the MIDI guide's CC map ("Cab Level") but
  absent from the manual's CAB "Common Parameters" list (which only mentions Low
  Cut / High Cut). Assumed range 0-100.
- **MOD `chorus` params (CC68-70)**: the manual's effect list only describes
  Rate and Depth for Chorus, but the MIDI guide's per-type CC table allocates
  three CCs (Rate/Depth/Level). A `level` (0-100) param was added on CC70 to
  match the CC table.
- **LFO waveform enums** (`wave` param on Tremolo/Vibrato): the manual names four
  options (Sine/Triangle/Square/Saw) but no document states how they map across
  CC 0-127. The editor divides the range into four equal buckets
  (0-31=Sine, 32-63=Triangle, 64-95=Square, 96-127=Saw). Verify against hardware.
- **Editor-assigned default values**: neither document states factory/reset
  defaults for individual parameters. The `default` on each param in the data
  model is an editor convention (usually mid-range or a musically sane value),
  not a manufacturer-specified default.

## Not controllable via documented MIDI CC

- **Effect chain reordering.** The manual describes a device-side "Effect Chain"
  screen where the physical signal order of the 8 blocks can be rearranged, but
  no CC or SysEx for this is documented. The editor treats chain order as
  fixed/informational and cannot transmit a reorder — it must be done on the
  device itself.
- **Global settings** (Loopback, Input Gain, USB/BT Volume, MIDI Channel,
  firmware info) are configured on-device or via the official companion app;
  none has a documented CC. The editor shows them as read-only reference fields
  you set to match your hardware, not as transmittable controls.
- **Tuner reference pitch** (400-480 Hz, default 440 Hz) — only CC80 (tuner
  on/off) is documented; the reference-pitch value itself has no known CC.
- **Reading the device's current patch back into the editor.** No SysEx dump/
  request is documented, so the editor is send-only: it cannot query what's
  currently active on the hardware. Preset "recall" via Program Change changes
  what the device is playing, but the editor has no way to learn the resulting
  parameter values — you're expected to build the patch in the editor and push
  it out.

## Routing conflicts to be aware of

- **CC68-73** are shared between the **MOD** block and **FX2**'s Pitch /
  Envelope Wah / Wah types. Per the MIDI guide: "When FX2 type is 8, 9 or 10,
  [CC68-73] control FX2 Pitch/Wah instead [of MOD]." If FX2 is set to one of
  those three types *and* MOD is also enabled, sending MOD parameter CCs will
  actually alter the FX2 effect instead. The editor surfaces a warning banner
  when this condition is detected in the current patch.
- **CC22/42** and **CC29/49** are explicitly documented as unused/ignored by the
  device. Given the spec sheet's "Max 8+1 effect modules" line, these are most
  likely reserved for a 9th block not yet exposed by firmware 1.04.

## Source documents

- `docs/NANOCORE-User-Manual.pdf` — https://openparcelbox.com/manuals/NANOCORE-User-Manual.pdf
- `docs/NANOCORE-MIDI-Control-User-Guide.pdf` — https://openparcelbox.com/manuals/NANOCORE-MIDI-Control-User-Guide.pdf
- Extracted plain text (for diffing against future firmware/manual revisions):
  `docs/manual.txt`, `docs/midi.txt`
