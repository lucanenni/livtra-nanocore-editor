import { describe, expect, it } from 'vitest';
import { buildCCReference } from '../ccReference';
import { nanocoreSpec } from '../nanocoreSpec';

describe('buildCCReference', () => {
  const entries = buildCCReference();

  it('sorts the known rows by CC number ascending, then appends every unassigned CC (also ascending) at the bottom', () => {
    const known = entries.filter((e) => e.kind !== 'unassigned');
    const unassigned = entries.filter((e) => e.kind === 'unassigned');
    for (let i = 1; i < known.length; i++) {
      expect(known[i]!.cc).toBeGreaterThanOrEqual(known[i - 1]!.cc);
    }
    for (let i = 1; i < unassigned.length; i++) {
      expect(unassigned[i]!.cc).toBeGreaterThan(unassigned[i - 1]!.cc);
    }
    expect(entries.indexOf(unassigned[0]!)).toBe(known.length);
  });

  it('includes an on-off row and a type row for every block', () => {
    for (const block of nanocoreSpec.blocks) {
      const onOff = entries.find((e) => e.scope === block.name && e.kind === 'on-off');
      const type = entries.find((e) => e.scope === block.name && e.kind === 'type');
      expect(onOff?.cc).toBe(block.onOffCC);
      expect(type?.cc).toBe(block.typeCC);
    }
  });

  it('flags every block\'s type row as SysEx-sent: this editor never sends typeCC for any block', () => {
    for (const block of nanocoreSpec.blocks) {
      const type = entries.find((e) => e.scope === block.name && e.kind === 'type');
      expect(type?.note).toMatch(/SysEx/);
    }
  });

  it('never invents a CC for a SysEx-only param', () => {
    // FX1 Gate's own `release` (5-100ms) is rangeSysexOnly — it has no CC at all. A different
    // FX1 type's `release` (Compressor/Gate+Compressor, 0-1000ms, CC55) is genuinely CC-bearing
    // and correctly appears — this checks the sysexOnly one's specific range never leaks a row.
    const fx1Rows = entries.filter((e) => e.scope === 'FX1' && e.kind === 'param');
    expect(fx1Rows.some((row) => row.rangeText === '5 ms to 100 ms')).toBe(false);
  });

  it('shares CC68 across MOD and FX2 as two distinct rows, not merged', () => {
    const cc68 = entries.filter((e) => e.cc === 68);
    const scopes = cc68.map((e) => e.scope);
    expect(scopes).toContain('MOD');
    expect(scopes).toContain('FX2');
  });

  it('includes CC-bearing global controls but excludes Program-Change-only ones', () => {
    const globals = entries.filter((e) => e.kind === 'global');
    expect(globals.some((e) => e.target === 'Tuner' && e.cc === 80)).toBe(true);
    expect(globals.some((e) => e.target === 'Direct Preset Recall')).toBe(false);
  });

  it('every known entry has a resolvable, non-empty target and range text; unassigned ones are deliberately blank', () => {
    for (const entry of entries) {
      if (entry.kind === 'unassigned') {
        expect(entry.target).toBe('');
      } else {
        expect(entry.target.length).toBeGreaterThan(0);
      }
      expect(entry.rangeText.length).toBeGreaterThan(0);
      expect(entry.cc).toBeGreaterThanOrEqual(0);
      expect(entry.cc).toBeLessThanOrEqual(127);
    }
  });

  it('adds a blank row for every CC 0-127 this app\'s data model has no entry for', () => {
    const unassigned = entries.filter((e) => e.kind === 'unassigned');
    const ccs = new Set(entries.map((e) => e.cc));
    expect(ccs.size).toBe(128); // every CC 0-127 is covered exactly once
    // Spot-check a few numbers known free from the official spec itself ("Unused controls").
    for (const cc of [1, 22, 29, 42, 49]) {
      expect(unassigned.some((e) => e.cc === cc)).toBe(true);
    }
  });
});
