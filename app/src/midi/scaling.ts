/**
 * Linear conversion helpers between a parameter's real-world range and the raw
 * 0-127 MIDI CC value. See docs/MIDI_MAPPING_NOTES.md for why linear scaling
 * was chosen (it's the documented convention, not independently verified).
 */

export function clampCC(value: number): number {
  return Math.min(127, Math.max(0, Math.round(value)));
}

export function realToCC(min: number, max: number, value: number): number {
  if (max === min) return 0;
  const t = (value - min) / (max - min);
  return clampCC(Math.min(1, Math.max(0, t)) * 127);
}

export function ccToReal(min: number, max: number, cc: number): number {
  const t = clampCC(cc) / 127;
  return min + t * (max - min);
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
