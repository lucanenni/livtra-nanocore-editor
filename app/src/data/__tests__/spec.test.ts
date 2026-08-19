import { describe, expect, it } from 'vitest';
import { nanocoreSpec } from '../nanocoreSpec';
import type { BlockSpec } from '../types';

const EXPECTED_BLOCK_IDS = ['fx1', 'fx2', 'amp', 'cab', 'mod', 'del', 'rev', 'eq'];

describe('nanocoreSpec structural integrity', () => {
  it('has exactly the 8 documented blocks, in chain order', () => {
    expect(nanocoreSpec.blocks.map((b) => b.id)).toEqual(EXPECTED_BLOCK_IDS);
  });

  it.each(nanocoreSpec.blocks)('block "$id": on/off and type CCs are valid MIDI CC numbers', (block) => {
    expect(block.onOffCC).toBeGreaterThanOrEqual(0);
    expect(block.onOffCC).toBeLessThanOrEqual(127);
    expect(block.typeCC).toBeGreaterThanOrEqual(0);
    expect(block.typeCC).toBeLessThanOrEqual(127);
  });

  it('every block/type on-off + type CC pair is unique across the device (no cross-block clash)', () => {
    const seen = new Map<number, string>();
    for (const block of nanocoreSpec.blocks) {
      for (const cc of [block.onOffCC, block.typeCC]) {
        const owner = seen.get(cc);
        expect(owner, `CC${cc} used by both "${owner}" and "${block.id}"`).toBeUndefined();
        seen.set(cc, block.id);
      }
    }
  });

  it.each(nanocoreSpec.blocks)('block "$id": type ids are unique, continuous, and slugs are unique', (block) => {
    const ids = block.types.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[0]).toBe(0);
    expect(ids[ids.length - 1]).toBe(ids.length - 1); // continuous per MIDI guide ("IDs are continuous")

    const slugs = block.types.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('AMP and CAB each expose all 30 documented preamp/cabinet models', () => {
    const amp = nanocoreSpec.blocks.find((b) => b.id === 'amp') as BlockSpec;
    const cab = nanocoreSpec.blocks.find((b) => b.id === 'cab') as BlockSpec;
    expect(amp.types).toHaveLength(30);
    expect(cab.types).toHaveLength(30);
  });

  it.each(nanocoreSpec.blocks)('block "$id": every param CC is valid and every type\'s active param set has no CC collisions', (block) => {
    for (const type of block.types) {
      const active = [...(block.commonParams ?? []), ...type.params];
      const ccs = active.map((p) => p.cc);
      for (const p of active) {
        expect(p.cc, `${block.id}/${type.slug}/${p.id}`).toBeGreaterThanOrEqual(0);
        expect(p.cc, `${block.id}/${type.slug}/${p.id}`).toBeLessThanOrEqual(127);
      }
      expect(new Set(ccs).size, `${block.id}/${type.slug} has duplicate CCs: ${ccs.join(',')}`).toBe(ccs.length);
    }
  });

  it.each(nanocoreSpec.blocks)('block "$id": range params have min < max, enum params have >= 2 options', (block) => {
    for (const type of block.types) {
      for (const p of [...(block.commonParams ?? []), ...type.params]) {
        if (p.kind === 'range') {
          expect(p.min, `${block.id}/${type.slug}/${p.id}`).toBeLessThan(p.max);
        } else {
          expect(p.options.length, `${block.id}/${type.slug}/${p.id}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('MOD and FX2-special types (Pitch/Env Wah/Wah) both live on CC68-73, as documented', () => {
    const mod = nanocoreSpec.blocks.find((b) => b.id === 'mod') as BlockSpec;
    const fx2 = nanocoreSpec.blocks.find((b) => b.id === 'fx2') as BlockSpec;
    const modCCs = new Set(mod.types.flatMap((t) => t.params.map((p) => p.cc)));
    for (const cc of modCCs) expect(cc).toBeGreaterThanOrEqual(68);
    for (const cc of modCCs) expect(cc).toBeLessThanOrEqual(73);

    const specialTypes = fx2.types.filter((t) => [8, 9, 10].includes(t.id));
    expect(specialTypes).toHaveLength(3);
    for (const t of specialTypes) {
      for (const p of t.params) {
        expect(p.cc).toBeGreaterThanOrEqual(68);
        expect(p.cc).toBeLessThanOrEqual(73);
      }
    }
  });

  it('globalControls all reference either a CC or Program Change, with a valid 0-127 range', () => {
    for (const gc of nanocoreSpec.globalControls) {
      expect(gc.cc !== undefined || gc.isProgramChange).toBe(true);
      expect(gc.min).toBeGreaterThanOrEqual(0);
      expect(gc.max).toBeLessThanOrEqual(127);
    }
  });
});
