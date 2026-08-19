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

/**
 * Validates and normalizes an arbitrary JSON value as a full PatchState (e.g. from an
 * imported file): every block from the spec must be present with a valid typeId, and
 * `on`/`params` are coerced to sane types rather than rejected outright, so a slightly
 * stale or hand-edited file still loads instead of failing on a technicality.
 */
export function validatePatch(input: unknown): { ok: true; patch: PatchState } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Expected a JSON object mapping block ids to block state.' };
  }
  const raw = input as Record<string, unknown>;
  const patch: PatchState = {};

  for (const block of nanocoreSpec.blocks) {
    const rawBlock = raw[block.id];
    if (typeof rawBlock !== 'object' || rawBlock === null) {
      return { ok: false, error: `Missing or invalid entry for block "${block.id}".` };
    }
    const b = rawBlock as Record<string, unknown>;
    const typeId = typeof b.typeId === 'number' ? b.typeId : NaN;
    const type = block.types.find((t) => t.id === typeId);
    if (!type) {
      return { ok: false, error: `Block "${block.id}" has an invalid type id (${String(b.typeId)}).` };
    }
    const rawParams = typeof b.params === 'object' && b.params !== null ? (b.params as Record<string, unknown>) : {};
    const params: Record<string, number> = {};
    for (const spec of activeParams(block, typeId)) {
      const v = rawParams[spec.id];
      params[spec.id] = typeof v === 'number' && Number.isFinite(v) ? v : defaultParamValue(spec);
    }
    patch[block.id] = { on: b.on === true, typeId, params };
  }

  return { ok: true, patch };
}
