import type { BlockSpec } from '../types';
import { enumP, range } from '../paramHelpers';

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
        range('rate', 68, 0.1, 3.74, { unit: 'Hz', decimals: 2, default: 1 }),
        range('depth', 69, 0, 1, { unit: 'ms', decimals: 2, default: 0.5 }),
        range('level', 70, 0, 100, { default: 70 }),
      ],
    },
    {
      id: 1,
      slug: 'phaser',
      name: 'Phaser',
      description: 'Phaser effect; periodic sweep filtering for a swirling, moving tone.',
      params: [
        range('rate', 68, 0.05, 5, { unit: 'Hz', decimals: 2, default: 0.5 }),
        range('feedback', 69, -95, 95, { default: 30 }),
        range('mix', 70, 0, 100, { default: 50 }),
        range('level', 71, 0, 100, { default: 70 }),
      ],
    },
    {
      id: 2,
      slug: 'flanger',
      name: 'Flanger',
      description: 'Flanger effect; comb-filtering creates an ethereal, metallic floating texture.',
      params: [
        range('rate', 68, 0.05, 5, { unit: 'Hz', decimals: 2, default: 0.3 }),
        range('feedback', 69, -95, 95, { default: 50 }),
        range('mix', 70, 0, 100, { default: 50 }),
        range('level', 71, 0, 100, { default: 70 }),
      ],
    },
    {
      id: 3,
      slug: 'tremolo',
      name: 'Tremolo',
      description: 'Volume tremolo; cyclically fluctuates volume based on waveform.',
      params: [
        range('rate', 68, 0.01, 20, { unit: 'Hz', decimals: 2, default: 4 }),
        range('depth', 69, 0, 100, { default: 60 }),
        enumP('wave', 70, WAVE_OPTIONS, { default: 0 }),
        range('smooth', 71, 0, 40, { unit: 'Hz', decimals: 2, default: 5 }),
        range('mix', 72, 0, 100, { default: 100 }),
        range('level', 73, 0, 100, { default: 70 }),
      ],
    },
    {
      id: 4,
      slug: 'vibrato',
      name: 'Vibrato',
      description: 'Pitch vibrato; subtly fluctuates pitch to enrich the tone.',
      params: [
        range('rate', 68, 0.01, 20, { unit: 'Hz', decimals: 2, default: 5 }),
        range('depth', 69, 0, 20, { unit: 'ms', decimals: 1, default: 3 }),
        enumP('wave', 70, WAVE_OPTIONS, { default: 0 }),
        range('mix', 71, 0, 100, { default: 50 }),
        range('level', 72, 0, 100, { default: 70 }),
      ],
    },
  ],
};
