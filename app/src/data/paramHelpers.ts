import type { EnumParam, RangeParam } from './types';

/** Human-readable default label for a generic param id, e.g. "pre_delay" -> "Pre Delay". */
function titleize(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function range(
  id: string,
  cc: number,
  min: number,
  max: number,
  opts: Partial<Omit<RangeParam, 'kind' | 'id' | 'cc' | 'min' | 'max' | 'label'>> & { label?: string } = {},
): RangeParam {
  return {
    kind: 'range',
    id,
    cc,
    min,
    max,
    label: opts.label ?? titleize(id),
    unit: opts.unit,
    decimals: opts.decimals,
    format: opts.format,
    curve: opts.curve,
    default: opts.default,
    note: opts.note,
  };
}

/** For a param confirmed on the device screen with NO working CC at all — sent via
 * `midi/sysex.ts`'s `buildSetParamValueSysEx` instead. `sysexParamIndex` is this param's position
 * in its block-type's own `params` array (0-indexed) — see `RangeParam.sysexParamIndex`'s doc
 * comment. Note this is positional: appending this after other params in the same `params` array
 * (the usual case) gives it the right index automatically, but inserting it earlier would need
 * every later sibling's index reconsidered too. */
export function rangeSysexOnly(
  id: string,
  sysexParamIndex: number,
  min: number,
  max: number,
  opts: Partial<Omit<RangeParam, 'kind' | 'id' | 'cc' | 'sysexParamIndex' | 'min' | 'max' | 'label'>> & { label?: string } = {},
): RangeParam {
  return {
    kind: 'range',
    id,
    sysexParamIndex,
    min,
    max,
    label: opts.label ?? titleize(id),
    unit: opts.unit,
    decimals: opts.decimals,
    format: opts.format,
    curve: opts.curve,
    default: opts.default,
    note: opts.note,
  };
}

export function enumP(
  id: string,
  cc: number,
  options: string[],
  opts: Partial<Omit<EnumParam, 'kind' | 'id' | 'cc' | 'options' | 'label'>> & { label?: string } = {},
): EnumParam {
  return {
    kind: 'enum',
    id,
    cc,
    options,
    label: opts.label ?? titleize(id),
    default: opts.default,
    note: opts.note,
  };
}
