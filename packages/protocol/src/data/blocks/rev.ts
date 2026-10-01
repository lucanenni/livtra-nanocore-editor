import type { BlockSpec } from '../types';
import { range } from '../paramHelpers';

export const rev: BlockSpec = {
  id: 'rev',
  name: 'REV',
  onOffCC: 27,
  typeCC: 47,
  types: [
    {
      id: 0,
      slug: 'room',
      name: 'Room',
      description: 'Room reverb; simulates a small indoor space with a compact, natural sound.',
      params: [
        range('decay', 85, 0.5, 12, { unit: 's', decimals: 1, default: 1.2 }),
        range('pre_delay', 86, 0, 80, { unit: 'ms', label: 'Pre Delay', default: 5 }),
        range('tone', 87, 0, 100, { default: 65 }),
        range('mod', 88, 0, 100, { default: 10 }),
        range('mix', 89, 0, 100, { default: 30 }),
        // CC90 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 1,
      slug: 'plate',
      name: 'Plate',
      description: 'Plate reverb; classic metal plate vintage tone, warm and smooth.',
      params: [
        range('decay', 85, 0.5, 12, { unit: 's', decimals: 1, default: 2.5 }),
        range('pre_delay', 86, 0, 80, { unit: 'ms', label: 'Pre Delay', default: 12 }),
        range('tone', 87, 0, 100, { default: 70 }),
        range('mod', 88, 0, 100, { default: 25 }),
        range('mix', 89, 0, 100, { default: 35 }),
        // CC90 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 2,
      slug: 'hall',
      name: 'Hall',
      description: 'Hall reverb; simulates a large concert hall with a wide, grand spatial feel.',
      params: [
        range('decay', 85, 0.5, 12, { unit: 's', decimals: 1, default: 4 }),
        range('pre_delay', 86, 0, 80, { unit: 'ms', label: 'Pre Delay', default: 24 }),
        range('tone', 87, 0, 100, { default: 58 }),
        range('lf_damp', 88, 0, 100, { label: 'LF Damp', default: 40 }),
        range('mix', 89, 0, 100, { default: 38 }),
        // CC90 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 3,
      slug: 'concert',
      name: 'Concert',
      description: 'Concert hall reverb; transparent and structured, ideal for solo performances.',
      params: [
        range('decay', 85, 0.5, 12, { unit: 's', decimals: 1, default: 5.5 }),
        range('pre_delay', 86, 0, 80, { unit: 'ms', label: 'Pre Delay', default: 32 }),
        range('hf_damp', 87, 0, 100, { label: 'HF Damp', default: 55 }),
        range('mod', 88, 0, 100, { default: 30 }),
        range('mix', 89, 0, 100, { default: 40 }),
        // CC90 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      // The MIDI guide's explicit "Reverb quick check" callout ("CC47: 4=Shimmer, 5=Cloud,
      // 6=Spring") is authoritative for the CC value — it disagrees with the user manual's
      // plain listing order (Room/Plate/Hall/Concert/Spring/Shimmer/Cloud), which is what
      // this used to follow. Confirmed wrong against real hardware (a 3-way rotation between
      // these final three types) and fixed to match the MIDI guide's table.
      id: 4,
      slug: 'shimmer',
      name: 'Shimmer',
      description: 'Shimmer reverb; pitch-shifted overtones create an ethereal, dreamy atmosphere.',
      params: [
        range('decay', 85, 0, 12, { unit: 's', decimals: 1, default: 3.2 }),
        range('pre_delay', 86, 5, 120, { unit: 'ms', label: 'Pre Delay', default: 5 }),
        range('tone', 87, 0, 100, { default: 58 }),
        range('pitch', 88, -24, 24, { unit: 'st', default: 12 }),
        range('mix', 89, 0, 100, { default: 50 }),
        // CC90 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 5,
      slug: 'cloud',
      name: 'Cloud',
      description: 'Cloud ambient reverb; ultra-long decay with soft modulation for a floating environmental feel.',
      params: [
        range('decay', 85, 1, 100, { unit: 's', decimals: 0, default: 55 }),
        range('tone', 86, 0, 100, { default: 75 }),
        range('mod_depth', 87, 0, 100, { label: 'Mod Depth', default: 40 }),
        range('mod_rate', 88, 0.02, 0.25, { unit: 'Hz', decimals: 2, label: 'Mod Rate', default: 0.1 }),
        range('mix', 89, 0, 100, { default: 50 }),
        // CC90 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
    {
      id: 6,
      slug: 'spring',
      name: 'Spring',
      description: 'Spring reverb; emulates vintage amp spring reverb with retro-rock texture.',
      params: [
        range('decay', 85, 0, 12, { unit: 's', decimals: 1, default: 2 }),
        range('pre_delay', 86, 5, 80, { unit: 'ms', label: 'Pre Delay', default: 20 }),
        range('crossover', 87, 800, 8000, { unit: 'Hz', format: 'freq', default: 4501 }),
        range('mod', 88, 0, 100, { default: 20 }),
        range('mix', 89, 0, 100, { default: 50 }),
        // CC90 "Level" confirmed absent from both the device screen and ToneCommand — not a
        // real control for this type. See docs/PARAM_VERIFICATION.md.
      ],
    },
  ],
};
