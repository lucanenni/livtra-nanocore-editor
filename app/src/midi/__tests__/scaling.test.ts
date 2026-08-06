import { describe, expect, it } from 'vitest';
import { ccToEnumIndex, ccToOnOff, ccToReal, clampCC, enumIndexToCC, onOffToCC, realToCC } from '../scaling';

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
