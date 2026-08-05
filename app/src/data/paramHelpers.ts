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
