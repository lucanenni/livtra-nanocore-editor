# Hardware verification checklist

**Status: complete.** Every section below is resolved — confirmed, fixed, or
deliberately deferred/skipped by choice (section 6, and the two `[~]` items
in section 1 were later resolved too — see MIDI_MAPPING_NOTES.md for the
full findings log). Kept here as a record and as a template for re-running
against a future firmware update.

Run through this the day the NanoCore arrives, in order — each section is quicker
because the previous one is already confirmed. Everything here exists because the
manual/MIDI guide state it, but no document confirms the exact 0-127 ↔ real-value
mapping; see [MIDI_MAPPING_NOTES.md](MIDI_MAPPING_NOTES.md) for the full reasoning
behind each assumption.

**Setup:** `cd app && npm run dev`, open the printed URL in Chrome/Edge, connect the
NanoCore via USB, pick **Web MIDI (hardware)** in the connection panel, select its
port, and set the channel to match the device's own MIDI Channel setting (device
channel `0` = Omni, so any editor channel works if you haven't changed it).

Checkbox key: `[ ]` not yet checked, `[x]` confirmed, `[~]` deliberately deferred
(not blocking — revisit later if it turns out to matter).

## 1. The four open questions (highest priority)

These are the only spots the code carries an explicit `note:` flagging a guess —
resolve these first, they're the only ones likely to need an actual code change.

- [x] **CAB Level (CC67, `cab.ts`)** — ~~range assumed `0-100`~~ **Confirmed
      non-functional on hardware**: Low Cut/High Cut both work, Level does
      nothing. Removed from the editor; see MIDI_MAPPING_NOTES.md.
- [x] **FX2 Envelope Wah → Level (CC72, `fx2.ts`)** — not part of the original
      4 open questions, found while testing Freq below: **confirmed
      non-functional**, same as CAB Level. Freq/Env/Q/Mix (CC68-71) all
      confirmed live/responsive. Removed from the editor.
- [x] **FX2 Envelope Wah → Freq (CC68, `fx2.ts`)** — confirmed via audible
      sweep test (sustained note/picking dynamics while sweeping Freq
      end-to-end): the wah sweep stayed musical across the whole slider, no
      dead zone. Manual's literal "10.0~20kHz" **confirmed real**, kept as-is.
- [x] **FX2 Wah → Freq (CC68, `fx2.ts`)** — confirmed via the same audible
      sweep test: stays musical across the whole slider. Manual's
      "163~3.5kHz" (lower bound read as 163Hz) confirmed real, kept as-is.
- [ ] **MOD / FX2 routing conflict (CC68-73)** — indirectly supported (Envelope
      Wah's Freq/Env/Q/Mix on CC68-71 are confirmed live, which only makes
      sense if those CCs are actually being routed to FX2 while it's selected),
      but not directly tested yet. To confirm: set FX2 to Pitch (or Envelope
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

- [x] FX1  [x] FX2  [x] AMP  [x] CAB  [x] MOD  [x] DEL  [x] REV  [x] EQ
      (on/off confirmed working device-wide; type-select confirmed correct
      for FX1/FX2/MOD/DEL/EQ, fixed for REV, diagnosed as SysEx-only and
      out of scope for AMP/CAB — see below)

- [x] **REV type order was wrong** — confirmed and fixed, see
      MIDI_MAPPING_NOTES.md (Spring/Shimmer/Cloud ids 4-6 were rotated).
- [x] **AMP/CAB type-select does nothing — diagnosed, not fixable via CC.**
      On/off works; picking a different model never changes what's loaded on
      the device (not even to a *wrong* model, unlike the REV case above).
      Confirmed via the MIDI Activity log that `CC43`/`CC44` *are* sent with
      the correct value — not a send-side bug. Separately observed: Livtra's
      own official companion app sends **SysEx** on every parameter change
      (and possibly periodically), while the MIDI Control User Guide only
      documents CC/PC. Working theory: AMP/CAB model selection is a
      SysEx-only operation on this firmware (profile/IR loading needs more
      than a plain CC carries), unlike lighter DSP-mode switches (Gate type,
      Chorus type, etc.) which do respond to their documented CCs. **Decision:
      not pursuing SysEx reverse-engineering** — out of scope for a project
      built from Livtra's own documented protocol. Left as a known limitation;
      see MIDI_MAPPING_NOTES.md. Select the AMP/CAB model on the device itself
      for now — every other parameter (Gain/Bass/Mid/Treble/Level, Low
      Cut/High Cut) and the on/off switch still work fine remotely.

DEL and EQ type IDs confirmed landing on the *correct* effect (matching the id
order in `del.ts`/`eq.ts`) — no issues found, unlike REV. This is the exact-ID
convention (not scaled) — if it's off by one or rotated
anywhere, the REV fix above is the template for how to spot and fix it.

## 4. LFO waveform enum (Tremolo/Vibrato) — ✅ confirmed

Not documented anywhere how Sine/Triangle/Square/Saw map onto CC 0-127 — the
editor guessed four *equal* buckets (0-31/32-63/64-95/96-127) in
`enumIndexToCC`/`ccToEnumIndex` (`midi/scaling.ts`). **Confirmed correct on
hardware** for both Tremolo and Vibrato: all four options switch the device's
waveform as expected. No code change needed.

## 5. Global/transport controls — ✅ confirmed

- [x] **Tuner** — confirmed: toggling opens/closes the device tuner.
- [x] **Prev/Next preset** (CC81/82) — confirmed: steps through stored presets.
- [x] **Direct preset recall** (Program Change) — confirmed working, **with the
      manual's "1-128 display" offset**: the device's own preset display is 1
      higher than the PC value sent (PC 0 → device "1", PC 5 → device "6").
      Documented in the app (recall panel hint + `preset_recall`'s
      description in `nanocoreSpec.ts`) so this doesn't have to be
      rediscovered by feel.
- [x] **Send patch to device** — confirmed: every block's on/off + type +
      parameters land correctly in one shot, and it's authoritative/idempotent
      — even after individually adjusting parameters live (each slider move
      already sends its own CC) or changing things directly on the device,
      hitting Send again correctly re-syncs the device to the editor's state.

## 6. Low priority / just confirm they're inert

- [~] CC22, CC42, CC29, CC49 (reserved slots per the MIDI guide) — sending
      values here should have no effect. **Skipped by choice**: even if
      tested and confirmed inert, there'd be nothing to change (no code
      exists for reserved CCs to begin with). Revisit only out of curiosity.

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
