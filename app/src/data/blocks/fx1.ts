import type { BlockSpec } from '../types';
import { range } from '../paramHelpers';

export const fx1: BlockSpec = {
  id: 'fx1',
  name: 'FX1',
  onOffCC: 20,
  typeCC: 40,
  types: [
    {
      id: 0,
      slug: 'gate',
      name: 'Gate',
      description: 'Eliminates low-level noise and purifies the input signal.',
      params: [range('threshold', 50, -100, 0, { unit: 'dB', default: -60 })],
    },
    {
      id: 1,
      slug: 'auto_gate',
      name: 'Auto Gate',
      description: 'Adaptive noise gate that automatically adjusts the threshold based on signal level changes.',
      params: [],
    },
    {
      id: 2,
      slug: 'gate_compressor',
      name: 'Gate + Compressor (NC-Com)',
      description:
        'Noise Gate + Compressor combo; simultaneously optimizes noise floor and dynamic range.',
      params: [
        range('gate_threshold', 50, -100, 0, { unit: 'dB', default: -60, label: 'Gate Threshold' }),
        range('comp_threshold', 51, -60, 0, { unit: 'dB', default: -20, label: 'Compressor Threshold' }),
        range('ratio', 52, 1.1, 20, { unit: ':1', decimals: 1, default: 4 }),
        range('knee', 53, 0, 24, { unit: 'dB', default: 6 }),
        range('attack', 54, 0, 200, { unit: 'ms', default: 10 }),
        range('release', 55, 0, 1000, { unit: 'ms', default: 150 }),
        range('makeup', 56, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 3,
      slug: 'compressor',
      name: 'Compressor',
      description: 'Smooths volume fluctuations and stabilizes tone quality.',
      params: [
        range('comp_threshold', 51, -60, 0, { unit: 'dB', default: -20, label: 'Threshold' }),
        range('ratio', 52, 1.1, 20, { unit: ':1', decimals: 1, default: 4 }),
        range('knee', 53, 0, 24, { unit: 'dB', default: 6 }),
        range('attack', 54, 0, 200, { unit: 'ms', default: 10 }),
        range('release', 55, 0, 1000, { unit: 'ms', default: 150 }),
        range('makeup', 56, -24, 24, { unit: 'dB', default: 0 }),
      ],
    },
  ],
};
