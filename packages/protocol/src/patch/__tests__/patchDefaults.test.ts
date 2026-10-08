import { describe, expect, it } from 'vitest';
import { findBlock, findParamSpecBySysexIndex, findType } from '../patchDefaults';

describe('findParamSpecBySysexIndex (reverses the opcode 0x06 / buildSetParamValueSysEx paramIndex convention)', () => {
  it('maps a plain (no sysexParamIndex) param to its array position — confirmed 2026-09-13 with real FX1 Compressor knob-sweep captures', () => {
    const fx1 = findBlock('fx1');
    const compressor = findType(fx1, 3); // id 3 = Compressor, see data/blocks/fx1.ts
    expect(findParamSpecBySysexIndex(compressor, 0)?.id).toBe('comp_threshold');
    expect(findParamSpecBySysexIndex(compressor, 1)?.id).toBe('ratio');
    expect(findParamSpecBySysexIndex(compressor, 2)?.id).toBe('knee');
    expect(findParamSpecBySysexIndex(compressor, 5)?.id).toBe('makeup');
  });

  it('returns null for an index with no matching param', () => {
    const fx1 = findBlock('fx1');
    const compressor = findType(fx1, 3);
    expect(findParamSpecBySysexIndex(compressor, 99)).toBeNull();
  });

  it('honors an explicit sysexParamIndex over array position — FX2 Motion Wah\'s reserved gap at index 2', () => {
    const fx2 = findBlock('fx2');
    const motionWah = fx2.types.find((t) => t.name === 'Motion Wah');
    expect(motionWah).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const sweep = findParamSpecBySysexIndex(motionWah!, 3);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const mix = findParamSpecBySysexIndex(motionWah!, 4);
    expect(sweep?.id).toBe('sweep');
    expect(mix?.id).toBe('mix');
    // Index 2 (the reserved gap) matches nothing — neither param's array position nor its
    // sysexParamIndex is 2.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(findParamSpecBySysexIndex(motionWah!, 2)).toBeNull();
  });
});
