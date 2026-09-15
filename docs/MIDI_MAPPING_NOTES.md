# MIDI mapping notes — assumptions & open questions

This editor's parameter map is built directly from Livtra's **NANOCORE User
Manual** and **NANOCORE MIDI Control User Guide** (firmware 1.04+, both fetched
from openparcelbox.com — see the README for the URLs; they're Livtra's to
publish, not vendored here). Both documents are precise about CC
*numbers*, but neither states exactly how a real-world range (e.g. "-100.0~0.0 dB")
is expected to map onto the raw MIDI 0-127 value beyond this general rule from the
MIDI guide's "Value rules" table:

> Parameter: 0-127. Lowest to highest value.

The editor therefore assumed **linear scaling** by default: CC value 0 → the
documented minimum, CC value 127 → the documented maximum. `docs/HARDWARE_VERIFICATION.md`'s
initial spot-check (one param per unit "shape") found this held for the shapes it tried, but a
later exhaustive per-param pass (`docs/PARAM_VERIFICATION.md`, 2026-09-11) found 5 Hz-range
params are actually **exponential**: CAB Low/High Cut, FX2 Envelope Wah/Wah Freq, MOD Velvet
Vibrato Rate — `value = min * (max/min) ** (cc/127)`, confirmed to within ~1% by a guided CC
sweep read off the real device screen. Linear scaling remains the default; these 5 (plus
anything found the same way later) opt into `RangeParam.curve: 'exp'` — see `midi/scaling.ts`.

## Post-1.04 firmware update: MOD gets 4 new types

Livtra shipped a firmware update (exact version unconfirmed — neither the manual nor the MIDI
guide has been updated to document it yet) whose release notes mentioned new MOD types among
other changes. Investigated empirically on real hardware, the same way as everything else in
this file, since there's no updated document to read from:

- **The original 5 MOD types kept their exact ids (0-4)** — chorus/phaser/flanger/tremolo/
  vibrato are unchanged, no code changes needed there.
- **4 new types were added, but not contiguously**: `Velvet Vibrato`=10, `Chorus II`=11,
  `Phaser II`=12, `Jet Flanger`=17. IDs 5-9 and 13-16 select nothing (confirmed by testing
  every value up to 30) — this breaks the MIDI guide's original "IDs are continuous" claim, so
  it's evidently a firmware-version-dependent convention, not a hard rule. (Do **not** assume
  device-screen display order matches CC id order when investigating this kind of thing —
  that's exactly the mistake that caused the original REV bug above; always confirm the actual
  CC value against what the device selects, one type at a time.)
- **`Velvet Vibrato`** (CC68-72): Rate (0.45-10Hz), Wave (0-100), Voice (0-100), Depth (0-100),
  Mix (0-100) — fully functional.
- **`Chorus II`** (CC68-71): Rate, Amount, Feedback, Mix, all 0.00-1.00 — fully functional.
- **`Phaser II`**: shown on-device with Depth/Rate/Feedback/Mix (all 0.00-1.00), but **none of
  them respond to MIDI — confirmed via the official Livtra app too**, not just this editor. At
  the time this was written, that looked like a current firmware limitation; **resolved
  2026-09-13** — CC-dead is real, but not a firmware limitation, same pattern as FX1's SysEx-only
  params above: all 4 params are fully controllable via the SysEx per-parameter mechanism instead
  (see "Editor-assigned default values" below for the full writeup). `mod.ts` now models all 4 as
  `rangeSysexOnly`, no `warning` field.
- **`Jet Flanger`**: shown on-device with Rate/Depth/Feedback/Phase/Mix (all 0.00-1.00); Rate
  (CC68) and Depth (CC69) work via CC, Feedback/Phase/Mix don't — confirmed via the official app
  too. **Resolved 2026-09-13** the same way as Phaser II: Feedback/Phase/Mix are `rangeSysexOnly`
  in `mod.ts` now (Rate/Depth stay on their working CCs), no `warning` field.

Same update also added three params to FX1 that turned out to be a *different* kind of gap —
not broken, just SysEx-only, same situation AMP/CAB model selection was in at the time:

- **Gate's new Release** (5.0-100.0ms) and **Auto Gate's new Sensitivity** (-6.0~6.0dB) and
  **Release** (20.0-300.0ms): exhaustively tested every CC in FX1's param range (50-56, with
  the relevant type — Gate or Auto Gate — actually selected) via direct MIDI monitoring; none
  of them move any of the three. Confirmed via the official Livtra app that these params *are*
  adjustable there — but the app sends **SysEx**, not a CC, to do it. **Resolved 2026-09-12**
  via the SysEx per-parameter mechanism (see "Live SysEx parameter edits" below) — all three are
  in `fx1.ts` now (`rangeSysexOnly`), verified end-to-end on real hardware (sent, saved, read
  back exact). EQ has the same story for its extra Level control (-12~+12 dB, see
  PARAM_VERIFICATION.md) — also resolved the same day, one `rangeSysexOnly` per EQ type
  (`data/blocks/eq.ts`), `sysexParamIndex` = that type's band count since Level always comes
  right after the bands.

Same update also added one new type to **FX2**: **`Motion Wah`** = id 11 (confirmed — unlike
MOD's new types, this one *is* contiguous, right after Wah=10). Params: Rate (CC68, 0-15Hz) and
Voice (CC69, 0-100) are fully functional via CC. Sweep and Mix have no CC at all — an earlier
note here called this a firmware limitation ("confirmed non-functional even from the official
app"), which was wrong: the real finding was only that the device's own screen doesn't refresh
immediately after ToneCommand sets them (a display bug), not that the values don't take.
Resolved 2026-09-12 via the SysEx per-parameter mechanism (see "Live SysEx parameter edits"
below) — `sysexParamIndex` 3 and 4 respectively, skipping index 2: the device's own param array
has an always-zero reserved slot there (confirmed empirically — sending index 2 landed at index
3 instead), likely a leftover from copying Wah's 5-param layout when this type was added. Motion
Wah also participates in the CC68-73 MOD/FX2 routing conflict (`FX2_SPECIAL_TYPE_IDS` in
`store/routing.ts` updated to include it) since Rate/Voice's working CCs land in that shared
range.

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
  but their inferred order turned out to be right after all: see "Resolved:
  AMP/CAB type switching..." below, where SysEx traffic confirmed the same
  0-29 index against the device's own reported model names.
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
- **On/off and type-select confirmed working device-wide.** AMP/CAB type
  never worked over their documented CCs (43/44) — they work over SysEx
  instead, see "Resolved" below. REV's type order was wrong (fixed, above);
  FX1/FX2/MOD/DEL/EQ were all already correct.
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

## Resolved: AMP/CAB type switching and effect chain reorder are SysEx-only

On real hardware, changing AMP or CAB **on/off** (CC23/24) works, but changing
**type** (CC43/44) never did — the model shown/heard on the device doesn't
change at all when a different one is picked in the editor. Confirmed via the
MIDI Activity log that CC43/44 *are* being sent with the correct value — not a
send-side bug. Separately, the official Livtra "ToneCommand" app was observed
sending SysEx on every parameter change, while the MIDI Control User Guide
only documents CC/PC. Static analysis of the app's own binary (Android APK)
and the NanoCore firmware image confirmed AMP *profile upload* (loading a
custom NAM — Neural Amp Modeler — profile onto the device) uses a large
chunked SysEx transfer protocol; that part stays out of scope (and out of
this public repo — see below) as too complex to be worth reimplementing for
this editor. But *selecting* one of the factory models is a different,
much simpler operation, and this was reverse-engineered directly: **not**
from the app/firmware binaries, but by capturing real SysEx traffic between
the official app and a real NanoCore over MIDI (MIDI Monitor), the same way
every CC finding in this document was hardware-verified — just applied to
SysEx instead of CC. (Binary/firmware reverse engineering findings — like the
NAM upload protocol above — are deliberately kept out of this public repo per
this project's premise of working from Livtra's own documentation; SysEx
structure learned by observing your own gear's traffic is treated the same
as any other hardware-verified finding, since nothing here derives from
someone else's decompiled code.)

**The protocol** (implemented in `midi/sysex.ts`): every command frames as
`F0 7D 4E 43 70 00 02 <seq> 00 6D 00 <len> 00 00 <fieldId> <value bytes> F7`
— manufacturer id `0x7D` ("non-commercial", plausible for a company without a
registered MMA id) + ASCII tag `"NC"`, then a "set field" command (opcode
`0x6D`) addressing one of the device's internal fields by id:

- **`fieldId 0x06` = AMP model.** 1 value byte. Confirmed with 4 isolated
  single-value captures across different models; cross-checked against the
  model *names* the device itself reports (Pey51501, Pey6505, RanT21,
  RoJC120 for the captured indices 15/17/18/20) — the value is the **same
  0-29 index** already used for `amp.ts`'s model list (`typeCC` just never
  worked, the index itself was always right). `amp.ts` sets
  `sysexTypeField: 0x06`; `setBlockType` (`store/patchStore.ts`) sends this
  instead of CC43 whenever a block declares `sysexTypeField`.
- **`fieldId 0x07` = CAB model.** Same shape, confirmed with 3 isolated
  captures (indices 6/19/0 = Hiw412/Ran112B/Bog412A, all real entries in
  `cab.ts`'s existing list). `cab.ts` sets `sysexTypeField: 0x07`.
- **`fieldId 0x05` = effect chain order — CONFIRMED WORKING as of 2026-09-08**,
  after a real, multi-hour regression: it briefly looked broken on real
  hardware (dragging a block never visibly changed the device's Effect Chain
  screen) even though the device ACKed every message. Two real bugs, both
  now fixed in `midi/sysex.ts`:
  1. **Missing priming message.** Every real capture of the official
     ToneCommand app reordering a chain sends a `fieldId 0x00`, no-value SET
     command (`buildChainOrderPrimeSysEx`) *immediately before* the actual
     `fieldId 0x05` set. Our own code never sent it. `store/patchStore.ts`'s
     `applyChainOrder` now sends both, in order, for every reorder (from
     `moveBlockInChain` and `ChainView.tsx`'s drag-and-drop).
  2. **Wrong value-byte layout.** The `0x00` padding byte sits *after the 5th
     order element*, not before the whole 8-element array as every earlier
     version of this file assumed:
     `[0x08, order[0], order[1], order[2], order[3], order[4], 0x00, order[5],
     order[6], order[7]]`. The old `[0x08, 0x00, ...order]` shape only ever
     corrupted `order[4]` onward, which is exactly why hardware tests kept
     looking "almost right, but scrambled from position 4/5 on." Pinned down
     from `MoveFX1.mmon` — a capture of ToneCommand dragging FX1 one step
     right, seven times in a row, each of the 7 resulting host→device
     messages diffed against the exact known chain from that single swap
     (see `buildChainOrderSysEx`'s doc comment and its test in
     `sysex.test.ts`, byte-exact against all 7 steps).
  `CHAIN_ORDER_BLOCK_IDS`' numbering is the same as `nanocoreSpec.blocks`'
  declaration order (fx1=0, fx2=1, amp=2, cab=3, del=4, mod=5, rev=6, eq=7) —
  confirmed correct once the two bugs above were fixed; the many *other*
  numberings tried earlier in that regression were chasing bug #2's
  corruption, not a real mapping problem. Still not understood: *why* the
  padding sits mid-array (maybe two historically-separate 5+3 sub-fields, or
  what `0x00` fieldId "primes"), or what the leading `0x08` constant itself
  means — harmless since both are simply reproduced verbatim. See
  [[nanocore-chain-order-broken]] for the full incident writeup (kept for the
  debugging methodology, now superseded by this fix). **Reading** the chain
  order back: `midi/presetReader.ts`'s `parseChainOrderFromPreset` takes it
  from the 8 bytes right before the first `0x10` tag in the opcode-`0x41`
  param stream — a permutation of the `CHAIN_ORDER_BLOCK_IDS` values,
  byte-exact against all 40 factory presets' `chainOrder`. This replaced
  `parseChainOrderFromAmpProfile` (the `0x63` footer), which returned `null`
  for real presets (e.g. slot 25 "Dot8th") because the footer's shape varies
  more than the one confirmed example suggested; it's kept as a fallback.

## Live push notifications (opcode `0x01`/`0x02`/`0x06`, `dir=0x72`, unsolicited)

Confirmed 2026-09-09 (`Polling_2.mmon`) — the device pushes these without
being asked, whenever the corresponding state changes from ANY source
(footswitch/panel, or another connected app). An earlier same-day capture
wrongly concluded the device never pushes anything unprompted; that capture's
listener port had gone stale (see [[nanocore-patch-change-detection]]) — a
dead port, not a quiet device.

- **`0x01` = active preset slot changed.** Format `<0x01> 0x00 <slot>`.
  Fired the moment the user recalls a different preset on the device itself.
  Captured going from slot `0x28` (40) to `0x29` (41) and back. This also
  revealed that `0x28` (`ACTIVE_PRESET_SLOT` in `midi/sysex.ts`) is NOT a
  fixed "always the live one" sentinel as originally assumed — it's just
  whichever slot happens to be active, and reads must target the *current*
  one (tracked via this push) or they silently return stale data from
  whatever slot was active when `0x28` was first reverse-engineered.
  `store/patchStore.ts` tracks this as `PatchStore.activeSlot` — **but the
  push isn't reliably delivered** (a recall done on the device panel while
  only this editor is connected didn't push, leaving `activeSlot` stuck on
  the stale sentinel and every `0x41`-derived value — types, params, and the
  on/off type hints — belonging to the wrong preset; user-visible as wrong
  on/off states 2026-09-10). So `readPresetFromDevice` no longer trusts the
  tracked slot: it reads the (live-state) `0x63` AMP profile FIRST and takes
  the slot straight from its header (`parseActiveSlotFromAmpProfile`, byte 15
  of the F0/F7-stripped buffer — the middle of the opening
  `0x03 <slot> <byte>`, confirmed against PC recalls of slots 0/5/12/20),
  falling back to the tracked slot only if the profile didn't come back.
- **`0x02` = one block's on/off state changed.** Format
  `<0x02> 0x00 <blockId> <onOff>`, `blockId` using `CHAIN_ORDER_BLOCK_IDS`'
  numbering. Captured activating MOD (`05 01`) and deactivating FX1
  (`00 00`). Unlike an opcode-`0x41` read (which only ever reflects *saved*
  state), this reflects the live, possibly-unsaved state directly.
- **`0x06` = one block parameter's live value changed — discovered 2026-09-09
  (`MODtype.mmon`).** Turning MOD's type encoder on the device fired 13 of
  these in a burst (one per parameter reset as the encoder scrolled through
  candidate types). Format `<0x06> 0x00 <blockId> <paramIndex> <x> <value:
  float32, little-endian>`, `blockId` using `CHAIN_ORDER_BLOCK_IDS`'
  numbering. `value` decodes to a clean 0.0-1.0 float32 (normalized) every
  time. See `isParamValueChangedPush`/`parseParamValueChangedPush`.

  **`paramIndex` fully decoded and WIRED IN 2026-09-13.** The 2026-09-11
  session (below, kept for the record) had it backwards: it read a *correct*
  result — the byte stayed constant through a whole Knee sweep — as a sign
  the byte was useless, and went looking for meaning in the wrong byte
  instead. Two fresh isolated FX1 Compressor sweeps settled it: turning ONLY
  Threshold held this byte at a constant `0`, turning ONLY Ratio held it at a
  constant `1` — exactly each param's real position in that Compressor
  type's `params` array (same convention `buildSetParamValueSysEx`'s write
  side already used, `sysexParamIndex` overrides included for
  gap/CC-less params). `x` (the next byte, `0..7`) still does not decode —
  the same `value` recurs under different `x`, and the same `x` recurs under
  different `value`s — so it's parsed and ignored, most likely an internal
  buffer/message-slot tag with no per-parameter meaning. `store/patchStore.ts`'s
  `startLivePushListener` now applies every `0x06` push straight to
  `PatchState.params` via `store/patchDefaults.ts`'s new
  `findParamSpecBySysexIndex` + `midi/scaling.ts`'s `normalizedToReal`.

  **`x` investigated once more 2026-09-13, closed as genuinely non-decodable.** A slow,
  one-click-at-a-time real hardware test (18 cleanly-separated pushes, ~2s apart, confirmed one
  physical detent per message) ruled out every remaining simple hypothesis: not a rolling click
  counter (deltas between consecutive `x` values are inconsistent, not a constant step); no
  correlation with the value itself at any tested denominator (`round`/`int` of the value times
  4/7/8/10/12/16/32/64/100, checked against all 19 real samples collected across both sessions —
  none scored meaningfully above the ~12.5% chance rate for 8 buckets); no correlation with how
  much the value changed since the previous push either. Two independent real datasets (this
  session and 2026-09-11) both come up empty — treated as closed, not "still open," barring a
  genuinely new angle later.

  **Getting this push to arrive at all needed its own fix — see the `0x68`
  ping note just below.** The first three attempts at a live re-test (a
  genuinely from-scratch connection, nothing else on the bus) got zero
  incoming SysEx of any kind, not even the passive heartbeat — the physical
  knob turns were real, the capture setup wasn't.

  **2026-09-11 finding, for the record (its byte reading was right, its
  conclusion wasn't):** A dedicated FX1 Compressor knob-sweep capture that
  day found this byte (`opcodeIndex+3`) constant at `0x02` through a Knee
  sweep and concluded it must be useless, chasing the *next* byte (`x`,
  `opcodeIndex+4`, `0..7`) as the real index instead — including the specific
  claim that `x = 4` carried roughly half the swept param's value. With
  `paramIndex` now decoded, `0x02` was simply Knee's own correct array
  position (index 2) the whole time; `x`'s apparent half-value correlation
  doesn't hold up against the two 2026-09-13 sweeps (same `x`, different
  values and vice versa) and is set aside as coincidence from a small sample.

  **The device only emits `0x06` for *physical* knob turns.** Probed 2026-09-11
  (`.scratch/probe_0x06_echo.py`, editor's own connection only): six incoming
  CC messages to FX1 `comp_threshold`/`knee` produced **zero** `0x06` echoes
  (and zero `0x01`/`0x02`). So there is no host-side way to read back a
  parameter's real min/max by sending a CC and watching the response — range
  verification has to be done by eye off the device screen
  (`docs/PARAM_VERIFICATION.md`).

  This push was originally found by accident while trying to map
  opcode `0x63`'s per-block record boundaries (see "On/off for all 8 blocks"
  above) — the type-change capture didn't cleanly isolate a boundary (MOD's
  type ended up unchanged, 0→0, after the encoder scroll), but it did reveal
  this push and confirms the `0x63`/`0x41` per-parameter region's byte length
  depends on the actual encoded *values*, not just the block's type — i.e.
  record boundaries there are more entangled than a simple per-type table.

`0x01`/`0x02`/`0x06` are all wired into `store/patchStore.ts`'s
`startLivePushListener` — active while `connection.connected`, torn down on
disconnect/output-change. **Working on a from-scratch connection with no
ToneCommand involved needs the `0x68` heartbeat — see that opcode's note
below; the earlier 2026-09-12 claim that a bare passive listener "still saw
every push" on its own was likely observing a background app's traffic on
the shared bus, not the device acting unprompted.**

Web MIDI needs `{ sysex: true }` on `requestMIDIAccess` to send any of this —
a separate, more sensitive browser permission from plain MIDI access (see
`midi/webMidiTransport.ts`). BLE-MIDI's default packet size (20 bytes) is too
small for the chain-order message (~26 bytes); `midi/bleMidiPacket.ts` splits
long SysEx across multiple packets per the BLE-MIDI spec's continuation
scheme (`encodeBleMidiSysEx`).

## Save to slot (opcode `0x46`)

Writes whatever the device currently has loaded (a recalled preset plus any
live tweaks since) into one of its own preset slots — the README's former
"no save-to-slot" limitation. Request `<0x46> 0x00 0x01 0x00 0x00 <slot>`
(16 bytes with `F0`/`F7`), reply echoes it back with one extra leading `0x00`:
`<0x46> 0x00 0x00 0x01 0x00 0x00 <slot>` (17 bytes). Confirmed 2026-09-12
against three independent real captures of the official app doing this
(`Save.mmon`, plus a second and third session saving different patches to
different slots) — all three requests are byte-identical apart from the
slot number.

This took several failed attempts to pin down, worth recording as a lesson:
the first captures used a device-output-only listener (a plain MIDI-in
socket), which structurally can only see what the *device* sends, never what
another app sends *to* the device. Those captures happened to contain a
16-byte `0x46` frame right around a real save — but it was the device's own
reply shape (missing the fact that a genuine reply is one byte *longer*, not
the same length), misread as the request. Replaying that exact frame back as
a command was reliably rejected — sometimes silently (wrong `dir` byte:
`0x71`, device->host, instead of `0x70`), sometimes with an explicit
device-side "bad payload" status. Both symptoms had reasonable-sounding
explanations at the time (a missing handshake, a wrong payload length) that
were individually plausible but each wrong — the actual bug only became
obvious once a genuinely bidirectional capture (MIDI Monitor, spying on both
directions of ToneCommand's own connection) showed the real request
side-by-side with its reply. Byte-for-byte comparison across *two* real
saves had actually been done earlier and still didn't catch this, because
both compared examples were the same (reply) shape — matching each other
perfectly is not the same as matching the real request.

Verified end-to-end against real hardware: recalling a factory preset by
Program Change, saving it to an empty slot, and reading that slot back
returned the source preset's name and parameters byte-for-byte; separately,
sending a single CC (AMP Gain) and a single SysEx field-set (AMP model) each
showed up as the *only* difference between two otherwise-identical saves of
the same source preset — confirming the save captures whatever the device's
live edit state actually is, from either kind of edit.

## Live SysEx parameter edits (opcode `0x6d`) — resolved 2026-09-12

A capture of the official app dragging a single knob (REV Decay) in its own
UI showed a *stream* of `0x6d` messages, one per UI tick, each carrying a
small delta-encoded value — not the plain CC this parameter also responds
to. This turned out to be the real "patch-building" mechanism for every
parameter the official app's UI exposes, as opposed to CC (meant for
live/performance tweaks — see the `0x06` push note above, and this
project's original decision not to reverse-engineer AMP/CAB model select
via CC because it turned out to be SysEx-only).

Decoded format: `<0x6d> 0x00 0x07 0x00 <pack7BitSafe([0x01, blockId,
paramIndex, ...float32LE])>` — `blockId` per `CHAIN_ORDER_BLOCK_IDS`,
`paramIndex` usually the parameter's position in its block-type's own
`params` array (see `midi/sysex.ts`'s `buildSetParamValueSysEx`,
`midi/safePacking.ts`'s `pack7BitSafe`). Confirmed to generalize beyond the
one captured example — used live to set every one of FX1's three new params,
EQ's Level, and FX2 Motion Wah's Sweep/Mix (all covered above), in each case
saving and reading the slot back to confirm the value actually landed, not
just that the device accepted the frame.

## Rename patch (opcode `0x6d`, field `0x08`) — resolved 2026-09-13

Renaming a patch turned out to be a LIVE edit like any other, not a distinct
operation — confirmed both by a real bidirectional capture (`Rename.mmon`) and
by the user separately noticing the same behavior first-hand: it's lost on the
next preset change if not saved, exactly like an unsaved parameter tweak.
`Rename.mmon` shows the official app sending one `SET_FIELD_OPCODE` (`0x6d`)
message with `fieldId 0x08` (added to `SYSEX_FIELD.PRESET_NAME`), immediately
followed by a `buildSavePresetSysEx` to persist it — this editor's own
`renamePresetOnDevice` sends only the rename itself, leaving the explicit
Save (already a separate button) to the user, same division of labor as every
other live tweak in this app.

Three real captures at 2/7/8 characters ("AB", "ClnTest", "LongName") pinned
down the value's exact shape and, as a side effect, the field's real
character cap: **8, confirmed by a real capture at exactly 8** (the read
side's `parsePresetName` doc comment's "12-char practical max" was always
just this editor's own looser estimate from the read side alone, never an
independently confirmed write-side limit).

Value shape: `[nameLength, ...charCodes]` (both raw, unmasked ASCII bytes —
`buildSetFieldSysEx`'s usual `&0x7f` masking is a no-op here), with a single
`0x00` separator inserted after the 6th byte of that logical sequence
whenever a 7th exists — never needed for 5-or-fewer-character names, since
`1 + nameLength <= 6` then:

| Name | Logical `[len, ...chars]` | Wire value bytes |
|---|---|---|
| `"AB"` (2 chars) | `02 41 42` (3 bytes, no separator needed) | `02 41 42` |
| `"ClnTest"` (7 chars) | `07 43 6c 6e 54 65 73 74` (8 bytes) | `07 43 6c 6e 54 65 00 73 74` |
| `"LongName"` (8 chars) | `08 4c 6f 6e 67 4e 61 6d 65` (9 bytes) | `08 4c 6f 6e 67 4e 00 61 6d 65` |

This resembles `unpack7BitSafe`'s general "insert a marker byte" shape but at
a field-specific fixed offset rather than the usual every-7-bytes cadence —
not generalized into `pack7BitSafe` itself, since an 8-char-capped field can
never need more than this one separator. The field's own `len` byte (distinct
from the embedded `nameLength`) counts the **logical** sequence
(`1 + nameLength`), NOT the wire byte count — it does not include the
separator, confirmed consistent across all three captures
(`buildSetFieldSysEx`'s usual `len = 1 + valueBytes.length` default doesn't
apply here whenever a separator is present; `buildRenamePresetSysEx` passes
it explicitly).

**Not otherwise investigated**: the response's echo shape shifts the
separator's position by one byte (response has an extra leading `0x00` before
`fieldId`, same pattern as every other `0x6d`/`0x46` reply — see
`isSetParamValueResponse`'s doc comment) — not parsed by this editor, which
sends the rename fire-and-forget like `buildBlockTypeSysEx`, matching how
every other CC/SysEx write to a live parameter already works here. Names
containing non-ASCII characters were not tested.

## Global settings (opcode `0x65`/`0x66`) — resolved 2026-09-12

Wireless, Loopback, Input Gain, USB Volume, BT Volume and MIDI Channel — the "Global Settings"
screen in both this editor and the official app — turned out to be reachable via their own small
SysEx family, distinct from the per-parameter mechanism above. Found from a real capture
(`Global.mmon`) of every field on that screen being changed once each. Confirmed exhaustively:
every field id below was captured independently, and the full before/after settings blob was
diffed byte-for-byte for each one.

- **Poll** (`0x65`): request `<0x65> 0x00 0x00 0x00`, no value/length wrapper. Sent every ~3s
  while ToneCommand's Global Settings screen is open — same cadence as the `0x68` ping, just a
  second, settings-specific heartbeat.
- **Set** (`0x66`): request `<0x66> 0x00 0x02 0x00 0x00 <fieldId> <value>` — the same
  `<len> 0x00 0x00 <fieldId> <value>` shape `SYSEX_FIELD`'s AMP/CAB-model messages use, just a
  different opcode and a different, bit-flag-shaped field-id space:

  | Field | id | Value encoding |
  |---|---|---|
  | Wireless | `0x01` | 0/1 |
  | Loopback | `0x02` | 0/1 |
  | Input Gain | `0x04` | **signed**, 7-bit two's complement (0-63 = 0..63, 64-127 = -64..-1 — `0x7b`/123 = -5) |
  | USB Volume | `0x08` | 0-100 |
  | BT Volume | `0x10` | 0-100 |
  | MIDI Channel | `0x20` | 0 = Omni, else 1-16 (same convention as everywhere else in this protocol) |

  Both `0x65`'s and `0x66`'s responses share one layout — the *whole* current settings blob, not
  just the one field a `0x66` changed: `<opcode> 0x00 0x00 0x07 <flag> 0x00 0x01 <wireless>
  <loopback> <inputGain> <usbVolume> <btVolume> 0x00 <midiChannel>` (`<flag>` is a small sticky
  bit that flips once and never resets after the first non-default value of any kind — not
  understood, not needed for reading the actual settings). See `midi/sysex.ts`'s
  `GLOBAL_SETTINGS_POLL_OPCODE`/`GLOBAL_SETTINGS_SET_OPCODE`/`GLOBAL_SETTING_FIELD` and
  `midi/presetReader.ts`'s `parseGlobalSettingsResponse`.
- **Unsolicited push** (`0x07`, `dir=0x72`) — fires whenever any of these change, from ANY
  source (this editor, ToneCommand, or the device's own panel). Same six fields, but a shorter,
  different-offset layout: `<0x07> 0x00 0x01 <wireless> <flag> <loopback> <inputGain>
  <usbVolume> <btVolume> <midiChannel>` — no length marker, and the "sticky flag" byte sits
  between `wireless` and `loopback` here instead of before everything. See
  `isGlobalSettingsPush`/`parseGlobalSettingsPush`.

**Language was tested too and confirmed absent from this protocol entirely**: toggling it
Chinese->English in the same capture produced zero MIDI traffic of any kind. It's a
ToneCommand-UI-only setting (its own locale), not a device one — not modeled here.

**Wireless/slot ambiguity — confirmed and handled 2026-09-12.** Toggling Wireless specifically
also produces a *third*, unrelated-looking push shaped `<0x01> 0x00 <0-or-1>` — the same opcode,
length and shape as `isActiveSlotChangedPush`'s `<0x01> 0x00 <slot>`, and a real preset slot can
itself be 0 or 1. Confirmed by direct hardware re-test (not just reasoned about): toggling
Wireless twice (once each direction) produced this push immediately followed, within ~10ms, by
an `isGlobalSettingsPush` carrying the same wireless value both times; a genuine slot-0/1 recall
(also re-tested) never comes with an accompanying settings push. `store/patchStore.ts`'s live
push listener now holds a slot-0-or-1 change for `AMBIGUOUS_SLOT_CHANGE_HOLD_MS` (150ms) and
discards it if a matching-value settings push arrives in that window, instead of acting on it
immediately — see `startLivePushListener`'s doc comment for the mechanism.

Same live re-test also resolved the older, more fundamental open question above this section
(whether these pushes work at all on a from-scratch connection without ToneCommand): a plain
`python-rtmidi` listener sending nothing of its own still saw every push land the moment a
physical control changed — confirming pushes reach ANY listener on the shared port as long as
*something* keeps the connection active (this store's own ping already does that
unconditionally), not just ToneCommand's specific connection.

**Correction 2026-09-13 — that "sending nothing of its own" listener probably wasn't alone on
the bus.** A follow-up session chasing the `0x06` push (below) ran the identical experiment —
genuinely nothing else connected, confirmed explicitly beforehand — and got **zero** incoming
SysEx across three separate attempts, not even the passive `0x68` heartbeat reply. The device (or
CoreMIDI's broadcast of it) appears to only forward unsolicited traffic to a listener once
*something* is actively pinging it — most likely `buildPingSysEx()`'s exact `<0x68> 0x00 0x00
0x00` every ~3s, since replicating that from the standalone script immediately and reliably
unblocked live `0x06` pushes on the same connection (three sweeps in a row, no misses). The
2026-09-12 test's "sending nothing" listener most likely weren't truly alone — a background app
(phone or otherwise) was probably still polling the shared bus without anyone noticing, and this
listener just observed its traffic. The conclusion the day's test drew — pushes reach any listener
on the shared port, not just ToneCommand's own connection — still holds; it just needed a live
pinger *somewhere* on the bus, which this editor's own `PING_INTERVAL_MS` heartbeat already
supplies unconditionally while connected, so ordinary use of this editor was never actually
affected.

Two more assumptions that used to be listed here as still awaiting hardware confirmation are
now resolved and this doc just hadn't caught up: **FX2 Wah `freq` (CC68)** — manual prints
"163~3.5kHz" (missing a decimal point/unit on the lower bound); confirmed real via an audible
sweep test, see HARDWARE_VERIFICATION.md section 1. **MOD `chorus`'s CC70 "Level"** — the MIDI
guide's per-type CC table allocates three CCs for Chorus (Rate/Depth/Level), but a `level` param
on CC70 turned out to be one of the 22 confirmed-dead Level params removed 2026-09-11 (absent
from both the device screen and ToneCommand) — see PARAM_VERIFICATION.md's resolved section.

Still genuinely open:

- **Editor-assigned default values — RESOLVED 2026-09-13, real factory defaults now shipped.**
  Neither official document states these, but they turn out to be readable live: cycling through
  every type of FX1/FX2/MOD/DEL/REV via CC/SysEx and reading the immediately-following live state
  (`0x63`, `decodeLiveBlockParams`) captures the device's own firmware default for every param of
  that type, before anything touches it — entirely automatable, no physical knob turns needed
  (same technique as the AMP/CAB/MOD/DEL live-model verification above). Cross-checked against a
  second, independent capture on a different active slot: every value matched exactly except one
  (FX2 Scream's `level`), which turned out to be contaminated by an unrelated concurrent action on
  the device during the first capture, not a real discrepancy — confirming these ARE firmware
  constants, not something remembered per-slot. 87 of the ~100 range params across these 5 blocks
  had a real default meaningfully different from the previous editor-convention guess; all 87
  updated in `data/blocks/{fx1,fx2,mod,del,rev}.ts` to the real device value.

  **AMP/CAB/EQ followed up separately, same day** — they don't have a "type switch resets
  params" moment the other 5 blocks do (AMP/CAB's `commonParams` aren't tied to model selection;
  EQ's bands aren't tied to a type either), so the cycling technique above doesn't apply. Read a
  genuinely never-saved device slot directly instead (recalled via the device's own panel — a
  Program Change to a slot past the 40 factory ones does NOT reach it, confirmed by a 10-attempt
  wait with no change; only the physical panel can). **EQ's flat-0dB default was already correct,
  no change.** AMP and CAB both defaulted to fully-open/maxed rather than a middling value — AMP's
  `gain` resets to its maximum (not 0.5) and `level` to 80 (not 50); CAB's `low_cut`/`high_cut`
  both reset fully open (20 Hz / 20000 Hz — i.e. no filtering at all), not a middling cutoff.
  Updated in `data/blocks/amp.ts` and `cab.ts`.

  **Byproduct discovery — confirmed and fixed the same day, not left as a lead.** MOD's Phaser II
  and Jet Flanger were documented above as fully CC-dead (confirmed on real hardware AND in the
  official app). That was true for CC — but exactly like Motion Wah before them, both turned out
  to be fully controllable via the SysEx per-parameter mechanism instead (opcode `0x6d`, see the
  "Live SysEx parameter edits" section above): all 4 of Phaser II's params (Depth/Rate/Feedback/
  Mix) and Jet Flanger's previously-dead Feedback/Phase/Mix (its Rate/Depth already worked via CC)
  were set live via `buildSetParamValueSysEx` and read back landing exactly. Shipped in
  `data/blocks/mod.ts` via `rangeSysexOnly` — the old `warning` fields (which correctly described
  the CC behavior but wrongly concluded it meant a firmware limitation) are removed. Real
  min/max/unit for all 7 (plus Jet Flanger's Rate/Depth, previously a raw 0-1 placeholder despite
  already working via CC) came from `docs/PARAM_VERIFICATION.md`'s own device-screen readings,
  gathered earlier but never wired up while these were believed fully dead. Byte-exact regression
  tests in `presetReader.test.ts` against 2 real captures.
- **FALSE ALARM, resolved same day (2026-09-13) — "reading back a user-saved
  preset decodes wrong" was never a decode bug.** First live test of the
  deployed editor against real hardware with a non-factory slot active (62)
  showed an empty preset name and wrong on/off/type/param values everywhere,
  briefly suspected to be a decoder gap (only ever validated against the 40
  factory presets). A direct `python-rtmidi` read of that exact slot found
  the real cause: **the user had been live-editing that slot on the device
  panel without ever saving** — opcode `0x41` reflects **saved** state only
  (already documented, see "Preset send/recall" above), so reading a slot
  that was never actually written back correctly returns its genuinely
  blank/default content (name `"preset"`, all-zero params) — this is the
  device behaving correctly, not a bug. Recalling a factory preset "fixed"
  the earlier test simply because that slot *was* genuinely saved. No code
  change needed; flagged here only so a future "custom preset reads wrong"
  report gets this checked (did you actually Save?) before assuming a
  decoder gap again.
- **Genuine minor curiosity found during that same direct read, not
  resolved**: reading page 2 of a slot that was never saved times out with
  no response at all, while page 1 answers normally (just with blank
  content) — reproduced twice. Harmless in practice (`readPresetFromDevice`
  already treats a page-2 timeout as "leave everything alone," so a
  never-saved slot just doesn't overwrite the editor with garbage), and low
  priority since it only affects slots nobody has saved to, but noted here
  in case it turns out to matter for something else later.
- **Follow-up, same day**: the underlying architectural gap this false alarm
  exposed — the editor syncing to *saved* state on connect instead of
  whatever the device is actually showing right now — is now properly
  fixed, not just explained away. See "Live device state via opcode 0x63"
  below: reconnecting to that exact never-saved-slot scenario today would
  show the correct live (unsaved) values instead of blank defaults, since
  `0x63` doesn't care whether anything was ever saved to the slot.

## Live device state via opcode `0x63` (AMP profile) — resolved 2026-09-13

The connect-time read described throughout this file (opcode `0x41`) reflects **saved** state
only — a real limitation the "false alarm" note just above hit directly. Until now, that meant
the editor's on-connect sync could visibly diverge from the device's own screen any time someone
had live-edited a parameter, switched a block's type, or toggled on/off without saving — normal,
constant behavior in everyday use, not an edge case. `0x63` ("AMP profile", already read on every
connect for chain order and the active slot number) turns out to carry the FULL live state for
every block — on/off, type/model id, AND every parameter value — using the exact same
`unpack7BitSafe` 7:8 packing `decodePresetParamValues` already uses for `0x41`, just laid out
differently.

**How it was found**: with a known live value set via `buildSetParamValueSysEx` (already-solved,
opcode `0x6d`) instead of a physical knob, the immediately-following `0x63` response could be
diffed against a baseline to isolate exactly where that value landed — no physical interaction
needed, unlike the `0x06` investigation earlier this file. Confirmed with 3 independent real
captures, each varying a different thing: two different known `FX1 Compressor` values (Threshold,
Ratio), `FX2`'s type switched live via CC, and `FX1`'s type switched to Gate (2 params instead of
Compressor's 6) to prove param count really does depend on live type, not a fixed number.

**Layout** (all offsets relative to the F0/F7-stripped response):

- The `unpack7BitSafe` stream starts at a **fixed offset 20** (vs `0x41` page 1's `44`).
- **FX1 is special-cased**: unlike the other 7 blocks, it has no `[on][type][count]` header of its
  own inside the packed stream — that header instead sits in the **raw, still-packed preamble** at
  offsets **17 / 18 / 19** (offset 17 was already known as FX1's on/off byte since 2026-09-09; 18
  = type id, 19 = param count are new). FX1's own `paramCount` floats then start immediately at
  stream offset 0 (i.e. buffer offset 20), no header, no markers.
- The remaining 7 blocks follow, **always in FX2 → AMP → CAB → DEL → MOD → REV → EQ order**, each
  as a 3-byte header **`[on/off][type or model id][paramCount]`** (part of the same packed
  stream, unlike FX1's) followed by `paramCount` float32 values, no markers in between — a flatter
  layout than `0x41`'s `0x10`-tag-wrapped one. AMP/CAB's "type" byte is their model's plain
  0-indexed list position (same convention as `buildAmpModelSysEx`/`buildCabModelSysEx`), not an
  effect type. REV needs the same `-1` shift as `decodePresetParamValues` (internal id ≥5 shifts
  down one) — carried over from that finding, not independently re-confirmed here. EQ has no real
  type byte in this scheme either (matching `0x41`); its type is derived from `paramCount` via the
  existing `eqTypeIdFromEntryCount` (entry count − 1 = band count → `[3, 6, 8]` index).
- Immediately after EQ's block: the already-known chain-order footer (`0x08` + 8 order bytes —
  see `parseChainOrderFromAmpProfile`, which reads this same response for a different purpose).

Each parameter's position within a block matches its plain array position in that block-type's own
`params` (no `sysexParamIndex`-style gaps observed in this format) — the same convention already
established for `0x41` and for `buildSetParamValueSysEx`. Values are IEEE-754 float32,
little-endian, normalized 0.0-1.0 — same as everywhere else in this protocol. One thing to expect
when cross-checking against a value you just set: the device appears to round live values to
roughly 3 decimal places of the normalized 0.0-1.0 range (setting `0.123456` read back as
`0.123`) — already known separately from `isSetParamValueResponse`'s doc comment ("the device can
echo back a slightly different value than what was sent").

**Shipped**: `midi/presetReader.ts`'s `decodeLiveBlockParams`, same `DecodedBlockParams[]` return
shape as `decodePresetParamValues` so it slots into the same call sites. `store/patchStore.ts`'s
`readPresetFromDevice` now decodes BOTH on every connect and overlays the live result on top of
the saved one per block (live wins whenever it decoded something) before applying either to
`PatchState` — so a block that's been live-edited without saving now shows its real current
state immediately on connect, and a block nobody has touched since the last save still shows
correctly either way (both decoders agree in that case). Byte-exact regression tests in
`presetReader.test.ts` against the 3 real captures above.

**Follow-up 2026-09-13 (later the same day): AMP/CAB's model-index and MOD/DEL's type-id, now
dedicated-tested — one real bug found and fixed.**

- **MOD and DEL: confirmed genuinely live and correct.** DEL's type moved from 0 to a real set
  value (4) in a clean before/after; MOD needed two attempts — the first (id 6, then 9) looked
  like a decode failure but was actually an invalid MOD type id (MOD's own type list jumps `4`
  straight to `10`, no `6`-`9`) — the device correctly ignored it, same silent-ignore behavior
  already documented for CC. A valid id (`2`, then `3`) moved MOD's `variant` immediately, both
  times.
- **AMP and CAB: confirmed genuinely NOT exposed here — a real finding, not a re-verification
  formality.** Setting AMP's model live via `buildSetFieldSysEx`/`SYSEX_FIELD.AMP_MODEL` (several
  different, individually-acked-by-the-device values: 3, 7, 9, 12) never moved AMP's `variant`
  byte in this response even once — while in the very same responses, AMP's own param values
  (`gain`, live-set moments earlier) tracked perfectly, and on/off worked too. Same negative
  result for CAB. This means this response genuinely has no room for AMP/CAB's live model index
  anywhere — consistent with (and now a live-state echo of) `0x41`'s own tag structure already
  excluding AMP/CAB from its main 8-tag walk and needing a separate footer instead
  (`extractAmpCabModelIndices`).
- **Real bug found and fixed from this**: `store/patchStore.ts`'s live-overlay merge (added
  earlier this same day) was blindly trusting this always-stuck byte for AMP/CAB's type, meaning
  it could silently clobber a correct saved-state AMP/CAB model with a meaningless placeholder on
  every connect. Fixed: AMP/CAB now keep whichever `variant` the saved-state (`0x41`) decode
  found; only the other 6 blocks let the live decode win for type. On/off and param values for
  AMP/CAB were never affected — those genuinely do track live for these two blocks, only the model
  index doesn't.

  **Confirmed to affect the official app too, same day**: the user checked ToneCommand itself —
  changing AMP's model on the device panel does NOT update what ToneCommand shows, either. This
  is a genuine firmware/protocol ceiling, not something even the official app works around; the
  fallback here (AMP/CAB's type only refreshes on the next full reconnect/slot-change re-read,
  same as the preset name) is the best achievable, not a gap specific to this editor.

**Confirmed end-to-end through the real deployed editor same day**: live-edited a parameter on
the device panel without saving, reconnected on lucanenni.github.io with real hardware — the
editor immediately showed the correct live value, matching the device's own screen.

**The preset NAME is the one exception, confirmed genuinely unreadable live, not a gap in this
decoder.** `0x63`'s payload has no room for a name anywhere — confirmed by comparing its preamble
byte-for-byte across two completely different active presets (different names, different
`0x41`-read content): every byte `decodeLiveBlockParams` doesn't already account for stayed
identical regardless of the name. So `activeSlotName` stays sourced from `0x41` (saved state
only) even after this round of work — same limitation the official app has too (the user checked:
ToneCommand also shows the saved name on load, not a live one). This editor's own renames still
update `activeSlotName` optimistically the moment they're sent (see `renamePresetOnDevice`), which
is as close to "live" as the name field gets. This is the
exact scenario the original bug report described; it now works.

## Not controllable via documented MIDI CC

- **Effect chain reordering.** The manual describes a device-side "Effect Chain"
  screen where the physical signal order of the 8 blocks can be rearranged;
  no CC for this is documented, but the editor sends it via SysEx and it's
  confirmed working against real hardware — see "Resolved: AMP/CAB type
  switching and effect chain reorder are SysEx-only" above for the protocol.
- **Global settings** (Wireless, Loopback, Input Gain, USB/BT Volume, MIDI
  Channel) — **resolved 2026-09-12, no longer just reference fields.** None
  has a documented CC, but all five are reachable via SysEx (opcodes `0x65`
  poll / `0x66` set / `0x07` unsolicited push, dir `0x72`, same family as the
  patch-state pushes) — see the "Global settings (opcode `0x65`/`0x66`)"
  section below. Firmware info stays read-only (there's no set operation for
  it, only ever read from `nanocoreSpec.meta.firmware`, itself not from the
  device — see the file's own header comment).
- **Tuner reference pitch** (400-480 Hz, default 440 Hz) — only CC80 (tuner
  on/off) is documented; the reference-pitch value itself has no known CC.
  **Confirmed a dead end 2026-09-13, not just unexplored**: the official
  ToneCommand app doesn't expose the tuner at all (no tuner screen, no pitch
  control anywhere in its UI) — unlike Global Settings or per-parameter
  edits, there's no app traffic to capture here because the app itself never
  sends anything for it. This is set on the device's own panel only, with no
  companion-app or MIDI equivalent at all — stays reference-only permanently,
  not a "not yet reverse-engineered" gap like the others in this section were.
- **Reading the device's current patch back into the editor — no longer
  undocumented, this is now implemented.** No CC does it — it's opcode `0x41`
  (`SET_FIELD_OPCODE`'s sibling), which returns a two-page dump of the active
  preset slot decoded by `midi/presetReader.ts`. Each block's type, and where
  confirmed its on/off state, are recovered; parameter values are decoded too
  (see `decodePresetParamValues` below). Chain order is read separately, from
  opcode `0x63`'s response footer, which since 2026-09-13 also supplies the
  device's full LIVE state (see "Live device state via opcode 0x63" below) —
  `store/patchStore.ts`'s `readPresetFromDevice` overlays that on top of this
  saved-state read. Called on connect and whenever the device pushes an
  active-slot-changed notification (see "Live push notifications" above).
  **The active preset's name IS decoded now** (`parsePresetName`, wired into
  `store/patchStore.ts` as the display-only `activeSlotName`). It sits in
  page 1 right after a constant `02 07 00 02 10` anchor, stored the same
  quirky way as the `"preset"` ASCII literal elsewhere in this protocol —
  first two characters raw, then a `0x00`, then the rest, null-padded to a
  fixed width. That `0x00` is an `unpack7BitSafe` packing header (name bytes
  are all ASCII < 0x80 so it's always `0x00`); a second header falls 8 bytes
  later and is skipped too. Byte-exact against all 40 factory preset names
  read from real hardware (longest tested 8 chars; the second skip is
  inferred from the packing scheme, not yet hit by a real long name). The
  earlier half-finding — a capture containing "FunkCln" at "a variable
  position" — was almost certainly this same field; the small position
  variance is just the preamble's sequence-number bytes shifting the whole
  buffer between reads, which the anchor search absorbs.
- **Parameter values** (the per-block continuous/enum values inside each
  opcode-`0x41` tag) — **the general encoding solved 2026-09-09; FX1
  Compressor fully decoded and wired in as the first confirmed case.**
  Confirmed via direct hardware queries (`python-rtmidi` can open the
  "Nanocore" CoreMIDI ports and send/receive the exact SysEx bytes
  `midi/sysex.ts` builds, without MIDI Monitor or the browser editor —
  read-only opcodes `0x41`/`0x63` only, never used to write) cross-referenced
  against known reference values obtained separately (see
  [[nanocore-readback-pending]] for full provenance — kept out of this
  public doc per [[nanocore-sysex-scope-decision]]).
  `midi/presetReader.ts`'s `unpack7BitSafe` is the general decoder: a
  "7-bit-safe" byte-packing scheme (1 header byte, whose bit `i` is raw byte
  `i`'s own bit 7, precedes each run of up to 7 masked-to-7-bit data bytes) —
  this is how the protocol satisfies MIDI's rule that no SysEx data byte may
  be `>= 0x80`, for any value whose raw bytes might otherwise violate it.
  `decodeFx1CompressorParams` was the first case — FX1 Compressor's first 5
  params, per-tag; kept for its tests/history but superseded by the general
  decoder below.

  **Generalized and wired in 2026-09-10 (`decodePresetParamValues`).** The
  whole `0x41` parameter payload is ONE continuous `unpack7BitSafe` stream
  from a fixed start (offset 44 in the F0/F7-stripped **page 1** payload,
  right after the name field's trailing `0x60 0x13 0x03 0x40` marker) — NOT a
  per-tag restart, which is why the per-tag approach only reached 5 of
  Compressor's 6 params. Unpack once and the stream carries `[0x10][LEN]
  [content]` tags whose content is `[X][effectId][variant][0x01][paramCount]
  [marker0][float0 LE][marker1][float1 LE]…` — each parameter a 4-byte float32
  at content offset `6 + 5*i`. `effectId` (not the `CHAIN_ORDER_BLOCK_IDS`
  numbering — a separate internal id): FX1=7, FX2=8, AMP=1, CAB=2, DEL=5,
  MOD=4, REV=3, EQ=6. The stream continues into page 2 — page 1 ends
  mid-value, and page 2's own payload begins with one raw byte (at stripped
  offset 19, after a 19-byte transport mini-header) that completes it, then a
  fresh `unpack7BitSafe` stream resumes at offset 20. `decodePresetParamValues`
  takes both pages and splices them. Decoded byte-exact against all 40 factory
  presets' known values (`factory_presets.json`): **every block 40/40**, every
  param and variant. A few FX2 types (Pitch/EnvWah/Wah) pin and omit their
  last param, and EQ stores one extra trailing value beyond its band gains
  (always 0.5 in the factory presets) — the decoder returns exactly what's
  stored and the caller ignores anything with no matching param spec.
  `store/patchStore.ts`'s `readPresetFromDevice` un-normalizes each 0.0–1.0
  value into its param's real range (positionally against `activeParams`) and
  merges it in — so all 8 blocks' knob positions round-trip from the device.

  Bonus: each block's `variant` in this stream is a cleaner type-id source
  than `parseReadPresetResponse` — byte-exact for all 8 blocks, and it needs
  neither the REV `-1` correction nor the flaky page-2 AMP/CAB/EQ footer.
  `readPresetFromDevice` now prefers it (REV's serialization skips internal id
  4, so ids ≥ 5 shift down one to match the editor's CC ids), falling back to
  the parsed value only when the stream can't be decoded.

  Also: Compressor's `makeup` (6th param) is NOT absent after all — the
  continuous decode finds it, 40/40; the earlier "absent" call was an artifact
  of the per-tag range. The
  earlier-suspected "extra byte doesn't correlate with any bitmask" dead end
  (from before this encoding was found) is now explained: `unpack7BitSafe`'s
  header bytes fall at a fixed period across the *whole* raw byte stream,
  not aligned to each parameter's own boundary — there was never a
  per-parameter "extra byte" to find. The same technique applied to MOD
  (tremolo, type 3) surfaced a SECOND escape-form-length exception beyond
  the already-fixed `x=15` one (see
  `MOD_ESCAPE_X_WITH_OFF_BY_ONE_CONTENT_LENGTH` in `presetReader.ts`):
  `x=30` also undershoots, corrupting the tag's last parameter — not fixed,
  noted for whoever picks this up next. `midi/presetReader.ts`'s
  `debugWalkPresetTags` (exported for exactly this kind of investigation)
  exposes each tag's raw form/x/content for further work.
- **On/off for all 8 blocks — resolved 2026-09-11, cleanly, from the one
  place that also gives every type and parameter value:
  `decodePresetParamValues`.** Each block's unpacked tag content is
  `[X][effectId][variant][on/off][paramCount][params…]` — **content byte 3 is
  the on/off flag**, byte-exact for all 8 blocks across all 40 factory presets
  (matched against `factory_presets.json`'s `enabled`). Wired into
  `store/patchStore.ts`'s `readPresetFromDevice`; the `0x02` live push still
  covers changes made on the device after the read.

  This superseded three earlier, messier attempts:
  1. `parseReadPresetResponse`'s `ampOn`/`cabOn`/`eqOn` — read from the
     *still-packed* `0x41` tag walk, which corrupts the EQ (and REV) tag past
     the page-1/page-2 boundary (page 2's transport mini-header lands mid-tag).
     This was the actual cause of the wrong on/off states seen 2026-09-11
     (EQ showing on for presets where it's off). Kept only as a fallback for
     AMP/CAB/EQ, plus AMP/CAB model *indices*.
  2. `parseFx1OnFromAmpProfile` — FX1's flag at a fixed offset in the `0x63`
     response. Correct but FX1-only. **Deleted 2026-09-11.**
  3. `parseVariableBlockOnOffFromAmpProfile` — a substantial effort to
     generalize (2) to FX2/DEL/MOD/REV by walking each block's `0x63` flag
     offset as a fixed base plus preceding blocks' type-driven length deltas
     (`*_TYPE_LENGTH_DELTA` tables, `findFlagTypePair`, ±1-byte jitter
     tolerance, a type-id hint from the `0x41` decode). It got to ~17/17 but
     the offset math had genuine value-dependent jitter. All of it —
     ~200 lines and its test suite — **deleted 2026-09-11** once content byte
     3 in the `0x41` param stream turned out to just *be* the flag. If you
     ever need the writeup, it's in the git history around that date.

  (The `0x63` response is still read every `readPresetFromDevice` — for the
  chain-order footer and, since 2026-09-11, the loaded slot number in its
  header, see the `0x01` push note above.)

  Byproduct of a related investigation (`MODtype.mmon`): confirmed opcode
  `0x41` reflects ONLY saved state (a type-change-without-save capture came
  back byte-for-byte identical) while opcode `0x63` reflects live state — and
  this capture is what surfaced the `0x06` live parameter-value push
  documented above.

  **Real bug found and fixed while investigating this: `walkTags`'
  escape-form length formula (`content = x + 3`) overshoots by one byte for
  MOD when `x = 15` (MOD = chorus).** REV's real tag marker was confirmed (by
  independently finding its own `x = 6`, matching every other capture) to sit
  ONE byte before where `x + 3` said MOD's content should end. Since the
  walker only searches forward for the next tag marker, an overshoot like
  this is unrecoverable — it skips past the true marker and resyncs on a
  later, unrelated `0x10`, corrupting REV, EQ, and the page-2-footer AMP/CAB
  model lookup. This exact corruption was silently present in EVERY real
  capture this session where MOD's type was chorus
  (`FX2off.mmon`/`MODoff.mmon`/`REVoff.mmon`/`DELoff.mmon`/`MODtype.mmon`) —
  each one had shown a nonsensical `revTypeId` around 124-125, noted as
  "seems like a parsing bug" without being tracked down until now. Fixed with
  a targeted special case for this one confirmed value (`x = 15` at MOD's tag
  position only) rather than a broader guessed formula — only 2 real data
  points exist (`x=15` → content 17, `x=20` → content 23, both confirmed via
  independently locating the following tag), not enough to derive the
  general rule. See `presetReader.ts`'s
  `MOD_ESCAPE_X_WITH_OFF_BY_ONE_CONTENT_LENGTH` for the full writeup and a
  real-capture regression test in `presetReader.test.ts`.

  **Also newly noticed, NOT fixed:** the same `MODtype.mmon` capture has
  AMP and CAB both off, and in that state the page-2 footer's
  `0x21 0x01 <cab> 0x24 0x01` anchor doesn't match — there's an extra byte
  inserted before `0x24` — so `ampModelIndex`/`cabModelIndex`/`eqTypeId` come
  back `null` for this capture. Likely the footer's shape itself changes when
  AMP/CAB are off (an off block probably doesn't need a model index slot).
  Not investigated further; asserted as `null` in the regression test above
  so a future fix shows up as an intentional value change there.

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

Livtra's official documentation — not redistributed in this repo (theirs to
publish):

- **NANOCORE User Manual** — https://openparcelbox.com/manuals/NANOCORE-User-Manual.pdf
- **NANOCORE MIDI Control User Guide** — https://openparcelbox.com/manuals/NANOCORE-MIDI-Control-User-Guide.pdf
