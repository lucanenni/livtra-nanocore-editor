import {
  activeParams,
  customProfileLabel,
  customProfileName,
  findBlock,
  findType,
  nanocoreSpec,
} from '@nanocore/protocol';
import type { BlockSpec, EffectType, ParamSpec, PatchState, ProfileCatalogRecord } from '@nanocore/protocol';

/** What the pedal's AMP/FX2 profile and CAB IR slots hold — `null` for a catalog not read yet. */
export interface Catalogs {
  profiles: ProfileCatalogRecord[] | null;
  irs: ProfileCatalogRecord[] | null;
}

/** Name of the custom profile/IR loaded into the slot of `type`, or `null` for a factory slot —
 * with the slot's position in front when another slot of the block holds the same name. */
export function customName(catalogs: Catalogs | undefined, block: BlockSpec, type: EffectType): string | null {
  return customProfileLabel(block.id === 'cab' ? catalogs?.irs : catalogs?.profiles, block.id, block.types, type.id);
}

/** How a param's value reads to a person: real units for a range, the option's name for an enum. */
function paramValueView(spec: ParamSpec, value: number): { value: number | string; unit?: string } {
  if (spec.kind === 'enum') return { value: spec.options[value] ?? value };
  const decimals = spec.decimals ?? 0;
  return { value: Number(value.toFixed(decimals)), ...(spec.unit ? { unit: spec.unit } : {}) };
}

/** One block of the patch as the assistant sees it, params keyed by their on-device label. */
export function describeBlockState(blockId: string, patch: PatchState, catalogs?: Catalogs) {
  const block = findBlock(blockId);
  const state = patch[blockId];
  const type = findType(block, state.typeId);
  const params: Record<string, { value: number | string; unit?: string }> = {};
  for (const spec of activeParams(block, state.typeId)) {
    params[spec.label] = paramValueView(spec, state.params[spec.id] ?? 0);
  }
  const profile = customName(catalogs, block, type);
  return { name: block.name, on: state.on, type: type.name, ...(profile ? { profile } : {}), params };
}

export function describePatch(patch: PatchState, chainOrder: string[], catalogs?: Catalogs) {
  const blocks: Record<string, ReturnType<typeof describeBlockState>> = {};
  for (const block of nanocoreSpec.blocks) blocks[block.id] = describeBlockState(block.id, patch, catalogs);
  return { chainOrder, blocks };
}

function paramSpecView(spec: ParamSpec) {
  const base = { id: spec.id, label: spec.label, ...(spec.note ? { note: spec.note } : {}) };
  if (spec.kind === 'enum') return { ...base, options: spec.options, ...(spec.default !== undefined ? { default: spec.options[spec.default] } : {}) };
  return {
    ...base,
    min: spec.min,
    max: spec.max,
    ...(spec.unit ? { unit: spec.unit } : {}),
    ...(spec.default !== undefined ? { default: spec.default } : {}),
  };
}

/** The catalogue of one block: every effect type with its parameters and valid ranges. */
export function describeBlockSpec(block: BlockSpec, catalogs?: Catalogs) {
  return {
    id: block.id,
    name: block.name,
    ...(block.warning ? { warning: block.warning } : {}),
    commonParams: (block.commonParams ?? []).map(paramSpecView),
    types: block.types.map((t) => {
      const profile = customName(catalogs, block, t);
      return {
        id: t.id,
        name: t.name,
        ...(profile ? { profile } : {}),
        ...(t.description ? { description: t.description } : {}),
        ...(t.warning ? { warning: t.warning } : {}),
        params: t.params.map(paramSpecView),
      };
    }),
  };
}

export function blockOverview() {
  return nanocoreSpec.blocks.map((b) => ({ id: b.id, name: b.name, types: b.types.map((t) => t.name) }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Resolves a block reference: its id ("amp") or its display name ("AMP"). */
export function resolveBlock(ref: string): BlockSpec {
  const n = norm(ref);
  const found = nanocoreSpec.blocks.find((b) => norm(b.id) === n || norm(b.name) === n);
  if (!found) throw new Error(`Unknown block "${ref}". Blocks: ${nanocoreSpec.blocks.map((b) => b.id).join(', ')}.`);
  return found;
}

/** Resolves an effect type of `block` by name, slug, numeric id, or the name of a custom
 * profile/IR loaded into its slot. */
export function resolveType(block: BlockSpec, ref: string | number, catalogs?: Catalogs): EffectType {
  if (typeof ref === 'number') {
    const byId = block.types.find((t) => t.id === ref);
    if (byId) return byId;
  } else {
    const n = norm(ref);
    const found =
      block.types.find((t) => norm(t.name) === n || norm(t.slug) === n) ??
      (/^\d+$/.test(ref) ? block.types.find((t) => t.id === Number(ref)) : undefined) ??
      block.types.find((t) => norm(customName(catalogs, block, t) ?? '') === n);
    if (found) return found;
    // A bare name that several slots share (their labels carry "#N" in front) is ambiguous.
    const catalog = block.id === 'cab' ? catalogs?.irs : catalogs?.profiles;
    const shared = block.types.filter((t) => norm(customProfileName(catalog, block.id, t.id, t.name) ?? '') === n);
    if (shared.length > 1) {
      const labels = shared.map((t) => `"${customName(catalogs, block, t)}"`).join(', ');
      throw new Error(`Several ${block.name} slots are named "${ref}": ${labels}. Use one of those.`);
    }
  }
  throw new Error(`Unknown ${block.name} type "${ref}". Use describe_block to list them.`);
}

/** Resolves a parameter of the block's currently selected type by id or label. */
export function resolveParam(block: BlockSpec, typeId: number, ref: string): ParamSpec {
  const n = norm(ref);
  const specs = activeParams(block, typeId);
  const found = specs.find((p) => norm(p.id) === n) ?? specs.find((p) => norm(p.label) === n);
  if (!found) {
    throw new Error(`${block.name} ${findType(block, typeId).name} has no parameter "${ref}". It has: ${specs.map((p) => p.label).join(', ')}.`);
  }
  return found;
}

/** Turns what the caller supplied into the value the patch stores (real units / option index),
 * validating it against the parameter's range or options. */
export function coerceParamValue(spec: ParamSpec, input: number | string): number {
  if (spec.kind === 'enum') {
    if (typeof input === 'number') {
      if (Number.isInteger(input) && input >= 0 && input < spec.options.length) return input;
    } else {
      const n = norm(input);
      const idx = spec.options.findIndex((o) => norm(o) === n);
      if (idx !== -1) return idx;
    }
    throw new Error(`"${spec.label}" must be one of: ${spec.options.join(', ')}.`);
  }
  const value = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(value)) throw new Error(`"${spec.label}" needs a number.`);
  if (value < spec.min || value > spec.max) {
    throw new Error(`"${spec.label}" must be between ${spec.min} and ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}.`);
  }
  return value;
}
