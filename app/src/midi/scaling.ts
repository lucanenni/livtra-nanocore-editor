/**
 * Conversion helpers between a parameter's real-world range and the raw 0-127 MIDI CC value
 * (or the 0.0-1.0 normalized value the device's own `0x41` read stream carries — same shape,
 * just a different 0-1 axis). Most params scale linearly, which is the MIDI Control User Guide's
 * documented convention; a handful of Hz-range params (filter cutoffs, LFO/sweep rates) turned
 * out to be exponential (log-frequency) instead, confirmed 2026-09-11 by sweeping 9 CC values
 * per param and reading the real value off the device screen (see docs/PARAM_VERIFICATION.md) —
 * `value = min * (max/min) ** t` fit every one of them to within ~1%, `min + t * (max-min)`
 * (linear) was off by up to 2-3x mid-range. See `RangeParam.curve` in `data/types.ts`.
 */

export type Curve = 'linear' | 'exp';

export function clampCC(value: number): number {
  return Math.min(127, Math.max(0, Math.round(value)));
}

/** Inverse of `tToReal`: real-world value -> normalized position (0.0-1.0) in the range. */
function realToT(min: number, max: number, value: number, curve: Curve = 'linear'): number {
  if (curve === 'exp') {
    // Exponential ranges are always positive (Hz), so min > 0 in practice; guard anyway.
    if (min <= 0 || max <= 0) return 0;
    return Math.log(value / min) / Math.log(max / min);
  }
  if (max === min) return 0;
  return (value - min) / (max - min);
}

/** Normalized position (0.0-1.0) in the range -> real-world value. */
function tToReal(min: number, max: number, t: number, curve: Curve = 'linear'): number {
  if (curve === 'exp' && min > 0 && max > 0) {
    return min * (max / min) ** t;
  }
  return min + t * (max - min);
}

export function realToCC(min: number, max: number, value: number, curve?: Curve): number {
  const t = Math.min(1, Math.max(0, realToT(min, max, value, curve)));
  return clampCC(t * 127);
}

export function ccToReal(min: number, max: number, cc: number, curve?: Curve): number {
  return tToReal(min, max, clampCC(cc) / 127, curve);
}

/** Same conversion as `ccToReal`, but from the device's own 0.0-1.0 normalized float (the
 * `0x41` read stream's per-parameter value) instead of a 0-127 CC — see
 * `midi/presetReader.ts`'s `decodePresetParamValues`. */
export function normalizedToReal(min: number, max: number, normalized: number, curve?: Curve): number {
  return tToReal(min, max, Math.min(1, Math.max(0, normalized)), curve);
}

/** Inverse of `normalizedToReal`: real-world value -> the device's own 0.0-1.0 normalized float
 * — used for params sent via `buildSetParamValueSysEx` (opcode `0x6d`'s live per-parameter set,
 * see `midi/sysex.ts`) instead of a CC, which carries this same 0.0-1.0 shape rather than 0-127. */
export function realToNormalized(min: number, max: number, value: number, curve?: Curve): number {
  return Math.min(1, Math.max(0, realToT(min, max, value, curve)));
}

/** Enum options are bucketed evenly across the 0-127 range; each CC value sent
 * is the centre of its bucket so a device reading back would land unambiguously
 * in the same bucket. */
export function enumIndexToCC(index: number, optionCount: number): number {
  const bucket = 128 / optionCount;
  return clampCC(index * bucket + bucket / 2);
}

export function ccToEnumIndex(cc: number, optionCount: number): number {
  const bucket = 128 / optionCount;
  return Math.min(optionCount - 1, Math.floor(clampCC(cc) / bucket));
}

/** Block/effect on-off convention: 0-63 = OFF, 64-127 = ON. We always transmit 0 or 127. */
export function onOffToCC(on: boolean): number {
  return on ? 127 : 0;
}

export function ccToOnOff(cc: number): boolean {
  return cc >= 64;
}
