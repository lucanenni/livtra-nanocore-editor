import {
  activeParams,
  findBlock,
  findType,
  nanocoreSpec,
} from '@nanocore/protocol';
import type { BlockSpec, EffectType, ParamSpec, PatchState } from '@nanocore/protocol';

/** How a param's value reads to a person: real units for a range, the option's name for an enum. */
function paramValueView(spec: ParamSpec, value: number): { value: number | string; unit?: string } {
  if (spec.kind === 'enum') return { value: spec.options[value] ?? value };
  const decimals = spec.decimals ?? 0;
  return { value: Number(value.toFixed(decimals)), ...(spec.unit ? { unit: spec.unit } : {}) };
}

/** One block of the patch as the assistant sees it, params keyed by their on-device label. */
export function describeBlockState(blockId: string, patch: PatchState) {
  const block = findBlock(blockId);
  const state = patch[blockId];
  const type = findType(block, state.typeId);
  const params: Record<string, { value: number | string; unit?: string }> = {};
  for (const spec of activeParams(block, state.typeId)) {
    params[spec.label] = paramValueView(spec, state.params[spec.id] ?? 0);
  }
  return { name: block.name, on: state.on, type: type.name, params };
}

export function describePatch(patch: PatchState, chainOrder: string[]) {
  const blocks: Record<string, ReturnType<typeof describeBlockState>> = {};
  for (const block of nanocoreSpec.blocks) blocks[block.id] = describeBlockState(block.id, patch);
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
export function describeBlockSpec(block: BlockSpec) {
  return {
    id: block.id,
    name: block.name,
    ...(block.warning ? { warning: block.warning } : {}),
    commonParams: (block.commonParams ?? []).map(paramSpecView),
    types: block.types.map((t) => ({
      id: t.id,
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      ...(t.warning ? { warning: t.warning } : {}),
      params: t.params.map(paramSpecView),
    })),
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

/** Resolves an effect type of `block` by name, slug or numeric id. */
export function resolveType(block: BlockSpec, ref: string | number): EffectType {
  if (typeof ref === 'number') {
    const byId = block.types.find((t) => t.id === ref);
    if (byId) return byId;
  } else {
    const n = norm(ref);
    const found = block.types.find((t) => norm(t.name) === n || norm(t.slug) === n) ?? (/^\d+$/.test(ref) ? block.types.find((t) => t.id === Number(ref)) : undefined);
    if (found) return found;
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
