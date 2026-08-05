import { nanocoreSpec } from '../data/nanocoreSpec';
import type { BlockSpec, EffectType, ParamSpec } from '../data/types';
import type { BlockPatchState, PatchState } from './patchTypes';

export function defaultParamValue(p: ParamSpec): number {
  if (p.kind === 'range') return p.default ?? (p.min + p.max) / 2;
  return p.default ?? 0;
}

export function buildBlockDefault(block: BlockSpec): BlockPatchState {
  const type = block.types[0];
  const params: Record<string, number> = {};
  for (const p of block.commonParams ?? []) params[p.id] = defaultParamValue(p);
  for (const p of type.params) params[p.id] = defaultParamValue(p);
  return { on: false, typeId: type.id, params };
}

/** Re-derive a block's param map for a newly selected type: keep values for params that
 * still exist (same id, e.g. shared "mix"/"level"), fall back to defaults for new ones. */
export function remapParamsForType(
  block: BlockSpec,
  type: EffectType,
  previousParams: Record<string, number>,
): Record<string, number> {
  const params: Record<string, number> = {};
  for (const p of block.commonParams ?? []) {
    params[p.id] = previousParams[p.id] ?? defaultParamValue(p);
  }
  for (const p of type.params) {
    params[p.id] = previousParams[p.id] ?? defaultParamValue(p);
  }
  return params;
}

export function buildDefaultPatch(): PatchState {
  const patch: PatchState = {};
  for (const block of nanocoreSpec.blocks) patch[block.id] = buildBlockDefault(block);
  return patch;
}

export function findBlock(blockId: string): BlockSpec {
  const b = nanocoreSpec.blocks.find((bl) => bl.id === blockId);
  if (!b) throw new Error(`Unknown block "${blockId}"`);
  return b;
}

export function findType(block: BlockSpec, typeId: number): EffectType {
  const t = block.types.find((ty) => ty.id === typeId);
  if (!t) throw new Error(`Unknown type ${typeId} in block "${block.id}"`);
  return t;
}

export function findParamSpec(block: BlockSpec, typeId: number, paramId: string): ParamSpec {
  const type = findType(block, typeId);
  const spec = (block.commonParams ?? []).find((p) => p.id === paramId) ?? type.params.find((p) => p.id === paramId);
  if (!spec) throw new Error(`Unknown param "${paramId}" in ${block.id}/${typeId}`);
  return spec;
}

/** All params currently active for a block: common params + the selected type's own params. */
export function activeParams(block: BlockSpec, typeId: number): ParamSpec[] {
  const type = findType(block, typeId);
  return [...(block.commonParams ?? []), ...type.params];
}
