import type { BlockSpec, EffectType } from '../types';
import { range } from '../paramHelpers';

/** [slug, display name, description] for all 30 CAB IR models, in manual order (id = index). */
const MODELS: [string, string, string][] = [
  ['bog412a', 'Bog412A', 'Based on Bogner 4x12 cabinet — Tone A'],
  ['bog412b', 'Bog412B', 'Based on Bogner 4x12 cabinet — Tone B'],
  ['eng412a', 'Eng412A', 'Based on ENGL E412 Pro Vintage30 4x12 cabinet — Tone A'],
  ['eng412b', 'Eng412B', 'Based on ENGL E412 Pro Vintage30 4x12 cabinet — Tone B'],
  ['fdtr212', 'FdTR212', 'Based on Fender Twin Reverb Darkface 2x12 cabinet'],
  ['fd59bm410', 'Fd59BM410', 'Based on Fender 1959 Bassman 4x10 cabinet'],
  ['hiw412', 'Hiw412', 'Based on Hiwatt Brilliant 4x12 cabinet'],
  ['mar412a', 'Mar412A', 'Based on Marshall V30 4x12 cabinet — Tone A'],
  ['mar412b', 'Mar412B', 'Based on Marshall V30 4x12 cabinet — Tone B'],
  ['mar96412a', 'Mar96412A', 'Based on Marshall 1960B 4x12 cabinet — Tone A'],
  ['mar96412b', 'Mar96412B', 'Based on Marshall 1960B 4x12 cabinet — Tone B'],
  ['mes412a', 'Mes412A', 'Based on Mesa/Boogie Oversized V30 4x12 cabinet — Tone A'],
  ['mes412b', 'Mes412B', 'Based on Mesa/Boogie Oversized V30 4x12 cabinet — Tone B'],
  ['mes412c', 'Mes412C', 'Based on Mesa/Boogie Oversized V30 4x12 cabinet — Tone C'],
  ['og412', 'Og412', 'Based on Orange Vintage30 4x12 cabinet'],
  ['pey412a', 'pey412A', 'Based on Peavey 5150 4x12 cabinet — Tone A'],
  ['pey412b', 'pey412B', 'Based on Peavey 5150 4x12 cabinet — Tone B'],
  ['peyvk412', 'peyVk412', 'Based on Peavey Valveking 4x12 cabinet'],
  ['ran112a', 'Ran112A', 'Based on Randall RD112 1x12 cabinet — Tone A'],
  ['ran112b', 'Ran112B', 'Based on Randall RD112 1x12 cabinet — Tone B'],
  ['ran112c', 'Ran112C', 'Based on Randall RD112 1x12 cabinet — Tone C'],
  ['slo412a', 'SLO412A', 'Based on Soldano SLO412 4x12 cabinet — Tone A'],
  ['slo412b', 'SLO412B', 'Based on Soldano SLO412 4x12 cabinet — Tone B'],
  ['slo412c', 'SLO412C', 'Based on Soldano SLO412 4x12 cabinet — Tone C'],
  ['ac30212', 'AC30212', 'Based on VOX AC30 2x12 cabinet'],
  ['ap810', 'AP810', 'Based on Ampeg 8x10 cabinet'],
  ['ap410', 'Ap410', 'Based on Ampeg SVT 4x10 cabinet'],
  ['adn410', 'Adn410', 'Based on Ashdown 4x10 cabinet'],
  ['hiwb410', 'HiwB410', 'Based on Hiwatt B410 4x10 cabinet'],
  ['mar412', 'Mar412', 'Based on Marshall 4x12 cabinet'],
];

const types: EffectType[] = MODELS.map(([slug, name, description], id) => ({
  id,
  slug,
  name,
  description,
  params: [],
}));

export const cab: BlockSpec = {
  id: 'cab',
  name: 'CAB',
  onOffCC: 24,
  typeCC: 44,
  warning:
    'Changing the cabinet below has NO effect on the device — confirmed on real hardware. Only ' +
    'On/Off and Low Cut/High Cut work remotely; cabinet selection appears to require SysEx (as ' +
    'used by the official Livtra app), which this documented-CC-only editor does not implement. ' +
    'Select the cabinet on the device itself. See MIDI_MAPPING_NOTES.md.',
  commonParams: [
    range('low_cut', 65, 20, 500, { unit: 'Hz', format: 'freq', label: 'Low Cut', default: 80 }),
    range('high_cut', 66, 2000, 20000, { unit: 'Hz', format: 'freq', label: 'High Cut', default: 8000 }),
    // CC67 "Cab Level" was in the MIDI guide's CC map but not the manual's common-parameter
    // list. Confirmed against real hardware (firmware 1.04+, see HARDWARE_VERIFICATION.md):
    // it has no effect — Low Cut/High Cut both work over MIDI, Level does not. Left out of
    // the editor entirely rather than shipping a control that does nothing when moved.
  ],
  types,
};
