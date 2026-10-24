import type { BlockSpec } from '../types';
import { range, rangeSysexOnly } from '../paramHelpers';

export const del: BlockSpec = {
  id: 'del',
  name: 'DEL',
  onOffCC: 26,
  typeCC: 46,
  types: [
    {
      id: 0,
      slug: 'bbd',
      name: 'BBD',
      description: 'Classic BBD analog delay; vintage warm tape delay texture.',
      params: [
        range('delay', 74, 1, 2000, { unit: 'ms', format: 'time', default: 350 }),
        range('feedback', 75, 0, 95, { default: 48 }),
        range('age', 76, 0, 100, { default: 65 }),
        range('mix', 77, 0, 100, { default: 40 }),
        // CC78 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 1,
      slug: 'digital',
      name: 'Digital',
      description: 'Clean digital delay; clear and transparent tone, suitable for various genres.',
      params: [
        range('time', 74, 0.1, 3000, { unit: 'ms', format: 'time', default: 350 }),
        range('feedback', 75, 0, 95, { default: 32 }),
        range('mix', 76, 0, 100, { default: 32 }),
        // CC77 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 2,
      slug: 'duck',
      name: 'Duck',
      description: 'Duck delay; automatically lowers delay tail during playing to avoid muddiness.',
      params: [
        range('time', 74, 0.1, 3000, { unit: 'ms', format: 'time', default: 450 }),
        range('feedback', 75, 0, 95, { default: 42 }),
        // Firmware 1.12 repurposed CC76/CC77 from Filter/Mix to these two new controls — confirmed
        // on real hardware (screen cross-checked against the 0x63 live read at several values).
        // Filter and Mix didn't disappear, they moved to sysexParamIndex 6/7 below.
        range('sensitivity', 76, 0, 100, { default: 50 }),
        range('depth', 77, 0, 100, { default: 50 }),
        // New in firmware 1.12, confirmed on real hardware (screen-read range, no CC in the MIDI
        // guide) — sent via the SysEx per-parameter mechanism, same as rangeSysexOnly below.
        range('attack', 78, 0.1, 100, { unit: 'ms', decimals: 1, default: 5 }),
        range('release', 79, 10, 2000, { unit: 'ms', default: 200 }),
        // Moved off CC76/CC77 by firmware 1.12 (see sensitivity/depth above) to make room for
        // them — still real controls, just CC-less now. Confirmed via buildSetParamValueSysEx at
        // paramIndex 6/7 moving exactly these two screen fields.
        rangeSysexOnly('filter', 6, 0, 100, { default: 55 }),
        rangeSysexOnly('mix', 7, 0, 100, { default: 40 }),
      ],
    },
    {
      id: 3,
      slug: 'ice',
      name: 'Ice',
      description: 'Ice pitch-shift delay; delayed signal with pitch offset for ethereal atmosphere.',
      params: [
        range('time', 74, 0.1, 3000, { unit: 'ms', format: 'time', default: 501 }),
        range('feedback', 75, 0, 95, { default: 30 }),
        range('interval', 76, -12, 12, { unit: 'st', default: 12 }),
        range('mix', 77, 0, 100, { default: 40 }),
        // CC78 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 4,
      slug: 'reverse',
      name: 'Reverse',
      description: 'Reverse delay; plays back delay signal in reverse for a dreamy spatial effect.',
      params: [
        range('time', 74, 0.1, 3000, { unit: 'ms', format: 'time', default: 600 }),
        range('feedback', 75, 0, 95, { default: 25 }),
        range('mix', 76, 0, 100, { default: 50 }),
        // CC77 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 5,
      slug: 'lofi',
      name: 'LoFi',
      description: 'Lo-fi delay; bit-rate distortion creates vintage degraded tape texture.',
      params: [
        range('time', 74, 2, 3000, { unit: 'ms', format: 'time', default: 350 }),
        range('feedback', 75, 0, 95, { default: 40 }),
        range('bit_depth', 76, 4, 16, { unit: 'bit', label: 'Bit Depth', default: 8 }),
        range('lofi_mix', 77, 0, 100, { label: 'LoFi Mix', default: 70 }),
        range('mix', 78, 0, 100, { default: 40 }),
        // CC79 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 6,
      slug: 'smear',
      name: 'Smear',
      description: 'Smear delay; softens and blurs delay signal for a gentle spatial diffusion.',
      params: [
        range('time', 74, 0.1, 3000, { unit: 'ms', format: 'time', default: 651 }),
        range('feedback', 75, 0, 95, { default: 45 }),
        range('smear', 76, 0, 100, { default: 68 }),
        range('filter', 77, 0, 100, { default: 42 }),
        range('mix', 78, 0, 100, { default: 40 }),
        // CC79 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 7,
      slug: 'mod_delay',
      name: 'Mod Delay',
      description: 'Modulated delay; delay with tremolo wobble for richer tonal layers.',
      params: [
        range('time', 74, 0.1, 3000, { unit: 'ms', format: 'time', default: 420 }),
        range('feedback', 75, 0, 95, { default: 38 }),
        range('mod_depth', 76, 0, 20, { unit: 'ms', label: 'Mod Depth', default: 4 }),
        range('mod_rate', 77, 0.05, 5, { unit: 'Hz', decimals: 2, label: 'Mod Rate', default: 1 }),
        range('mix', 78, 0, 100, { default: 40 }),
        // CC79 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
  ],
};
