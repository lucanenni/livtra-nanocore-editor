import type { GlobalControl, NanocoreSpec } from './types';
import { fx1 } from './blocks/fx1';
import { fx2 } from './blocks/fx2';
import { amp } from './blocks/amp';
import { cab } from './blocks/cab';
import { mod } from './blocks/mod';
import { del } from './blocks/del';
import { rev } from './blocks/rev';
import { eq } from './blocks/eq';

export const globalControls: GlobalControl[] = [
  {
    id: 'tuner',
    name: 'Tuner',
    cc: 80,
    min: 0,
    max: 127,
    description: 'Value 0-63 turns the tuner OFF, 64-127 turns it ON. Use 0 / 127.',
  },
  {
    id: 'prev_preset',
    name: 'Previous Preset',
    cc: 81,
    min: 0,
    max: 127,
    description: 'Momentary trigger: send 127 to step to the previous preset, 0 on release.',
  },
  {
    id: 'next_preset',
    name: 'Next Preset',
    cc: 82,
    min: 0,
    max: 127,
    description: 'Momentary trigger: send 127 to step to the next preset, 0 on release.',
  },
  {
    id: 'preset_recall',
    name: 'Direct Preset Recall',
    isProgramChange: true,
    min: 0,
    max: 127,
    description:
      'Program Change 0-127 recalls a device preset directly. Confirmed on hardware: the ' +
      "device's own preset display is 1 higher than the PC value sent (PC 0 -> device \"1\", " +
      'PC 5 -> device "6", etc.) — matches the manual\'s documented "1-128 display, PC 0-127, ' +
      'device preset = displayed number minus 1" convention.',
  },
  {
    id: 'bank_select_msb',
    name: 'Bank Select MSB',
    cc: 0,
    min: 0,
    max: 127,
    description: 'Bank Select MSB. Current firmware normally uses bank 0.',
  },
  {
    id: 'bank_select_lsb',
    name: 'Bank Select LSB',
    cc: 32,
    min: 0,
    max: 127,
    description: 'Bank Select LSB. Current firmware normally uses bank 0.',
  },
];

export const nanocoreSpec: NanocoreSpec = {
  blocks: [fx1, fx2, amp, cab, mod, del, rev, eq],
  globalControls,
  meta: {
    firmware: '1.04+',
    presetSlots: 64,
    factoryPresets: 40,
    maxEffectModules: 'Max 8+1 effect modules (per device specifications)',
    reservedBlockSlots:
      'CC22/42 and CC29/49 are documented as unused/ignored — likely a reserved 9th block slot ' +
      '("8+1 effect modules" per specifications) not yet exposed by this firmware.',
  },
};

export { fx1, fx2, amp, cab, mod, del, rev, eq };
