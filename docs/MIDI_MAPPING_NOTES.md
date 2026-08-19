# MIDI mapping notes — assumptions & open questions

This editor's parameter map is built directly from `NANOCORE-User-Manual.pdf` and
`NANOCORE-MIDI-Control-User-Guide.pdf` (firmware 1.04+, both fetched from
openparcelbox.com and archived in `docs/`). Both documents are precise about CC
*numbers*, but neither states exactly how a real-world range (e.g. "-100.0~0.0 dB")
is expected to map onto the raw MIDI 0-127 value beyond this general rule from the
MIDI guide's "Value rules" table:

> Parameter: 0-127. Lowest to highest value.

The editor therefore assumes **linear scaling**: CC value 0 → the documented
minimum, CC value 127 → the documented maximum, for every parameter CC. This
is the standard convention, and hardware testing (`docs/HARDWARE_VERIFICATION.md`,
now complete) confirmed it holds across every parameter "shape" checked (dB,
ms, ratio, index, semitones, Hz). If a future firmware update changes
behavior, re-run that checklist and adjust `app/src/data/blocks/*.ts` as needed.

## Confirmed against real hardware (firmware 1.04+)

Findings from working through `HARDWARE_VERIFICATION.md` with an actual
NanoCore, most recent first:

- **REV Spring/Shimmer/Cloud (ids 4-6) were in the wrong order.** `rev.ts` had
  followed the user manual's plain listing order (Room, Plate, Hall, Concert,
  **Spring, Shimmer, Cloud** → ids 4/5/6), but the MIDI guide's own "Reverb
  quick check" callout is explicit and disagrees: "CC47: 4=Shimmer, 5=Cloud,
  6=Spring". Confirmed wrong on hardware as a clean 3-way rotation (selecting
  Cloud in the editor loaded Spring on the device, Spring loaded Shimmer,
  Shimmer loaded Cloud) — exactly what you'd see from using the wrong id
  order. Fixed to match the MIDI guide's table: id 4=Shimmer, 5=Cloud,
  6=Spring. **Lesson for the rest of the data model:** where the MIDI guide
  gives an explicit id table, trust it over inferring order from the manual's
  prose listing — AMP and CAB have no such explicit table in either document,
  which is now a live open question (see below).
- **CAB `level` (CC67) does nothing.** Confirmed on-device: Low Cut (CC65) and
  High Cut (CC66) both work correctly over MIDI, Level does not — moving it
  produces no audible or on-screen change. This matches the fact that the
  manual's CAB "Common Parameters" list never mentioned a Level parameter to
  begin with (only the MIDI guide's CC map did). **Removed from the editor
  entirely** (`cab.ts`'s `commonParams` no longer includes it) rather than
  shipping a control that does nothing when moved.
- **FX2 Envelope Wah `level` (CC72) does nothing**, same story: Freq/Env/Q/Mix
  (CC68-71) were all confirmed to update live on-device, Level did not exist
  as a parameter on-screen at all. **Removed from the editor.** Freq/Env/Q/Mix
  being confirmed live also means the CC68-73 ↔ MOD routing-conflict rule is
  real and observable, not just a documented claim.
- **The editor never reflects the device's actual current values** until you
  touch a control (by design — see "Not controllable via documented MIDI CC"
  below, no SysEx readback exists). Confirmed in practice: selecting a new
  type shows the editor's own guessed defaults, not whatever the device
  already had loaded, until a CC is actually sent for that parameter.
- **On/off and type-select confirmed working device-wide**, except AMP/CAB
  type (see the SysEx finding above). REV's type order was wrong (fixed,
  above); FX1/FX2/MOD/DEL/EQ were all already correct.
- **LFO waveform enum bucketing confirmed correct.** The editor's guess (four
  equal CC ranges: 0-31=Sine, 32-63=Triangle, 64-95=Square, 96-127=Saw, in
  `enumIndexToCC`/`ccToEnumIndex`, `midi/scaling.ts`) matches hardware for
  both Tremolo and Vibrato — all four waveforms switch correctly.
- **FX2 Envelope Wah and Wah `freq` (CC68) ranges both confirmed real.**
  Audible sweep test (sustained note/picking dynamics while sweeping
  end-to-end) for both types: the wah stayed musical across the whole
  slider, no dead zone, in each case. The manual's literal "10.0~20kHz"
  (Envelope Wah) and "163~3.5kHz" (Wah) are both correct, not typos — kept
  as-is, `note` fields removed from both.
- **Program Change preset recall has a +1 display offset.** Confirmed on
  hardware: the device's own preset display is 1 higher than the PC value
  sent (PC 0 → device "1", PC 5 → device "6"), matching the manual's
  documented "1-128 display, PC 0-127, device preset = displayed number
  minus 1" convention. Documented in the app itself (recall panel hint +
  `preset_recall`'s description in `nanocoreSpec.ts`).
- **Tuner, Prev/Next preset, and `sendFullPatch` all confirmed working.**
  `sendFullPatch` is also authoritative/idempotent — re-syncs the device
  correctly even after individually-sent live parameter changes or direct
  on-device edits.
- **Bluetooth: confirmed working, including from macOS — the earlier pairing
  failures were the phone app, not a platform bug.** Full diagnosis, in the
  order it was found:
  - The NanoCore's BLE-MIDI peripheral stops advertising itself after a
    while — it only becomes discoverable again right after toggling
    Bluetooth off/on **on the device itself**. Not mentioned in either
    source document.
  - An MVave Chocolate+ BLE-MIDI footswitch connects to it directly and
    successfully exchanges MIDI messages, confirming the NanoCore's
    BLE-MIDI peripheral implementation works.
  - macOS's own Bluetooth MIDI pairing (Audio MIDI Setup → MIDI Studio →
    Bluetooth) could *see* the NanoCore after the toggle trick, but pairing
    kept silently failing right as it was attempted. Root cause: the
    official Livtra **phone app** had force-paired with the device, and was
    re-claiming the connection every time Bluetooth was toggled on the
    NanoCore — so by the time macOS tried to connect, the phone had already
    grabbed it. Not a CoreBluetooth/macOS bug at all.
  - With the phone app not contending for the connection, **macOS pairing
    (Audio MIDI Setup) works fine**, and the NanoCore then shows up as a
    normal MIDI port — reachable from this editor's Web MIDI transport
    exactly like the USB connection, no code changes needed on our end
    (Web MIDI doesn't distinguish transports once the OS exposes the port).
  - **Practical upshot:** both USB and Bluetooth work. For Bluetooth: make
    sure nothing else (especially the official phone app) is already
    holding the connection, toggle Bluetooth off/on on the NanoCore to wake
    its advertising, then pair via the OS's own Bluetooth MIDI setup (on
    macOS: Audio MIDI Setup → MIDI Studio → Bluetooth) — after that it's a
    normal port, selectable in this editor's Output list under Web MIDI.
  - **Added a second, more direct path**: a `Bluetooth` transport
    (`midi/bleMidiTransport.ts`) that connects straight from the page via
    the Web Bluetooth API — `navigator.bluetooth.requestDevice()` filtered
    to the standard BLE-MIDI service UUID, then a normal GATT
    connect/write, encoding raw MIDI bytes into BLE-MIDI's
    header+timestamp packet framing (`midi/bleMidiPacket.ts`). Skips the
    OS-level pairing step entirely; same toggle-Bluetooth-on-device and
    "nothing else holding the connection" caveats apply, since those are
    properties of the NanoCore's BLE peripheral, not of which central
    connects to it.

## Open problem: AMP and CAB type switching (under investigation)

On real hardware, changing AMP or CAB **on/off** (CC23/24) works, but changing
**type** (CC43/44) does not — the model shown/heard on the device doesn't
change at all when a different one is picked in the editor. This is different
in kind from the REV ordering bug above (which changed to the *wrong* model,
proving the CC reaches the device) — here nothing happens, which could mean:

- The exact type-id-to-model mapping is wrong in a way that doesn't produce a
  visible "wrong model" (e.g. if the device silently ignores out-of-range or
  unrecognized ids — neither document actually publishes an explicit AMP/CAB
  id table like the one REV/FX1/FX2/MOD/DEL have; `amp.ts`/`cab.ts`'s id order
  is only ever inferred from the manual's 1-30/2-30/.../30-30 prose listing,
  the same kind of inference that was wrong for REV).
- AMP/CAB model switching genuinely isn't supported over MIDI on this
  firmware, despite CC43/44 being documented — profile/IR loading may not be
  wired up to real-time CC handling the way lighter DSP-mode switches are.
- Something more specific to how the device handles CC43/44 that isn't
  documented at all.

**Update:** confirmed via the MIDI Activity log that CC43 *is* being sent
with the correct value when changing AMP type — this isn't a send-side bug.
Separately, the user observed that Livtra's own official companion app sends
SysEx messages on every parameter change (and possibly periodically too),
while the MIDI Control User Guide only documents CC/PC. That's consistent
with AMP/CAB model selection being a SysEx-only operation on this firmware —
plausible if profile/IR loading needs more addressing/data than a plain CC
carries, unlike the lighter DSP-mode switches (Gate type, Chorus type, etc.)
that *do* respond to their documented CCs. **Not pursued further for now** —
reverse-engineering an undocumented SysEx protocol is out of scope for this
pass (this project's whole premise was working from Livtra's own documented
CC protocol, not probing an undocumented one); revisit only if AMP/CAB model
selection via MIDI turns out to matter enough to justify that effort.

Other assumptions, called out with a `note` field on the relevant param/type in
the data model, still awaiting hardware confirmation:

- **FX2 Wah `freq` (CC68)**: manual prints "163~3.5kHz" (missing a decimal
  point/unit on the lower bound). Encoded as 163 Hz–3500 Hz.
- **MOD `chorus` params (CC68-70)**: the manual's effect list only describes
  Rate and Depth for Chorus, but the MIDI guide's per-type CC table allocates
  three CCs (Rate/Depth/Level). A `level` (0-100) param was added on CC70 to
  match the CC table.
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
