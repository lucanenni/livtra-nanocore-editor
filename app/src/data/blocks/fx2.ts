import type { BlockSpec, EffectType } from '../types';
import { range } from '../paramHelpers';

const driveParams = () => [
  range('gain', 57, 0, 1, { decimals: 2, default: 0.5 }),
  range('tone', 58, 0, 100, { default: 50 }),
  range('level', 59, 0, 100, { default: 70 }),
];

const boostParams = () => [range('boost', 57, 0, 1, { decimals: 2, default: 0.5 })];

const drives: EffectType[] = [
  { id: 0, slug: 'scream', name: 'Scream', description: 'Based on Ibanez TS9 pedal modeling.', params: driveParams() },
  { id: 1, slug: 'klone', name: 'Klone', description: 'Based on Ryra The Klone pedal modeling.', params: driveParams() },
  { id: 2, slug: 'ocd', name: 'OCD', description: 'Based on Fulltone OCD pedal modeling.', params: driveParams() },
  { id: 3, slug: 'ds2', name: 'DS2', description: 'Based on Boss DS-2 pedal modeling.', params: driveParams() },
  { id: 4, slug: 'pifuzz', name: 'PIFUZZ', description: 'Based on EHX Big Muff Pi pedal modeling.', params: driveParams() },
];

const boosts: EffectType[] = [
  { id: 5, slug: 'range', name: 'Range', description: 'Based on Dallas-Arbiter Rangemaster pedal modeling.', params: boostParams() },
  { id: 6, slug: 'xac', name: 'XAC', description: 'Based on Xotic AC Booster pedal modeling.', params: boostParams() },
  { id: 7, slug: 'fiman', name: 'Fiman', description: 'Based on Friedman Marty Friedman pedal modeling.', params: boostParams() },
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
  'map an external MIDI expression pedal directly to CC68 (Pitch, -12~12 semitones) at the MIDI ' +
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
        range('pitch', 68, -12, 12, { unit: 'st', default: 0 }),
        range('fine', 69, -1, 1, { decimals: 2, default: 0 }),
        range('mix', 70, 0, 100, { default: 100 }),
        range('level', 71, 0, 100, { default: 70 }),
      ],
    },
    {
      id: 9,
      slug: 'envelope_wah',
      name: 'Envelope Wah',
      description: 'Auto-triggered filter sweep based on playing dynamics.',
      note: ROUTING_NOTE,
      params: [
        // Range confirmed on real hardware via audible sweep test (see HARDWARE_VERIFICATION.md):
        // the manual's literal "10.0~20kHz" is real, not a typo — the wah sweep stays musical
        // across the full slider.
        range('freq', 68, 10, 20000, { unit: 'Hz', format: 'freq', default: 400 }),
        range('env', 69, 0, 20000, { unit: 'Hz', format: 'freq', default: 2000 }),
        range('q', 70, 0.1, 20, { decimals: 1, default: 2 }),
        range('mix', 71, 0, 100, { default: 100 }),
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
        // Range confirmed on real hardware via audible sweep test (see HARDWARE_VERIFICATION.md):
        // the manual's "163~3.5kHz" (lower bound read as 163Hz) is real, sweep stays musical
        // across the full slider.
        range('freq', 68, 163, 3500, { unit: 'Hz', format: 'freq', default: 800 }),
        range('sweep', 69, 0, 100, { default: 50 }),
        range('rate', 70, 0, 8, { unit: 'Hz', decimals: 2, default: 1 }),
        range('shape', 71, 0, 100, { default: 50 }),
        range('mix', 72, 0, 100, { default: 100 }),
        range('level', 73, 0, 100, { default: 70 }),
      ],
    },
  ],
};
