import { describe, expect, it } from 'vitest';
import { buildCCReference } from '../ccReference';
import { nanocoreSpec } from '../nanocoreSpec';

describe('buildCCReference', () => {
  const entries = buildCCReference();

  it('sorts by CC number ascending', () => {
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.cc).toBeGreaterThanOrEqual(entries[i - 1]!.cc);
    }
  });

  it('includes an on-off row and a type row for every block', () => {
    for (const block of nanocoreSpec.blocks) {
      const onOff = entries.find((e) => e.scope === block.name && e.kind === 'on-off');
      const type = entries.find((e) => e.scope === block.name && e.kind === 'type');
      expect(onOff?.cc).toBe(block.onOffCC);
      expect(type?.cc).toBe(block.typeCC);
    }
  });

  it('flags AMP/CAB type rows as SysEx-sent, unlike a plain-CC block', () => {
    const ampType = entries.find((e) => e.scope === 'AMP' && e.kind === 'type');
    const cabType = entries.find((e) => e.scope === 'CAB' && e.kind === 'type');
    const modType = entries.find((e) => e.scope === 'MOD' && e.kind === 'type');
    expect(ampType?.note).toMatch(/SysEx/);
    expect(cabType?.note).toMatch(/SysEx/);
    expect(modType?.note).toBeUndefined();
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

  it('every entry has a resolvable, non-empty target and range text', () => {
    for (const entry of entries) {
      expect(entry.target.length).toBeGreaterThan(0);
      expect(entry.rangeText.length).toBeGreaterThan(0);
      expect(entry.cc).toBeGreaterThanOrEqual(0);
      expect(entry.cc).toBeLessThanOrEqual(127);
    }
  });
});
