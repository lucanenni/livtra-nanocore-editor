import { describe, expect, it } from 'vitest';
import { getRoutingConflict } from '../routing';
import { buildDefaultPatch } from '../patchDefaults';
import type { PatchState } from '../patchTypes';

function patchWithFx2Type(typeId: number): PatchState {
  const patch = buildDefaultPatch();
  patch.fx2 = { ...patch.fx2, typeId };
  return patch;
}

describe('getRoutingConflict', () => {
  it('is inactive for FX2 Drive/Boost types (0-7)', () => {
    for (let id = 0; id <= 7; id++) {
      expect(getRoutingConflict(patchWithFx2Type(id)).active).toBe(false);
    }
  });

  it('is active for Pitch (8), Envelope Wah (9), Wah (10), and Motion Wah (11)', () => {
    for (const id of [8, 9, 10, 11]) {
      const conflict = getRoutingConflict(patchWithFx2Type(id));
      expect(conflict.active, `type id ${id}`).toBe(true);
      expect(conflict.fx2TypeName).toBeTruthy();
    }
  });

  it('names the specific conflicting FX2 type, e.g. Motion Wah', () => {
    const conflict = getRoutingConflict(patchWithFx2Type(11));
    expect(conflict.fx2TypeName).toBe('Motion Wah');
  });

  it('returns inactive when the patch has no fx2 entry at all', () => {
    const patch = buildDefaultPatch();
    delete (patch as Partial<PatchState>).fx2;
    expect(getRoutingConflict(patch)).toEqual({ active: false, fx2TypeName: '' });
  });
});
