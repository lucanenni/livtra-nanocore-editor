import type { BlockSpec } from '../types';
import { range } from '../paramHelpers';

const band = (id: string, cc: number, freqLabel: string) =>
  range(id, cc, -15, 15, { unit: 'dB', label: freqLabel, default: 0 });

export const eq: BlockSpec = {
  id: 'eq',
  name: 'EQ',
  onOffCC: 28,
  typeCC: 48,
  types: [
    {
      id: 0,
      slug: 'eq3',
      name: '3-band EQ',
      description: 'Quickly adjust low, mid, and high frequencies.',
      params: [
        range('low', 91, -15, 15, { unit: 'dB', default: 0 }),
        range('mid', 92, -15, 15, { unit: 'dB', default: 0 }),
        range('high', 93, -15, 15, { unit: 'dB', default: 0 }),
      ],
    },
    {
      id: 1,
      slug: 'eq6',
      name: '6-band EQ',
      description: 'Parametric multi-band fine-tuning of tone.',
      params: [
        band('b120', 91, '120 Hz'),
        band('b250', 92, '250 Hz'),
        band('b500', 93, '500 Hz'),
        band('b1k', 94, '1 kHz'),
        band('b2k', 95, '2 kHz'),
        band('b4k', 96, '4 kHz'),
      ],
    },
    {
      id: 2,
      slug: 'eq8',
      name: '8-band EQ',
      description: 'Full-range EQ; precise tonal shaping across the entire frequency spectrum.',
      params: [
        band('b60', 91, '60 Hz'),
        band('b120', 92, '120 Hz'),
        band('b250', 93, '250 Hz'),
        band('b500', 94, '500 Hz'),
        band('b1k', 95, '1 kHz'),
        band('b2k', 96, '2 kHz'),
        band('b4k', 97, '4 kHz'),
        band('b8k', 33, '8 kHz'),
      ],
    },
  ],
};
