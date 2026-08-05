import { findType } from './patchDefaults';
import { fx2 } from '../data/nanocoreSpec';
import type { PatchState } from './patchTypes';

/** FX2 type ids that repurpose CC68-73 away from MOD (Pitch / Envelope Wah / Wah). */
const FX2_SPECIAL_TYPE_IDS = [8, 9, 10];

export interface RoutingConflict {
  active: boolean;
  fx2TypeName: string;
}

/** See docs/MIDI_MAPPING_NOTES.md — CC68-73 are shared between MOD and FX2's Pitch/Env Wah/Wah. */
export function getRoutingConflict(patch: PatchState): RoutingConflict {
  const fx2State = patch.fx2;
  if (!fx2State) return { active: false, fx2TypeName: '' };
  const isSpecial = FX2_SPECIAL_TYPE_IDS.includes(fx2State.typeId);
  const typeName = findType(fx2, fx2State.typeId).name;
  return { active: isSpecial, fx2TypeName: typeName };
}
