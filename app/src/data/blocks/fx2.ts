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

export const fx2: BlockSpec = {
  id: 'fx2',
  name: 'FX2',
  onOffCC: 21,
  typeCC: 41,
  note: 'CC68-73 are shared with MOD; see individual type notes for Pitch / Envelope Wah / Wah.',
  types: [
    ...drives,
    ...boosts,
    {
      id: 8,
      slug: 'pitch',
      name: 'Pitch',
      description: 'Pitch shift effect; changes the signal pitch.',
      note: ROUTING_NOTE,
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
        range('freq', 68, 10, 20000, {
          unit: 'Hz',
          format: 'freq',
          default: 400,
          note: 'Manual prints "10.0~20kHz" verbatim; a sub-audio base frequency around 10Hz-20kHz is assumed. See MIDI_MAPPING_NOTES.md.',
        }),
        range('env', 69, 0, 20000, { unit: 'Hz', format: 'freq', default: 2000 }),
        range('q', 70, 0.1, 20, { decimals: 1, default: 2 }),
        range('mix', 71, 0, 100, { default: 100 }),
        range('level', 72, 0, 100, { default: 70 }),
      ],
    },
    {
      id: 10,
      slug: 'wah',
      name: 'Wah',
      description: 'Cyclic sweep filter with a set waveform.',
      note: ROUTING_NOTE,
      params: [
        range('freq', 68, 163, 3500, {
          unit: 'Hz',
          format: 'freq',
          default: 800,
          note: 'Manual prints "163~3.5kHz"; lower bound interpreted as 163Hz. See MIDI_MAPPING_NOTES.md.',
        }),
        range('sweep', 69, 0, 100, { default: 50 }),
        range('rate', 70, 0, 8, { unit: 'Hz', decimals: 2, default: 1 }),
        range('shape', 71, 0, 100, { default: 50 }),
        range('mix', 72, 0, 100, { default: 100 }),
        range('level', 73, 0, 100, { default: 70 }),
      ],
    },
  ],
};
