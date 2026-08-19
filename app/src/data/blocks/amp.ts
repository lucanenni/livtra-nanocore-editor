import type { BlockSpec, EffectType } from '../types';
import { range } from '../paramHelpers';

/** [slug, display name, description] for all 30 AMP preamp models, in manual order (id = index). */
const MODELS: [string, string, string][] = [
  ['bogxtc1', 'BogXTC1', "Based on Bogner XTC preamp modeling — Tone 1"],
  ['bogxtc2', 'BogXTC2', "Based on Bogner XTC preamp modeling — Tone 2"],
  ['engp1', 'ENGP1', 'Based on ENGL Powerball E645 preamp modeling — Tone 1'],
  ['engp2', 'ENGP2', 'Based on ENGL Powerball E645 preamp modeling — Tone 2'],
  ['fd59bm', 'Fd59Bm', "Based on Fender '59 Bassman preamp modeling"],
  ['fd65dk', 'Fd65Dk', "Based on Fender '65 Darkface preamp modeling"],
  ['hiw103', 'Hiw103', 'Based on Hiwatt DR103 preamp modeling'],
  ['mardsl1', 'MarDSL1', 'Based on Marshall DSL50 preamp modeling — Tone 1'],
  ['mardsl2', 'MarDSL2', 'Based on Marshall DSL50 preamp modeling — Tone 2'],
  ['mar8001', 'Mar8001', 'Based on Marshall JCM800 preamp modeling — Tone 1'],
  ['mar8002', 'Mar8002', 'Based on Marshall JCM800 preamp modeling — Tone 2'],
  ['mesr1', 'MesR1', 'Based on Mesa Boogie Rectifier preamp modeling — Tone 1'],
  ['mesr2', 'MesR2', 'Based on Mesa Boogie Rectifier preamp modeling — Tone 2'],
  ['mesr3', 'MesR3', 'Based on Mesa Boogie Rectifier preamp modeling — Tone 3'],
  ['ogg120', 'OgG120', 'Based on Orange Graphic 120 preamp modeling'],
  ['pey51501', 'Pey51501', 'Based on Peavey 5150 preamp modeling — Tone 1'],
  ['pey51502', 'Pey51502', 'Based on Peavey 5150 preamp modeling — Tone 2'],
  ['pey6505', 'Pey6505', 'Based on Peavey 6505 preamp modeling'],
  ['rant21', 'RanT21', 'Based on Randall T2 preamp modeling — Tone 1'],
  ['rant22', 'RanT22', 'Based on Randall T2 preamp modeling — Tone 2'],
  ['rojc120', 'RoJC120', 'Based on Roland JC-120 preamp modeling'],
  ['slo1001', 'SLO1001', 'Based on Soldano SLO-100 preamp modeling — Tone 1'],
  ['slo1002', 'SLO1002', 'Based on Soldano SLO-100 preamp modeling — Tone 2'],
  ['slo1003', 'SLO1003', 'Based on Soldano SLO-100 preamp modeling — Tone 3'],
  ['vxac30', 'VXAC30', 'Based on VOX AC30 preamp modeling'],
  ['apsvtvr', 'ApSVTVR', 'Based on Ampeg SVTVR preamp modeling'],
  ['apsvtcl', 'ApSVTCL', 'Based on Ampeg SVT-CL preamp modeling'],
  ['adn900', 'Adn900', 'Based on Ashdown ABM900 EVO II preamp modeling'],
  ['hiw320', 'Hiw320', 'Based on Hiwatt Jupiter 320 preamp modeling'],
  ['marsup', 'MarSup', 'Based on Marshall Super Bass preamp modeling'],
];

const types: EffectType[] = MODELS.map(([slug, name, description], id) => ({
  id,
  slug,
  name,
  description,
  params: [],
}));

export const amp: BlockSpec = {
  id: 'amp',
  name: 'AMP',
  onOffCC: 23,
  typeCC: 43,
  warning:
    'Changing the model below has NO effect on the device — confirmed on real hardware. Only ' +
    'On/Off and the parameters (Gain/Bass/Mid/Treble/Level) work remotely; model selection appears ' +
    'to require SysEx (as used by the official Livtra app), which this documented-CC-only editor ' +
    'does not implement. Select the model on the device itself. See MIDI_MAPPING_NOTES.md.',
  commonParams: [
    range('gain', 60, 0, 1, { decimals: 2, default: 0.5 }),
    range('bass', 61, -10, 10, { unit: 'dB', default: 0 }),
    range('mid', 62, -10, 10, { unit: 'dB', default: 0 }),
    range('treble', 63, -10, 10, { unit: 'dB', default: 0 }),
    range('level', 64, -10, 10, { unit: 'dB', default: 0 }),
  ],
  types,
};
