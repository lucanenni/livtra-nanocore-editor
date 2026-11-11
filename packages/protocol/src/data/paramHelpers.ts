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

/** `count` numbered placeholder params (`param1`..`paramN`), each a plain 0.0-1.0 SysEx-only
 * slot — for a type whose NAME and own-param COUNT are confirmed (on-screen read + a live
 * `buildSetBlockTypeSysEx` capture) but whose individual parameter names, real-world ranges and
 * default values are NOT yet verified against real hardware. Exists so `EffectType.params.length`
 * is still correct — the number that matters for `buildSetBlockTypeSysEx`'s `defaultNormalizedValues`
 * to be the right length when the type is selected — without inventing specific-sounding names or
 * ranges the project has no evidence for. Addressed via `sysexParamIndex` (not a guessed `cc`):
 * picking a wrong CC risks silently colliding with another control under this protocol's known
 * CC-sharing/routing quirks (see fx2.ts's `ROUTING_NOTE`), while a wrong positional SysEx index
 * for a param nobody has wired a slider to yet has no such side effect. Replace with real `range`
 * calls once each one is actually measured (see docs/MIDI_MAPPING_NOTES.md). */
export function placeholderParams(count: number): RangeParam[] {
  return Array.from({ length: count }, (_, i) =>
    rangeSysexOnly(`param${i + 1}`, i, 0, 1, {
      decimals: 2,
      note: 'Parameter name, real-world range and default are not yet confirmed on real hardware — placeholder only.',
    }),
  );
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
