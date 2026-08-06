# Hardware verification checklist

Run through this the day the NanoCore arrives, in order — each section is quicker
because the previous one is already confirmed. Everything here exists because the
manual/MIDI guide state it, but no document confirms the exact 0-127 ↔ real-value
mapping; see [MIDI_MAPPING_NOTES.md](MIDI_MAPPING_NOTES.md) for the full reasoning
behind each assumption.

**Setup:** `cd app && npm run dev`, open the printed URL in Chrome/Edge, connect the
NanoCore via USB, pick **Web MIDI (hardware)** in the connection panel, select its
port, and set the channel to match the device's own MIDI Channel setting (device
channel `0` = Omni, so any editor channel works if you haven't changed it).

## 1. The four open questions (highest priority)

These are the only spots the code carries an explicit `note:` flagging a guess —
resolve these first, they're the only ones likely to need an actual code change.

- [ ] **CAB Level (CC67, `cab.ts`)** — range assumed `0-100` (the manual's CAB
      "Common Parameters" only lists Low Cut/High Cut; Level is inferred from the
      MIDI guide's CC map alone). Go to CAB, sweep the Level knob end to end,
      confirm the device shows/audibly matches a 0-100-ish range and not, say,
      a dB range or something inverted.
- [ ] **FX2 Envelope Wah → Freq (CC68, `fx2.ts`)** — manual prints "10.0~20kHz"
      verbatim, which is an unusually high base frequency for an envelope filter.
      Select FX2 → Envelope Wah, sweep Freq, and listen/check the device screen:
      does the usable range actually span kHz, or is it more likely Hz
      (e.g. 10Hz-2kHz)? Update `min`/`max` in `fx2.ts` accordingly if wrong.
- [ ] **FX2 Wah → Freq (CC68, `fx2.ts`)** — manual prints "163~3.5kHz" (the lower
      bound looks like a truncated decimal, coded as 163 Hz). Sweep it the same
      way and confirm against the device.
- [ ] **MOD / FX2 routing conflict (CC68-73)** — set FX2 to Pitch (or Envelope
      Wah/Wah), turn MOD on with any type selected, then move a MOD parameter
      slider in the editor. Confirm the device's FX2 effect changes instead of
      MOD, exactly as the in-app warning banner says. If it *doesn't* — e.g. if
      the device actually keeps them independent — this is a bigger fix: remove
      the shared-CC assumption from `mod.ts`/`fx2.ts` and `routing.ts`.

## 2. Linear scaling convention (spot check, not exhaustive)

The MIDI guide states "Parameter: 0-127, lowest to highest value" as the general
rule; every param in the data model assumes plain linear scaling across its
documented real-world range. Checking one param per unit "shape" is enough to
trust the rest — if these hold, the remaining ~240 parameters almost certainly do
too, since they all follow the same code path (`realToCC`/`ccToReal`).

- [ ] A **dB range with a negative floor** — FX1 → Compressor → Threshold
      (-60~0 dB): CC0 should read/sound like -60dB, CC127 like 0dB, CC64 roughly
      the midpoint.
- [ ] A **±dB range around zero** — AMP → any model → Bass (-10~10 dB): CC64
      should be ~0dB (flat).
- [ ] A **time/ms range** — DEL → Digital → Time (0.1~3000ms): confirm the low
      end is near-zero delay and the high end is the full 3 seconds.
- [ ] A **ratio range** — FX1 → Compressor → Ratio (1.1:1~20:1).
- [ ] A **0-100 index range** — MOD → Chorus → any 0-100 param (Rate/Depth/Level).
- [ ] A **semitone range** — FX2 → Pitch → Pitch (-12~12 st): CC64 ≈ unison, CC0
      ≈ -12st, CC127 ≈ +12st.

If any of these come back non-linear (e.g. logarithmic dB taper, which is common
on real gear), note which parameter *kind* it affects — it's likely all params of
that unit, not just one — and we'll adjust the `curve`/scaling function rather
than hand-fix every param.

## 3. On/off and type-select conventions (all 8 blocks)

Quick pass — toggle each block's power switch and change its type dropdown once,
confirming the on-screen device state follows:

- [ ] FX1  [ ] FX2  [ ] AMP  [ ] CAB  [ ] MOD  [ ] DEL  [ ] REV  [ ] EQ

For **one** block (e.g. AMP), also confirm a couple of type IDs land on the
*correct* model — e.g. AMP type `9` should be "Mar8001" (Marshall JCM800 Tone 1)
per `amp.ts`'s index-0 ordering. This is the exact-ID convention (not scaled) —
if it's off by one anywhere, it's likely off by one everywhere for that block.

## 4. LFO waveform enum (Tremolo/Vibrato)

Not documented anywhere how Sine/Triangle/Square/Saw map onto CC 0-127 — the
editor currently guesses four *equal* buckets (0-31/32-63/64-95/96-127). Go to
MOD → Tremolo, cycle the Wave dropdown through all four options, and for each
confirm the device actually switches waveform (check the sound or the device's
own type indicator, if it shows one). If the buckets are wrong, the fix is in
`enumIndexToCC`/`ccToEnumIndex` in `midi/scaling.ts` (or per-param if uneven).

## 5. Global/transport controls

- [ ] **Tuner** — Tuner tab → toggle on/off, confirm the device tuner opens/closes.
- [ ] **Prev/Next preset** (CC81/82) — Presets tab → Previous/Next, confirm the
      device steps through its stored presets.
- [ ] **Direct preset recall** (Program Change) — enter a preset number 0-127 →
      Recall, confirm the matching device preset loads. Check the manual's
      "Program Change numbering" table still applies (0-127 direct vs. some
      controllers' 1-128 display).
- [ ] **Send patch to device** — build an arbitrary patch across a few blocks,
      hit Send, and confirm every block's on/off + type + parameters land
      correctly on the device *in one shot* (this exercises `sendFullPatch`,
      i.e. every CC in sequence — a good end-to-end smoke test).

## 6. Low priority / just confirm they're inert

- [ ] CC22, CC42, CC29, CC49 (reserved slots per the MIDI guide) — sending
      values here should have no effect. Not worth deliberately testing unless
      you're curious; safe to skip.

## After verification: updating the code

- Wrong range/value found → edit the relevant `range()`/`enumP()` call in
  `app/src/data/blocks/*.ts`, then delete the corresponding `note:` and its
  paragraph in `MIDI_MAPPING_NOTES.md`.
- Everything confirmed correct → just delete the resolved bullet points from
  `MIDI_MAPPING_NOTES.md`'s "Assumptions & open questions" section (leave the
  "Not controllable via documented MIDI CC" and "Routing conflicts" sections,
  those are architectural, not per-value, and don't get "resolved" by testing).
- Run `npm test && npm run build` after any data-file edit — the data-integrity
  tests in `src/data/__tests__/spec.test.ts` will catch a broken CC/range/id
  immediately.
