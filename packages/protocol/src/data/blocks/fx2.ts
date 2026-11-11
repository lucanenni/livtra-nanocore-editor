import type { BlockSpec, EffectType } from '../types';
import { range, rangeSysexOnly } from '../paramHelpers';

const driveParams = () => [
  range('gain', 57, 0, 1, { decimals: 2, default: 0.5 }),
  range('tone', 58, 0, 100, { default: 50 }),
  range('level', 59, 0, 100, { default: 80 }),
];

const drives: EffectType[] = [
  { id: 0, slug: 'scream', name: 'Scream', description: 'Based on Ibanez TS9 pedal modeling.', params: driveParams() },
  { id: 1, slug: 'klone', name: 'Klone', description: 'Based on Ryra The Klone pedal modeling.', params: driveParams() },
  { id: 2, slug: 'ocd', name: 'OCD', description: 'Based on Fulltone OCD pedal modeling.', params: driveParams() },
  { id: 3, slug: 'ds2', name: 'DS2', description: 'Based on Boss DS-2 pedal modeling.', params: driveParams() },
  { id: 4, slug: 'pifuzz', name: 'PIFUZZ', description: 'Based on EHX Big Muff Pi pedal modeling.', params: driveParams() },
];

// Previously a single 'boost' param (CC57 only) — confirmed wrong 2026-11-12 via a live
// ToneCommand capture (same rig as buildSetBlockTypeSysEx's own discovery): all three of these
// send the exact same 3-param Gain/Tone/Level defaults (CC57-59) as the drives above, not a lone
// knob. The MIDI Control User Guide's own single-CC listing for these three was itself wrong, or
// this device just reuses the drive block's full param layout for its boost types too.
const boosts: EffectType[] = [
  { id: 5, slug: 'range', name: 'Range', description: 'Based on Dallas-Arbiter Rangemaster pedal modeling.', params: driveParams() },
  { id: 6, slug: 'xac', name: 'XAC', description: 'Based on Xotic AC Booster pedal modeling.', params: driveParams() },
  { id: 7, slug: 'fiman', name: 'Fiman', description: 'Based on Friedman Marty Friedman pedal modeling.', params: driveParams() },
];

const ROUTING_NOTE =
  'Shares CC68-73 with the MOD block. While FX2 is set to Pitch, Envelope Wah or Wah, those six CCs ' +
  'control this effect instead of MOD — see docs/MIDI_MAPPING_NOTES.md.';

const WAH_NOTE =
  ROUTING_NOTE +
  ' Tip — emulating a classic pedal-controlled wah: set Rate and Sweep to 0 (disables the ' +
  'automatic cyclic sweep), then map an external MIDI expression pedal directly to CC68 (Freq, ' +
  'confirmed 163Hz-3.5kHz on hardware) at the MIDI level. This editor is send-only and does not ' +
  "listen for MIDI input, so the pedal doesn't go through the app — connect it straight to the " +
  "NanoCore's MIDI bus (USB-MIDI hub, or NanoCore MIDI over Bluetooth) on a matching channel, and " +
  "your foot position drives Freq in real time exactly like a physical treadle would.";

const PITCH_NOTE =
  ROUTING_NOTE +
  ' Tip — same trick as the Wah type\'s pedal tip works here for a Digitech Whammy-style effect: ' +
  'map an external MIDI expression pedal directly to CC68 (Pitch, -24~24 semitones) at the MIDI ' +
  'level (not through this send-only editor) for real-time foot-controlled pitch bending.';

export const fx2: BlockSpec = {
  id: 'fx2',
  name: 'FX2',
  onOffCC: 21,
  typeCC: 41,
  types: [
    ...drives,
    ...boosts,
    {
      id: 8,
      slug: 'pitch',
      name: 'Pitch',
      description: 'Pitch shift effect; changes the signal pitch.',
      note: PITCH_NOTE,
      params: [
        // Range extended from ±12 to ±24 semitones by firmware 1.12, confirmed on real hardware
        // (CC68=0 -> screen reads -24st, CC68=127 -> +24st). Same CC, same fine/mix.
        range('pitch', 68, -24, 24, { unit: 'st', default: 0 }),
        range('fine', 69, -1, 1, { decimals: 2, default: 0 }),
        range('mix', 70, 0, 100, { default: 100 }),
        // CC71 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 9,
      slug: 'envelope_wah',
      name: 'Envelope Wah',
      description: 'Auto-triggered filter sweep based on playing dynamics.',
      note: ROUTING_NOTE,
      params: [
        // Range confirmed on real hardware via audible sweep test (see HARDWARE_VERIFICATION.md).
        // Taper confirmed exponential by a 9-point CC sweep 2026-09-11 (linear was off by up to
        // ~1000% mid-range) — see docs/PARAM_VERIFICATION.md. `env` likely shares the same taper
        // (same 0-20000Hz range) but hasn't been measured yet — left linear until it is.
        range('freq', 68, 10, 20000, { unit: 'Hz', format: 'freq', default: 400, curve: 'exp' }),
        range('env', 69, 0, 20000, { unit: 'Hz', format: 'freq', default: 1000 }),
        range('q', 70, 0.1, 20, { decimals: 1, default: 8 }),
        range('mix', 71, 0, 100, { default: 80 }),
        // CC72 "Level" confirmed non-functional on real hardware (firmware 1.04+) — Freq/Env/Q/Mix
        // (CC68-71) all update correctly on-device, Level does not. See MIDI_MAPPING_NOTES.md.
      ],
    },
    {
      id: 10,
      slug: 'wah',
      name: 'Wah',
      description: 'Cyclic sweep filter with a set waveform.',
      note: WAH_NOTE,
      params: [
        // Range confirmed on real hardware via audible sweep test (see HARDWARE_VERIFICATION.md).
        // Taper confirmed exponential by a 9-point CC sweep 2026-09-11 — see
        // docs/PARAM_VERIFICATION.md.
        range('freq', 68, 163, 3500, { unit: 'Hz', format: 'freq', default: 800, curve: 'exp' }),
        range('sweep', 69, 0, 100, { default: 50 }),
        range('rate', 70, 0, 8, { unit: 'Hz', decimals: 2, default: 1.5 }),
        range('shape', 71, 0, 100, { default: 0 }),
        range('mix', 72, 0, 100, { default: 80 }),
        // CC73 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    // Added in a later firmware update (post-1.04, exact version unconfirmed — manual/MIDI
    // guide not updated yet). Confirmed contiguous with Wah (id 10) — unlike MOD's new types
    // from the same update, which landed non-contiguously. See MIDI_MAPPING_NOTES.md.
    {
      id: 11,
      slug: 'motion_wah',
      name: 'Motion Wah',
      description: 'Cyclic wah filter from a later firmware update.',
      note: ROUTING_NOTE,
      params: [
        range('rate', 68, 0, 15, { unit: 'Hz', decimals: 1, default: 2 }),
        range('voice', 69, 0, 100, { default: 50 }),
        // Neither has a CC — resolved 2026-09-12 via the SysEx per-parameter mechanism (see
        // midi/sysex.ts's SET_FIELD_OPCODE doc comment), NOT a firmware limitation as an earlier
        // note here claimed (that finding was only that the device's own screen doesn't refresh
        // immediately after ToneCommand sets these — a display bug, not a real failure to set).
        // `sysexParamIndex` skips 2: the device's own param array has an always-zero reserved
        // slot there (confirmed empirically, sending index 2 for Sweep landed at index 3 instead
        // — likely a leftover from copying Wah's 5-param layout when this type was added).
        rangeSysexOnly('sweep', 3, 0, 100, { default: 55 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 100 }),
      ],
    },
    // Firmware 1.3.5 added 9 more FX2 types (ids 12-20). ids 12-17 confirmed 2026-11-12 via a
    // live ToneCommand capture (same rig as buildSetBlockTypeSysEx's own discovery) of a full
    // sweep through every FX2 type — each one's normalized default floats matched an existing,
    // already-confirmed type's own defaults exactly (Gate/Auto Gate/Gate+Compressor/Compressor
    // from FX1's ids 0-3, Peak Comp/Parallel Comp from FX1's ids 7-8), fixing one real mistake
    // from an earlier screen-read-while-cycling-typeCC pass: id 12 is plain Gate, not a distinct
    // "Gate Wah" as that read had it (see fx1.ts's own comment on why that method proved
    // unreliable for several of FX1's own new ids too). ids 18-20 (Classic/Retro/Bass Wah) still
    // only have their names and param counts confirmed, matching FX1's own copies at ids 9-11.
    {
      id: 12,
      slug: 'gate',
      name: 'Gate',
      description: 'Eliminates low-level noise and purifies the input signal. New in firmware 1.3.5 — the same effect FX1 already had.',
      // Confirmed 2026-11-12 via live ToneCommand capture: floats [0.2, 0.4737] match FX1's own
      // Gate (-80dB/-100..0 and 50ms/5..100) exactly — this is plain Gate, not a distinct "Gate
      // Wah" as an earlier screen-read-while-cycling-typeCC pass had guessed (see this block's
      // top-of-section comment on why that method proved unreliable for the new ids). Threshold
      // confirmed the same day to respond to CC68 on real hardware — kept here for reference
      // (the CC Reference page, external controllers) even though this editor always sends every
      // type param via SysEx regardless of `cc` — see `NanoCoreDevice.sendParam`'s own comment.
      note: ROUTING_NOTE,
      params: [
        range('threshold', 68, -100, 0, { unit: 'dB', default: -80 }),
        range('release', 69, 5, 100, { unit: 'ms', decimals: 1, default: 50 }),
      ],
    },
    {
      id: 13,
      slug: 'auto_gate',
      name: 'Auto Gate',
      description: 'Adaptive noise gate that automatically adjusts the threshold based on signal level changes. New in firmware 1.3.5 — the same effect FX1 already had.',
      note: ROUTING_NOTE,
      params: [
        range('sensitivity', 68, -6, 60, { unit: 'dB', decimals: 1, default: 27 }),
        range('release', 69, 20, 300, { unit: 'ms', decimals: 1, default: 109.9 }),
      ],
    },
    {
      id: 14,
      slug: 'gate_compressor',
      name: 'Gate + Compressor (NC-Com)',
      description: 'Noise Gate + Compressor combo; simultaneously optimizes noise floor and dynamic range. New in firmware 1.3.5 — the same effect FX1 already had.',
      // CC68-73 only covers 6 slots; this type's 7th param (Makeup) has no CC the same way
      // Motion Wah's reserved slot doesn't, so it's the one with no `cc` here.
      note: ROUTING_NOTE,
      params: [
        range('gate_threshold', 68, -100, 0, { unit: 'dB', default: -80, label: 'Gate Threshold' }),
        range('comp_threshold', 69, -60, 0, { unit: 'dB', default: -20, label: 'Compressor Threshold' }),
        range('ratio', 70, 1, 20, { unit: ':1', decimals: 1, default: 4 }),
        range('knee', 71, 0, 24, { unit: 'dB', default: 0 }),
        range('attack', 72, 0, 200, { unit: 'ms', default: 10 }),
        range('release', 73, 0, 1000, { unit: 'ms', default: 100 }),
        rangeSysexOnly('makeup', 6, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 15,
      slug: 'compressor',
      name: 'Compressor',
      description: 'Smooths volume fluctuations and stabilizes tone quality. New in firmware 1.3.5 — the same effect FX1 already had.',
      note: ROUTING_NOTE,
      params: [
        range('comp_threshold', 68, -60, 0, { unit: 'dB', default: -20, label: 'Threshold' }),
        range('ratio', 69, 1, 20, { unit: ':1', decimals: 1, default: 4 }),
        range('knee', 70, 0, 24, { unit: 'dB', default: 0 }),
        range('attack', 71, 0, 200, { unit: 'ms', default: 10 }),
        range('release', 72, 0, 1000, { unit: 'ms', default: 100 }),
        range('makeup', 73, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 16,
      slug: 'peak_comp',
      name: 'Peak Comp',
      description: 'New in firmware 1.3.5. A faster-responding compressor variant — no Knee control, and noticeably quicker Attack/Release ranges than Compressor.',
      // Same effect as FX1's own copy (id 7) — see that file's own comment for how the names,
      // ranges and defaults were confirmed (live ToneCommand capture + device screen read).
      // Threshold confirmed to also respond to CC68 — kept for reference, see Gate's own comment.
      note: ROUTING_NOTE,
      params: [
        range('threshold', 68, -60, 0, { unit: 'dB', default: -6 }),
        range('ratio', 69, 1, 20, { unit: ':1', decimals: 1, default: 2 }),
        range('attack', 70, 0, 32, { unit: 'ms', decimals: 1, default: 22.9 }),
        range('release', 71, 0, 56, { unit: 'ms', decimals: 1, default: 23.1 }),
        range('makeup', 72, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 17,
      slug: 'parallel_comp',
      name: 'Parallel Comp',
      description: 'New in firmware 1.3.5. Blends a heavily compressed signal with the dry input instead of a Ratio/Makeup pair.',
      // Same effect as FX1's own copy (id 8) — see that file's own comment for what's confirmed
      // (every range/default here) vs. not (Attack/Release's curve). CC68-72 assumed from the
      // universal FX2 routing confirmed on Classic Wah/Peak Comp/Gate — not independently
      // re-tested on this specific type.
      note: ROUTING_NOTE,
      params: [
        range('threshold', 68, -60, 0, { unit: 'dB', default: -12 }),
        range('attack', 69, 0.01, 250, { unit: 'ms', decimals: 2, default: 2.2, note: 'Range/default confirmed on real hardware; curve (linear here) is not — see FX1\'s own copy of this type.' }),
        range('release', 70, 10, 2500, { unit: 'ms', decimals: 1, default: 216, note: 'Range/default confirmed on real hardware; curve (linear here) is not — see FX1\'s own copy of this type.' }),
        range('mix', 71, 0, 200, { default: 200 }),
        range('level', 72, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 18,
      slug: 'classic_wah',
      name: 'Classic Wah',
      description: 'New in firmware 1.3.5. A fixed-band wah with separate Low/High cutoff controls instead of a cyclic sweep.',
      // Same effect as FX1's own copy (id 9) — see that file's own comment for how the names,
      // ranges and defaults were confirmed (device screen read, every capture float an exact
      // match under linear scaling). Capture floats for this id matched FX1's copy exactly. All 5
      // params confirmed to also respond to CC68-72 — kept for reference, see Gate's own comment.
      note: ROUTING_NOTE,
      params: [
        range('position', 68, 0, 100, { default: 0 }),
        range('low_freq', 69, 20, 500, { unit: 'Hz', format: 'freq', default: 455, label: 'Low Freq' }),
        range('high_freq', 70, 500, 5000, { unit: 'Hz', format: 'freq', default: 2155, label: 'High Freq' }),
        range('mix', 71, 0, 100, { default: 100 }),
        range('level', 72, -60, 6, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 19,
      slug: 'retro_wah',
      name: 'Retro Wah',
      description: 'New in firmware 1.3.5. A fixed-band wah with separate Low/High cutoff controls instead of a cyclic sweep.',
      // Same effect as FX1's own copy (id 10) — see that file's own comment. CC68-72 assumed from
      // the universal FX2 routing confirmed on Classic Wah/Peak Comp/Gate — not independently
      // re-tested on this specific type.
      note: ROUTING_NOTE,
      params: [
        range('position', 68, 0, 100, { default: 0 }),
        range('low_freq', 69, 20, 500, { unit: 'Hz', format: 'freq', default: 435, label: 'Low Freq' }),
        range('high_freq', 70, 500, 5000, { unit: 'Hz', format: 'freq', default: 1901, label: 'High Freq' }),
        range('mix', 71, 0, 100, { default: 100 }),
        range('level', 72, -60, 6, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 20,
      slug: 'bass_wah',
      name: 'Bass Wah',
      description: 'New in firmware 1.3.5. A fixed-band wah voiced for bass, with Q/Volume trim controls instead of Classic/Retro Wah\'s Low/High Freq pair.',
      // Same effect as FX1's own copy (id 11) — see that file's own comment. CC68-72 assumed from
      // the universal FX2 routing confirmed on Classic Wah/Peak Comp/Gate — not independently
      // re-tested on this specific type.
      note: ROUTING_NOTE,
      params: [
        range('position', 68, 0, 100, { default: 0 }),
        range('q_trim', 69, 0, 100, { default: 100, label: 'Q Trim' }),
        range('volume_trim', 70, 0, 100, { default: 70, label: 'Volume Trim' }),
        range('mix', 71, 0, 100, { default: 100 }),
        range('level', 72, -60, 6, { unit: 'dB', default: 0 }),
      ],
    },
  ],
};
