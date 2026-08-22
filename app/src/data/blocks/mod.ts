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
        range('rate', 68, 0.45, 10, { unit: 'Hz', decimals: 2, default: 5 }),
        range('wave', 69, 0, 100, { default: 50 }),
        range('voice', 70, 0, 100, { default: 50 }),
        range('depth', 71, 0, 100, { default: 50 }),
        range('mix', 72, 0, 100, { default: 50 }),
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
      warning:
        'Confirmed on real hardware: none of this type\'s parameters respond to MIDI — and not ' +
        'from the official Livtra app either, so this looks like a current firmware limitation ' +
        'rather than something specific to this editor. Selecting Phaser II itself works fine; ' +
        'its Depth/Rate/Feedback/Mix controls just have no effect yet. See MIDI_MAPPING_NOTES.md.',
      params: [],
    },
    {
      id: 17,
      slug: 'jet_flanger',
      name: 'Jet Flanger',
      description: 'Alternate flanger algorithm from a later firmware update.',
      warning:
        "Confirmed on real hardware: Feedback, Phase and Mix don't respond to MIDI — and not " +
        'from the official Livtra app either, so this looks like a current firmware limitation ' +
        'rather than something specific to this editor. Only Rate and Depth (shown below) work; ' +
        'the other three are omitted here rather than shown as dead controls. See MIDI_MAPPING_NOTES.md.',
      params: [
        range('rate', 68, 0, 1, { decimals: 2, default: 0.5 }),
        range('depth', 69, 0, 1, { decimals: 2, default: 0.5 }),
      ],
    },
  ],
};
