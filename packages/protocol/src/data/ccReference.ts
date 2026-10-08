import { nanocoreSpec } from './nanocoreSpec';
import type { BlockSpec, ParamSpec } from './types';

/** One row of the "every known CC" reference table (`CCReferencePanel.tsx`) — built from the same
 * spec data every block/param editor already uses, so this can never drift out of sync with the
 * app's own CC map. Grouped by (block, CC number) rather than (block, type, param): the device
 * reuses the same physical CC per param *position* across a block's different types (e.g. MOD's
 * CC68 is always "the first param", whatever that means for the currently selected type) — see
 * docs/MIDI_MAPPING_NOTES.md's routing-conflict notes. Listing one row per type would mostly
 * repeat the same CC number many times over for no benefit to someone configuring a hardware
 * controller, who only cares which physical CC number to assign, not every possible meaning it
 * can carry. */
export interface CCReferenceEntry {
  cc: number;
  /** Block name (e.g. "AMP") or "Global" for non-block controls. */
  scope: string;
  /** What this CC does — a param label, "On/Off", "Type / Model select", or a global control name. */
  target: string;
  kind: 'on-off' | 'type' | 'param' | 'global';
  /** Human-readable documented range/options — the real-world value this CC is meant to carry,
   * not the raw 0-127 wire value (which the test-send buttons use directly). */
  rangeText: string;
  note?: string;
}

function rangeTextFor(spec: ParamSpec): string {
  if (spec.kind === 'enum') return spec.options.join(' / ');
  const unit = spec.unit ? ` ${spec.unit}` : '';
  return `${spec.min}${unit} to ${spec.max}${unit}`;
}

/** One row per distinct CC used by this block's `commonParams` and/or any type's `params` —
 * params without a `cc` (SysEx-only, see `RangeParam.sysexParamIndex`) are skipped, since there's
 * no CC to test or configure a controller with. */
function paramEntriesForBlock(block: BlockSpec): CCReferenceEntry[] {
  const byCC = new Map<number, { labels: Set<string>; ranges: Set<string> }>();
  const consider = (spec: ParamSpec) => {
    if (spec.cc === undefined) return;
    const bucket = byCC.get(spec.cc) ?? { labels: new Set(), ranges: new Set() };
    bucket.labels.add(spec.label);
    bucket.ranges.add(rangeTextFor(spec));
    byCC.set(spec.cc, bucket);
  };
  (block.commonParams ?? []).forEach(consider);
  block.types.forEach((type) => type.params.forEach(consider));

  return [...byCC.entries()].map(([cc, { labels, ranges }]) => ({
    cc,
    scope: block.name,
    target: [...labels].join(' / '),
    kind: 'param' as const,
    rangeText: ranges.size === 1 ? [...ranges][0]! : 'Varies by the block’s active type',
    note: block.note,
  }));
}

/** Every CC this app's data model knows about, one row per (block-or-global, CC number) pair,
 * sorted by CC number ascending (the natural order for mapping an external MIDI controller's
 * knobs/pedals one CC at a time). Program-Change-based global controls (direct preset recall)
 * are excluded — this is a CC-only reference, matching the page's own scope. */
export function buildCCReference(): CCReferenceEntry[] {
  const entries: CCReferenceEntry[] = [];

  for (const block of nanocoreSpec.blocks) {
    entries.push({
      cc: block.onOffCC,
      scope: block.name,
      target: 'On/Off',
      kind: 'on-off',
      rangeText: '0-63 = Off, 64-127 = On',
    });
    entries.push({
      cc: block.typeCC,
      scope: block.name,
      target: 'Type / Model select',
      kind: 'type',
      rangeText: `0-${block.types.length - 1} (exact type id, not scaled)`,
      note:
        block.sysexTypeField !== undefined
          ? 'This editor always sends this via SysEx instead, not this CC (SysEx is how the pedal ' +
            'is actually programmed) — see docs/MIDI_MAPPING_NOTES.md. Confirmed working again ' +
            'from external CC-only gear after a September 2026 firmware update.'
          : undefined,
    });
    entries.push(...paramEntriesForBlock(block));
  }

  for (const gc of nanocoreSpec.globalControls) {
    if (gc.cc === undefined) continue;
    entries.push({
      cc: gc.cc,
      scope: 'Global',
      target: gc.name,
      kind: 'global',
      rangeText: `${gc.min}-${gc.max}`,
      note: gc.description,
    });
  }

  return entries.sort((a, b) => a.cc - b.cc || a.scope.localeCompare(b.scope));
}
