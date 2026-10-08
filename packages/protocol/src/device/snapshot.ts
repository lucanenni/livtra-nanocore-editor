import { normalizedToReal } from '../midi/scaling';
import {
  decodeLiveBlockParams,
  decodePresetParamValues,
  parseActiveSlotFromAmpProfile,
  parseChainOrderFromAmpProfile,
  parseChainOrderFromPreset,
  parsePresetName,
  parseReadPresetResponse,
} from '../midi/presetReader';
import type { DecodedBlockParams, ParsedPresetTypes } from '../midi/presetReader';
import { activeParams, findBlock, findType, remapParamsForType } from '../patch/patchDefaults';
import type { PatchState } from '../patch/patchTypes';

/** What one read of the device's current patch yields, before it is merged into any `PatchState`
 * (the editor merges into its live store state, the MCP server into its own). */
export interface DeviceSnapshot {
  /** The preset slot that was read — from the live profile when it came back, else the fallback. */
  slot: number;
  /** `null` when the saved-state pages didn't come back (Simulator, older firmware, dropped link):
   * only `slot` is meaningful then. */
  state: null | {
    chainOrder: string[] | null;
    /** Display-only preset name; `null` when it couldn't be decoded. */
    name: string | null;
    decodedParams: Map<string, DecodedBlockParams>;
    parsed: ParsedPresetTypes;
  };
}

/** Slot to read: the live profile's own slot number when it parses (the reliable source — the
 * tracked `activeSlot` only updates from the 0x01 push, and a missed push would leave every
 * 0x41-derived value coming from the wrong preset), else `fallback`. */
export function slotFromLiveProfile(ampProfile: readonly number[] | null, fallback: number): number {
  return (ampProfile && parseActiveSlotFromAmpProfile(ampProfile)) ?? fallback;
}

/** Builds a snapshot from the three raw replies of a read (`ampProfile` = opcode 0x63 LIVE state,
 * `page1`/`page2` = opcode 0x41 SAVED state). Pure — no I/O. */
export function buildSnapshot(
  ampProfile: readonly number[] | null,
  page1: readonly number[],
  page2: readonly number[],
): NonNullable<DeviceSnapshot['state']> {
  // Effect-chain order: from the 0x41 param stream's header (byte-exact for all 40 factory
  // presets), falling back to the less-reliable 0x63 footer (which returns null for some real
  // presets, e.g. slot 25 "Dot8th"). An unrecognized shape from both leaves it alone (null).
  const chainOrder = parseChainOrderFromPreset(page1) ?? (ampProfile ? parseChainOrderFromAmpProfile(ampProfile) : null);

  const parsed = parseReadPresetResponse(page1, page2);
  // On/off, type/variant and normalized param values for ALL 8 blocks: prefer the LIVE state
  // from the opcode-0x63 AMP profile (`decodeLiveBlockParams`, confirmed 2026-09-13) over the SAVED
  // state from this opcode-0x41 read (`decodePresetParamValues`). The two can genuinely disagree —
  // 0x41 only ever reflects what was last saved to this slot, so live-editing without saving (as
  // ordinary use of the device does all the time) shows up as stale saved values otherwise.
  // `parsed` is the last-resort fallback: its AMP/CAB model indices (page-2 footer) and its
  // ampOn/cabOn/eqOn fill in only when NEITHER decoder produced anything for a given block.
  const decodedParams = new Map(decodePresetParamValues(page1, page2).map((b) => [b.blockId, b]));
  if (ampProfile) {
    for (const live of decodeLiveBlockParams(ampProfile)) {
      // AMP/CAB are the one exception: confirmed 2026-09-13 that their live "model" byte never
      // moves no matter what model is actually set (on/off and every param value DID track
      // correctly in the same response) — this response apparently just doesn't carry their model
      // index at all. Keep whichever variant the saved-state decode already found (or the live one
      // as a last resort) rather than clobbering a correct saved model id with a meaningless
      // placeholder byte for these two blocks specifically.
      const variant =
        (live.blockId === 'amp' || live.blockId === 'cab') && decodedParams.has(live.blockId)
          ? decodedParams.get(live.blockId)!.variant
          : live.variant;
      decodedParams.set(live.blockId, { ...live, variant });
    }
  }

  return { chainOrder, name: parsePresetName(page1), decodedParams, parsed };
}

/** Merges a snapshot's block state (type, on/off, every decoded param) into `patch`, returning a
 * new `PatchState`. Blocks the snapshot knows nothing about are left as they were. */
export function applySnapshotToPatch(
  patch: PatchState,
  state: NonNullable<DeviceSnapshot['state']>,
): PatchState {
  const { decodedParams, parsed } = state;
  // Type id from the stream's `variant` byte. REV's serialization skips internal id 4, so ids
  // >= 5 shift down one to line up with the editor's documented CC ids (see
  // docs/MIDI_MAPPING_NOTES.md's REV notes). Fall back to parseReadPresetResponse only when the
  // stream couldn't be decoded (older firmware, a missing page 2).
  const decodedTypeId = (blockId: string): number | null => {
    const v = decodedParams.get(blockId)?.variant;
    if (v === undefined) return null;
    return blockId === 'rev' && v >= 5 ? v - 1 : v;
  };
  const decodedOn = (blockId: string): boolean | null => decodedParams.get(blockId)?.on ?? null;
  const updates: [string, number | null, boolean | null][] = [
    ['fx1', decodedTypeId('fx1') ?? parsed.fx1TypeId, decodedOn('fx1')],
    ['fx2', decodedTypeId('fx2') ?? parsed.fx2TypeId, decodedOn('fx2')],
    ['amp', decodedTypeId('amp') ?? parsed.ampModelIndex, decodedOn('amp') ?? parsed.ampOn],
    ['cab', decodedTypeId('cab') ?? parsed.cabModelIndex, decodedOn('cab') ?? parsed.cabOn],
    ['mod', decodedTypeId('mod') ?? parsed.modTypeId, decodedOn('mod')],
    ['del', decodedTypeId('del') ?? parsed.delTypeId, decodedOn('del')],
    ['rev', decodedTypeId('rev') ?? parsed.revTypeId, decodedOn('rev')],
    ['eq', decodedTypeId('eq') ?? parsed.eqTypeId, decodedOn('eq') ?? parsed.eqOn],
  ];

  const next = { ...patch };
  for (const [blockId, typeId, on] of updates) {
    const prev = next[blockId];
    if (!prev) continue;
    let block = prev;
    if (typeId !== null) {
      try {
        const spec = findBlock(blockId);
        const type = findType(spec, typeId);
        const params = remapParamsForType(spec, type, prev.params);
        // Un-normalize each decoded 0.0-1.0 value into its param's own real range and merge it
        // in, positionally against `activeParams` (common params then the selected type's own,
        // the device's own order). A decoded list shorter than the param list is normal for a
        // few FX2 types that pin and omit their last param — those keep their prior value.
        const decoded = decodedParams.get(blockId);
        if (decoded) {
          const specs = activeParams(spec, typeId);
          decoded.values.forEach((normalized, i) => {
            const p = specs[i];
            if (!p) return;
            params[p.id] = p.kind === 'range' ? normalizedToReal(p.min, p.max, normalized, p.curve) : normalized;
          });
        }
        block = { ...block, typeId, params };
      } catch {
        // Unrecognized type-id (e.g. the REV -1 correction landing outside the known range) —
        // leave this block's patch state as it was rather than guess.
      }
    }
    if (on !== null) block = { ...block, on };
    next[blockId] = block;
  }
  return next;
}
