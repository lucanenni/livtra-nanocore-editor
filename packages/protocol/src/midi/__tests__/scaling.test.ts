import { describe, expect, it } from 'vitest';
import {
  ccToEnumIndex,
  ccToOnOff,
  ccToReal,
  clampCC,
  enumIndexToCC,
  normalizedToReal,
  onOffToCC,
  realToCC,
  realToNormalized,
} from '../scaling';

describe('clampCC', () => {
  it('clamps into 0-127 and rounds', () => {
    expect(clampCC(-10)).toBe(0);
    expect(clampCC(200)).toBe(127);
    expect(clampCC(63.6)).toBe(64);
  });
});

describe('realToCC / ccToReal (linear scaling)', () => {
  it('maps min -> 0 and max -> 127', () => {
    expect(realToCC(-100, 0, -100)).toBe(0);
    expect(realToCC(-100, 0, 0)).toBe(127);
  });

  it('maps the midpoint to ~64', () => {
    expect(realToCC(-100, 0, -50)).toBeCloseTo(64, 0);
    expect(realToCC(0, 100, 50)).toBeCloseTo(64, 0);
  });

  it('clamps out-of-range real values', () => {
    expect(realToCC(0, 100, -50)).toBe(0);
    expect(realToCC(0, 100, 500)).toBe(127);
  });

  it('round-trips reasonably (within one CC step) for representative ranges', () => {
    const cases: [number, number][] = [
      [-100, 0],
      [0, 1],
      [-10, 10],
      [1.1, 20],
      [1, 2000],
      [800, 8000],
    ];
    for (const [min, max] of cases) {
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        const real = min + frac * (max - min);
        const cc = realToCC(min, max, real);
        const back = ccToReal(min, max, cc);
        const step = (max - min) / 127;
        expect(Math.abs(back - real)).toBeLessThanOrEqual(step / 2 + 1e-9);
      }
    }
  });

  it('handles a degenerate (min === max) range without dividing by zero', () => {
    expect(realToCC(5, 5, 5)).toBe(0);
  });
});

describe('realToCC / ccToReal (exponential curve)', () => {
  // Real CAB Low Cut readings from a 9-point CC sweep on real hardware, 2026-09-11 (see
  // docs/PARAM_VERIFICATION.md) — locks in the fitted `value = min * (max/min) ** t` formula
  // against actual device screen values, not just its own round-trip.
  const LOW_CUT_SWEEP: [number, number][] = [
    [0, 20],
    [16, 30],
    [32, 45],
    [48, 67.5],
    [64, 101],
    [80, 152],
    [96, 228],
    [112, 342],
    [127, 500],
  ];

  it('matches real CAB Low Cut (20-500 Hz) readings within 1%', () => {
    for (const [cc, measured] of LOW_CUT_SWEEP) {
      expect(ccToReal(20, 500, cc, 'exp')).toBeCloseTo(measured, measured < 50 ? 0 : -1);
    }
  });

  it('still maps min -> 0 and max -> 127 exactly', () => {
    expect(realToCC(20, 500, 20, 'exp')).toBe(0);
    expect(realToCC(20, 500, 500, 'exp')).toBe(127);
  });

  it('round-trips', () => {
    for (const cc of [0, 32, 64, 96, 127]) {
      const real = ccToReal(163, 3500, cc, 'exp');
      expect(realToCC(163, 3500, real, 'exp')).toBeCloseTo(cc, 0);
    }
  });

  it('falls back to linear for a non-positive min (guards against log(<=0))', () => {
    expect(ccToReal(-10, 10, 64, 'exp')).toBeCloseTo(ccToReal(-10, 10, 64, 'linear'), 5);
  });

  it('normalizedToReal matches ccToReal at the same normalized position (device 0x41 stream vs CC use the same taper)', () => {
    for (const cc of [0, 32, 64, 96, 127]) {
      expect(normalizedToReal(20, 500, cc / 127, 'exp')).toBeCloseTo(ccToReal(20, 500, cc, 'exp'), 5);
    }
  });

  it('realToNormalized is the exact inverse of normalizedToReal, linear and exp', () => {
    for (const curve of ['linear', 'exp'] as const) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const real = normalizedToReal(20, 500, t, curve);
        expect(realToNormalized(20, 500, real, curve)).toBeCloseTo(t, 6);
      }
    }
  });

  it('realToNormalized clamps out-of-range values into 0.0-1.0', () => {
    expect(realToNormalized(0, 100, -50)).toBe(0);
    expect(realToNormalized(0, 100, 200)).toBe(1);
  });
});

describe('enum bucketing', () => {
  it('splits 0-127 evenly and round-trips every index', () => {
    for (const count of [2, 3, 4, 6]) {
      for (let i = 0; i < count; i++) {
        const cc = enumIndexToCC(i, count);
        expect(cc).toBeGreaterThanOrEqual(0);
        expect(cc).toBeLessThanOrEqual(127);
        expect(ccToEnumIndex(cc, count)).toBe(i);
      }
    }
  });
});

describe('on/off convention', () => {
  it('follows the documented 0-63 OFF / 64-127 ON split', () => {
    expect(onOffToCC(true)).toBe(127);
    expect(onOffToCC(false)).toBe(0);
    expect(ccToOnOff(0)).toBe(false);
    expect(ccToOnOff(63)).toBe(false);
    expect(ccToOnOff(64)).toBe(true);
    expect(ccToOnOff(127)).toBe(true);
  });
});
