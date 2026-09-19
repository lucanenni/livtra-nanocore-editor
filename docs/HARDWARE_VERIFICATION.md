# Hardware verification checklist

**Status: complete.** Section 2's spot-check (one param per unit "shape") turned out too
coarse — a real reading (Ratio 1.1:1→1:1) contradicted it, and the exhaustive per-param
follow-up in [PARAM_VERIFICATION.md](PARAM_VERIFICATION.md) found 5 Hz-range params are
exponential, not linear (CAB Low/High Cut, FX2 Envelope Wah/Wah Freq, MOD Velvet Vibrato
Rate — see its "Resolved" sections). Every other section here is resolved — confirmed, fixed,
or deliberately deferred/skipped by choice (section 6, and the two `[~]` items in section 1
were later resolved too — see MIDI_MAPPING_NOTES.md for the full findings log). Use
PARAM_VERIFICATION.md, not section 2 below, for any further range/taper checking. Kept here
as a record and as a template for re-running against a future firmware update.

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
- [x] **MOD / FX2 routing conflict (CC68-73)** — confirmed directly 2026-09-12.
      With FX2 set to Pitch and MOD set to Chorus (both on), sending CC68 twice
      (30, then 110) and reading the saved patch back both times: MOD's decoded
      values stayed byte-identical across both sends, while FX2 Pitch's value
      changed each time (0.25 -> 0.875 normalized) — CC68 landed on FX2, not
      MOD, exactly as the in-app warning banner says. Tested via SysEx
      save-and-read-back rather than by ear/eye on the device screen — see
      docs/MIDI_MAPPING_NOTES.md's "Routing conflicts to be aware of" section.

## 2. Linear scaling convention (spot check, not exhaustive)

> **Superseded by [PARAM_VERIFICATION.md](PARAM_VERIFICATION.md).** This
> spot-check assumed one param per unit "shape" would vouch for the rest;
> the Ratio 1.1:1→1:1 correction showed the model's *ranges* (not just the
> taper) drift from the firmware per-param. Fill in PARAM_VERIFICATION.md
> block-by-block instead. Kept below for the taper question only — whether
> any unit is non-linear rather than linear.

The MIDI guide states "Parameter: 0-127, lowest to highest value" as the general
rule; every param in the data model assumes plain linear scaling across its
documented real-world range. Checking one param per unit "shape" is enough to
tell whether the taper is linear — if these hold, the remaining parameters
almost certainly share it, since they all follow the same code path
(`realToCC`/`ccToReal`). (Per-param *range* accuracy is PARAM_VERIFICATION.md's
job, not this list's.)

- [ ] A **dB range with a negative floor** — FX1 → Compressor → Threshold
      (-60~0 dB): CC0 should read/sound like -60dB, CC127 like 0dB, CC64 roughly
      the midpoint.
- [ ] A **±dB range around zero** — AMP → any model → Bass (-10~10 dB): CC64
      should be ~0dB (flat).
- [ ] A **time/ms range** — DEL → Digital → Time (0.1~3000ms): confirm the low
      end is near-zero delay and the high end is the full 3 seconds.
- [ ] A **ratio range** — FX1 → Compressor → Ratio (1:1~20:1; the manual's
      "1.1:1" floor was wrong, fixed 2026-09-11).
- [ ] A **0-100 index range** — DEL → Digital → Feedback (0~95).
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

      **Follow-up: this decision was revisited, and SysEx reverse-engineering
      was done after all** — see MIDI_MAPPING_NOTES.md's "Resolved: AMP/CAB
      type switching and effect chain reorder are SysEx-only" section. AMP/CAB
      model selection works from the editor today via SysEx. Framing note:
      SysEx isn't a "workaround" for CC43/44 not doing this — SysEx is the
      pedal's actual patch-programming protocol, while CC exists for live
      control while playing. Model selection was never really a CC-shaped
      action to begin with; CC43/44 not doing it isn't a bug SysEx patches
      around, it's SysEx doing the job it always does.

      **Follow-up 2026-09-19: CC43/CC44 confirmed fixed on a NanoCore firmware
      update** (release notes: "Fixed MIDI CC 43 and CC 44 not responding for
      AMP and IR switching") — sending raw CC43/44 now visibly changes the
      device's AMP/CAB model on screen, confirmed on real hardware. This
      editor's own code is unchanged and still uses SysEx for AMP/CAB
      unconditionally, same as every other patch-programming action — see
      MIDI_MAPPING_NOTES.md's 2026-09-19 entry for the full writeup. The fix
      matters for *external* MIDI gear (a plain CC-only foot controller can
      now drive AMP/CAB live too, on updated firmware), not for this editor.

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
