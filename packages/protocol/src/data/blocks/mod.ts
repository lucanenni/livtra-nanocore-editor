import type { BlockSpec } from '../types';
import { enumP, range, rangeSysexOnly } from '../paramHelpers';

const WAVE_OPTIONS = ['Sine', 'Triangle', 'Square', 'Saw'];

export const mod: BlockSpec = {
  id: 'mod',
  name: 'MOD',
  onOffCC: 25,
  typeCC: 45,
  note:
    'CC68-73 are shared with FX2. If FX2 is set to Pitch, Envelope Wah or Wah, these CCs control FX2 ' +
    'instead of MOD — see docs/MIDI_MAPPING_NOTES.md.',
  types: [
    {
      id: 0,
      slug: 'chorus',
      name: 'Chorus',
      description: 'Classic chorus effect; widens the soundstage for a fuller, thicker tone.',
      params: [
        range('rate', 68, 0.1, 3.74, { unit: 'Hz', decimals: 2, default: 2.3 }),
        range('depth', 69, 0, 1, { unit: 'ms', decimals: 2, default: 0.5 }),
        // CC70 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 1,
      slug: 'phaser',
      name: 'Phaser',
      description: 'Phaser effect; periodic sweep filtering for a swirling, moving tone.',
      params: [
        range('rate', 68, 0.05, 5, { unit: 'Hz', decimals: 2, default: 0.5 }),
        range('feedback', 69, -95, 95, { default: 20 }),
        range('mix', 70, 0, 100, { default: 40 }),
        // CC71 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 2,
      slug: 'flanger',
      name: 'Flanger',
      description: 'Flanger effect; comb-filtering creates an ethereal, metallic floating texture.',
      params: [
        range('rate', 68, 0.05, 5, { unit: 'Hz', decimals: 2, default: 0.8 }),
        range('feedback', 69, -95, 95, { default: 55 }),
        range('mix', 70, 0, 100, { default: 35 }),
        // CC71 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 3,
      slug: 'tremolo',
      name: 'Tremolo',
      description: 'Volume tremolo; cyclically fluctuates volume based on waveform.',
      params: [
        range('rate', 68, 0.01, 20, { unit: 'Hz', decimals: 2, default: 5.01 }),
        range('depth', 69, 0, 100, { default: 60 }),
        enumP('wave', 70, WAVE_OPTIONS, { default: 0 }),
        range('smooth', 71, 0, 40, { unit: 'Hz', decimals: 2, default: 0 }),
        range('mix', 72, 0, 100, { default: 100 }),
        // CC73 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 4,
      slug: 'vibrato',
      name: 'Vibrato',
      description: 'Pitch vibrato; subtly fluctuates pitch to enrich the tone.',
      params: [
        range('rate', 68, 0.01, 20, { unit: 'Hz', decimals: 2, default: 9.01 }),
        range('depth', 69, 0, 20, { unit: 'ms', decimals: 1, default: 0.4 }),
        enumP('wave', 70, WAVE_OPTIONS, { default: 0 }),
        range('mix', 71, 0, 100, { default: 80 }),
        // CC72 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    // --- Added in a later firmware update (post-1.04, exact version unconfirmed — the manual
    // and MIDI guide have not been updated to document it). IDs are NOT continuous with the
    // original 5 above or with each other — confirmed empirically on hardware (CC45 values
    // 5-9 and 13-16 select nothing); see docs/MIDI_MAPPING_NOTES.md for the full story.
    {
      id: 10,
      slug: 'velvet_vibrato',
      name: 'Velvet Vibrato',
      description: 'Richer, multi-voice take on Vibrato from a later firmware update.',
      params: [
        // Taper confirmed exponential by a 9-point CC sweep 2026-09-11 — see
        // docs/PARAM_VERIFICATION.md.
        range('rate', 68, 0.45, 10, { unit: 'Hz', decimals: 2, default: 1, curve: 'exp' }),
        range('wave', 69, 0, 100, { default: 75 }),
        range('voice', 70, 0, 100, { default: 45 }),
        range('depth', 71, 0, 100, { default: 40 }),
        range('mix', 72, 0, 100, { default: 100 }),
      ],
    },
    {
      id: 11,
      slug: 'chorus_ii',
      name: 'Chorus II',
      description: 'Alternate chorus algorithm from a later firmware update.',
      params: [
        range('rate', 68, 0, 1, { decimals: 2, default: 0.5 }),
        range('amount', 69, 0, 1, { decimals: 2, default: 0.5 }),
        range('feedback', 70, 0, 1, { decimals: 2, default: 0 }),
        range('mix', 71, 0, 1, { decimals: 2, default: 0.5 }),
      ],
    },
    {
      id: 12,
      slug: 'phaser_ii',
      name: 'Phaser II',
      description: 'Alternate phaser algorithm from a later firmware update.',
      // CC-dead (confirmed on real hardware AND in the official app, matching the original
      // warning here) but NOT actually a firmware limitation — like Motion Wah before it,
      // confirmed 2026-09-13 to be fully controllable via the SysEx per-parameter mechanism
      // instead (opcode 0x6d, see midi/sysex.ts's buildSetParamValueSysEx). Real min/max/unit
      // and param order (Depth/Rate/Feedback/Mix) from PARAM_VERIFICATION.md's own device-screen
      // reading (gathered earlier, never wired up since these were believed fully dead).
      params: [
        rangeSysexOnly('depth', 0, 0, 100, { default: 45 }),
        rangeSysexOnly('rate', 1, 0.05, 5, { unit: 'Hz', decimals: 2, default: 2.77 }),
        rangeSysexOnly('feedback', 2, -95, 95, { default: 0 }),
        rangeSysexOnly('mix', 3, 0, 100, { default: 65 }),
      ],
    },
    {
      id: 17,
      slug: 'jet_flanger',
      name: 'Jet Flanger',
      description: 'Alternate flanger algorithm from a later firmware update.',
      // Feedback/Phase/Mix are CC-dead (confirmed on real hardware AND in the official app) but
      // NOT a firmware limitation — confirmed 2026-09-13 to be fully controllable via the SysEx
      // per-parameter mechanism instead (opcode 0x6d), same fix as Phaser II above and Motion Wah
      // before both. Real min/max/unit for all 5 params (including Rate/Depth, previously a raw
      // 0-1 placeholder despite already working via CC) from PARAM_VERIFICATION.md's own
      // device-screen reading.
      params: [
        range('rate', 68, 0.05, 5, { unit: 'Hz', decimals: 2, default: 0.55 }),
        range('depth', 69, 0, 100, { default: 70 }),
        rangeSysexOnly('feedback', 2, -95, 95, { default: 5 }),
        rangeSysexOnly('phase', 3, 0, 360, { unit: '°', default: 95 }),
        rangeSysexOnly('mix', 4, 0, 100, { default: 55 }),
      ],
    },
  ],
};
