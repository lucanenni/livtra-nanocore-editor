import { enumIndexToCC, onOffToCC, realToCC, realToNormalized } from '../midi/scaling';
import type { MidiTransport } from '../midi/types';
import { buildReplyFrame, withReplyReassembly } from '../midi/segmentedReplies';
import {
  CHAIN_ORDER_BLOCK_IDS,
  buildAmpProfileReadSysEx,
  buildBlockTypeSysEx,
  buildChainOrderPrimeSysEx,
  buildChainOrderSysEx,
  buildGlobalSettingSysEx,
  buildGlobalSettingsPollSysEx,
  buildReadPresetWindowSysEx,
  buildRenamePresetSysEx,
  buildSavePresetSysEx,
  buildSetBlockTypeSysEx,
  buildSetParamValueSysEx,
  isAmpProfileResponse,
  isCommandReply,
  isGlobalSettingsResponse,
  isSavePresetResponse,
  parseCommandMessage,
  parseReadPresetWindow,
} from '../midi/sysex';
import type { ProfileCatalogRecord } from '../midi/sysex';
import type { EffectType } from '../data/types';
import { parseGlobalSettingsResponse, parsePresetName } from '../midi/presetReader';
import type { GlobalSettings } from '../midi/presetReader';
import { readIrCatalog, readProfileCatalog, readProfileData, runProfileUpload, type ProfileReadResult } from '../midi/profileUpload';
import type { CommandTransact, UploadPhase, UploadResult } from '../midi/profileUpload';
import { nanocoreSpec } from '../data/nanocoreSpec';
import { buildBlockDefault, findBlock, findParamSpec, findType } from '../patch/patchDefaults';
import type { BlockPatchState, PatchState } from '../patch/patchTypes';
import { PROFILE_COMMAND_TIMEOUT_MS, requestSysExResponse } from './request';
import { buildSnapshot, slotFromLiveProfile } from './snapshot';
import type { DeviceSnapshot } from './snapshot';
import { startLiveSession } from './live';
import type { LiveHandlers } from './live';

/** Bytes a saved-preset read asks for per request (page 1 = offset 0, page 2 = offset 200). */
const PRESET_PAGE_BYTES = 200;
/** Enough of a preset to hold its name, and no more than one Bluetooth reply carries. */
const PRESET_NAME_WINDOW_BYTES = 59;
/** Safety stop for walking a preset in windows (a real preset is ~265 bytes). */
const PRESET_MAX_BYTES = 2048;
const READ_PRESET_OPCODE_TAG = 0x41;

/** Maximum preset-name length the device accepts (opcode 0x6d, field 0x08). */
export const PRESET_NAME_MAX = 8;

/** `type`'s own params, each as the 0.0-1.0 normalized float `buildSetBlockTypeSysEx` sends —
 * array order, not `sysexParamIndex` order (see that function's doc comment for why: confirmed
 * from a real capture of FX2's Motion Wah, whose `rate`/`voice`/`sweep`/`mix` floats landed in
 * exactly that params-array order even though `sweep`/`mix` have their own, different
 * `sysexParamIndex`). No current block type uses an `EnumParam`, so the enum branch below (index
 * over the option count) is unexercised and unconfirmed — a placeholder for when one exists. */
function defaultNormalizedValuesForType(type: EffectType): number[] {
  return type.params.map((spec) =>
    spec.kind === 'range'
      ? realToNormalized(spec.min, spec.max, spec.default ?? spec.min, spec.curve)
      : (spec.default ?? 0) / Math.max(1, spec.options.length - 1),
  );
}

/** One NanoCore on one MIDI output, driven through any `MidiTransport`. Holds no state besides
 * the connection coordinates — it never mutates a patch itself: `send*` methods put a change on
 * the wire, `read*` methods return what the device reports, and the caller (the web editor's
 * store, the MCP server) owns its own `PatchState`. This is what both front ends share. */
export class NanoCoreDevice {
  readonly transport: MidiTransport;
  /** What replies are read through: the same transport, but a reply the device split into several
   * messages (Bluetooth LE) arrives whole — see `midi/segmentedReplies.ts`. */
  private readonly rx: MidiTransport;
  readonly outputId: string;
  /** MIDI channel (1-16) for CC and program-change messages; SysEx is channel-less. */
  channel: number;

  constructor(transport: MidiTransport, outputId: string, channel: number = 1) {
    this.transport = transport;
    this.rx = withReplyReassembly(transport);
    this.outputId = outputId;
    this.channel = channel;
  }

  // ---- sending (fire-and-forget) -------------------------------------------------------------

  sendBlockOn(blockId: string, on: boolean): void {
    const block = findBlock(blockId);
    this.transport.sendCC(this.outputId, this.channel, block.onOffCC, onOffToCC(on), `${block.name} ${on ? 'ON' : 'OFF'}`);
  }

  sendBlockType(blockId: string, typeId: number): void {
    const block = findBlock(blockId);
    const type = findType(block, typeId);
    if (block.sysexTypeField !== undefined) {
      // AMP/CAB: confirmed on real hardware that typeCC has no effect — SysEx is the only way.
      this.transport.sendSysEx(this.outputId, buildBlockTypeSysEx(block.sysexTypeField, typeId), `${block.name} type -> ${type.name}`);
    } else {
      // Every other block: the official app never sends typeCC either — see
      // buildSetBlockTypeSysEx's doc comment for the real mechanism (confirmed on FX1/FX2). The
      // real app always sends this same priming message right before it (same idiom as
      // buildChainOrderSysEx) — confirmed 2026-11-12 the hard way: skipping it makes the
      // following type-change land inconsistently (sometimes applied, sometimes silently
      // dropped) rather than failing outright, which is why it went unnoticed until a live
      // re-test sweep hit it repeatedly.
      this.transport.sendSysEx(this.outputId, buildChainOrderPrimeSysEx(), `${block.name} type change (prime)`);
      this.transport.sendSysEx(
        this.outputId,
        buildSetBlockTypeSysEx(CHAIN_ORDER_BLOCK_IDS[block.id], typeId, defaultNormalizedValuesForType(type)),
        `${block.name} type -> ${type.name}`,
      );
    }
  }

  /** Sends one parameter value (real units) of a block currently set to `typeId`. */
  sendParam(blockId: string, typeId: number, paramId: string, value: number): void {
    const block = findBlock(blockId);
    const type = findType(block, typeId);
    const spec = findParamSpec(block, typeId, paramId);
    const displayValue = spec.kind === 'range' ? value.toFixed(spec.decimals ?? 0) : spec.options[value];
    const label = `${block.name} ${type.name}: ${spec.label} = ${displayValue}${spec.kind === 'range' && spec.unit ? spec.unit : ''}`;
    const typeParamIndex = type.params.indexOf(spec);
    if (typeParamIndex === -1) {
      // `spec` came from `block.commonParams` (AMP/CAB's Gain/Bass/Mid/Treble, Low Cut/High
      // Cut/Level) — shared across every model, not part of any `type.params` array, so the
      // positional-SysEx-index convention below doesn't apply and there's no confirmed SysEx
      // mechanism for these yet. CC stays the only known-working path until that's verified; this
      // is the one place this editor still edits via CC rather than SysEx (see `sendBlockType`'s
      // and the SysEx-param branch's own doc comments for why everywhere else doesn't).
      const raw = spec.kind === 'range' ? realToCC(spec.min, spec.max, value, spec.curve) : enumIndexToCC(value, spec.options.length);
      this.transport.sendCC(this.outputId, this.channel, spec.cc ?? 0, raw, label);
      return;
    }
    // Every other param: the official app edits these via SysEx too, never CC (confirmed
    // end-to-end on FX1/FX2's own params — `RangeParam.cc`, where set, is real and reachable by
    // external MIDI gear driving the device directly, but not what this editor itself sends — see
    // `BlockSpec.typeCC`'s own doc comment for the parallel reasoning on type-select). A param's
    // SysEx index is `RangeParam.sysexParamIndex` if it declares one (a device-side reserved-slot
    // quirk, e.g. Motion Wah's Sweep/Mix — see that type's own comment), else its plain position
    // in `type.params` — same convention `findParamSpecBySysexIndex` already reads back.
    const sysexIndex = spec.kind === 'range' ? (spec.sysexParamIndex ?? typeParamIndex) : typeParamIndex;
    const normalized =
      spec.kind === 'range' ? realToNormalized(spec.min, spec.max, value, spec.curve) : value / Math.max(1, spec.options.length - 1);
    this.transport.sendSysEx(this.outputId, buildSetParamValueSysEx(CHAIN_ORDER_BLOCK_IDS[blockId], sysexIndex, normalized), label);
  }

  /** Pushes a whole patch: for every block its on/off, type and each active parameter. */
  sendFullPatch(patch: PatchState): void {
    const { transport, outputId, channel } = this;
    for (const block of nanocoreSpec.blocks) {
      const blockState: BlockPatchState = patch[block.id] ?? buildBlockDefault(block);
      transport.sendCC(outputId, channel, block.onOffCC, onOffToCC(blockState.on), `${block.name} ${blockState.on ? 'ON' : 'OFF'}`);
      const type = findType(block, blockState.typeId);
      if (block.sysexTypeField !== undefined) {
        transport.sendSysEx(outputId, buildBlockTypeSysEx(block.sysexTypeField, blockState.typeId), `${block.name} type -> ${type.name}`);
      } else {
        transport.sendSysEx(outputId, buildChainOrderPrimeSysEx(), `${block.name} type change (prime)`);
        transport.sendSysEx(
          outputId,
          buildSetBlockTypeSysEx(CHAIN_ORDER_BLOCK_IDS[block.id], blockState.typeId, defaultNormalizedValuesForType(type)),
          `${block.name} type -> ${type.name}`,
        );
      }
      for (const spec of block.commonParams ?? []) {
        // See sendParam's own comment: no confirmed SysEx mechanism for common params yet.
        const value = blockState.params[spec.id] ?? (spec.kind === 'range' ? spec.min : 0);
        const raw = spec.kind === 'range' ? realToCC(spec.min, spec.max, value, spec.curve) : enumIndexToCC(value, spec.options.length);
        transport.sendCC(outputId, channel, spec.cc ?? 0, raw, `${block.name}: ${spec.label}`);
      }
      type.params.forEach((spec, typeParamIndex) => {
        const value = blockState.params[spec.id] ?? (spec.kind === 'range' ? spec.min : 0);
        const sysexIndex = spec.kind === 'range' ? (spec.sysexParamIndex ?? typeParamIndex) : typeParamIndex;
        const normalized =
          spec.kind === 'range' ? realToNormalized(spec.min, spec.max, value, spec.curve) : value / Math.max(1, spec.options.length - 1);
        transport.sendSysEx(outputId, buildSetParamValueSysEx(CHAIN_ORDER_BLOCK_IDS[block.id], sysexIndex, normalized), `${block.name}: ${spec.label}`);
      });
    }
  }

  /** Sets the effect-chain order (block ids, SysEx fieldId 0x05). */
  sendChainOrder(order: string[]): void {
    const ids = order.map((id) => CHAIN_ORDER_BLOCK_IDS[id]);
    // ToneCommand always sends this fieldId-0x00 "prime" message right before its own chain-order
    // set — see buildChainOrderPrimeSysEx's doc comment.
    this.transport.sendSysEx(this.outputId, buildChainOrderPrimeSysEx(), 'Chain order (prime)');
    this.transport.sendSysEx(this.outputId, buildChainOrderSysEx(ids), `Chain order -> ${order.join(' > ')}`);
  }

  recallProgram(program: number): void {
    this.transport.sendProgramChange(this.outputId, this.channel, program, `Recall device preset ${program}`);
  }

  stepPreset(direction: 'prev' | 'next'): void {
    const cc = direction === 'prev' ? 81 : 82;
    const label = direction === 'prev' ? 'Previous preset' : 'Next preset';
    this.transport.sendCC(this.outputId, this.channel, cc, 127, label);
    // Momentary control: release shortly after, per MIDI guide ("64-127 triggers").
    const channel = this.channel;
    setTimeout(() => this.transport.sendCC(this.outputId, channel, cc, 0, `${label} (release)`), 80);
  }

  setTuner(on: boolean): void {
    this.transport.sendCC(this.outputId, this.channel, 80, onOffToCC(on), `Tuner ${on ? 'ON' : 'OFF'}`);
  }

  /** One raw CC message, bypassing every model above. */
  sendCC(cc: number, value: number, description?: string): void {
    this.transport.sendCC(this.outputId, this.channel, cc, value, description ?? `Test CC${cc} = ${value}`);
  }

  /** Renames the device's active (live) patch — it persists only after `saveToSlot`. Truncated to
   * the device's 8-character cap; returns the name actually sent. */
  renamePreset(name: string): string {
    const truncated = name.slice(0, PRESET_NAME_MAX);
    this.transport.sendSysEx(this.outputId, buildRenamePresetSysEx(truncated), `Rename patch -> "${truncated}"`);
    return truncated;
  }

  // ---- request/reply -------------------------------------------------------------------------

  private request(request: number[], isResponse: (bytes: readonly number[]) => boolean, label: string, timeoutMs?: number) {
    return requestSysExResponse(this.rx, this.outputId, request, isResponse, label, timeoutMs);
  }

  /** Reads the device's current patch: the LIVE state (opcode 0x63) first — it carries the loaded
   * slot number — then the SAVED state of that slot (opcode 0x41, two pages). `fallbackSlot` is
   * used when the live profile doesn't answer or parse. `state` is `null` when the saved pages
   * didn't come back (no reply: Simulator, older firmware, dropped connection). Merge the result
   * into a patch with `applySnapshotToPatch`. */
  async readSnapshot(fallbackSlot: number): Promise<DeviceSnapshot> {
    const ampProfile = await this.request(buildAmpProfileReadSysEx(), isAmpProfileResponse, 'Read AMP profile (chain order)');
    const slot = slotFromLiveProfile(ampProfile, fallbackSlot);
    const pages = await this.readPresetPages(slot);
    if (!pages) return { slot, state: null };
    const { page1, page2 } = pages;
    return { slot, state: buildSnapshot(ampProfile, page1, page2) };
  }

  /** Reads the SAVED data of `slot` (opcode 0x41) as the two page frames the decoders expect, or
   * `null` if the device doesn't deliver it. Over USB one request of 200 bytes is answered in full,
   * and page 2 follows from byte 200. Over Bluetooth LE the device caps every reply at 59 data bytes
   * (captured 2026-10-08 — asking for 200 returned 59), so a first reply shorter than asked means
   * "walk the preset in windows": request from the end of what is already held until a window comes
   * back short, then cut the whole into the same two pages. */
  private async readPresetPages(slot: number): Promise<{ page1: number[]; page2: number[] } | null> {
    const label = (offset: number) => `Read current patch (offset ${offset}, slot ${slot})`;
    const ask = (offset: number) =>
      this.request(
        buildReadPresetWindowSysEx(slot, offset, PRESET_PAGE_BYTES),
        (bytes) => {
          const w = parseReadPresetWindow(bytes);
          return w !== null && w.slot === slot && w.offset === offset;
        },
        label(offset),
      );

    const first = await ask(0);
    if (!first) return null;
    const head = parseReadPresetWindow(first)!;
    if (head.data.length >= PRESET_PAGE_BYTES) {
      const second = await ask(PRESET_PAGE_BYTES);
      return second ? { page1: first, page2: second } : null;
    }

    const cap = head.data.length;
    const data = [...head.data];
    while (data.length < PRESET_MAX_BYTES) {
      const reply = (await ask(data.length)) ?? (await ask(data.length)); // one retry — a lost window must not read as the end
      if (!reply) break;
      const window = parseReadPresetWindow(reply)!;
      data.push(...window.data);
      if (window.data.length < cap) break;
    }
    // A preset shorter than one page (a never-saved slot holds ~100 bytes) simply has an empty page 2.
    const page = (offset: number, chunk: number[]) =>
      buildReplyFrame(head.seq, READ_PRESET_OPCODE_TAG, 0, [slot, offset & 0xff, offset >> 8, ...head.tag, ...chunk]);
    return { page1: page(0, data.slice(0, PRESET_PAGE_BYTES)), page2: page(PRESET_PAGE_BYTES, data.slice(PRESET_PAGE_BYTES)) };
  }

  /** Reads the SAVED name of each preset slot from 0 to `count - 1` (read-only), `null` where a slot's
   * name didn't decode. The name sits in the first 59 bytes of a preset — the most a Bluetooth reply
   * carries — so one short window per slot is enough on either transport (64 slots ≈ 65 ms over USB).
   * Stops early when the first slot gets no reply at all (Simulator, older firmware). */
  async readPresetNames(count: number = nanocoreSpec.meta.presetSlots): Promise<(string | null)[]> {
    const names: (string | null)[] = [];
    for (let slot = 0; slot < count; slot += 1) {
      const reply = await this.request(
        buildReadPresetWindowSysEx(slot, 0, PRESET_NAME_WINDOW_BYTES),
        (bytes) => {
          const w = parseReadPresetWindow(bytes);
          return w !== null && w.slot === slot && w.offset === 0;
        },
        `Read preset name (slot ${slot})`,
      );
      if (!reply && slot === 0) return [];
      names.push(reply ? parsePresetName(reply) : null);
    }
    return names;
  }

  /** Reads the device-wide settings (Wireless, Loopback, Input Gain, volumes, MIDI channel). */
  async readGlobalSettings(): Promise<GlobalSettings | null> {
    const response = await this.request(buildGlobalSettingsPollSysEx(), isGlobalSettingsResponse, 'Read global settings');
    return response && parseGlobalSettingsResponse(response);
  }

  /** Sets one global setting (`fieldId` from `GLOBAL_SETTING_FIELD`, `value` already encoded) and
   * returns the settings the device reports back. */
  async setGlobalSetting(fieldId: number, value: number): Promise<GlobalSettings | null> {
    const response = await this.request(buildGlobalSettingSysEx(fieldId, value), isGlobalSettingsResponse, `Set global setting ${fieldId} -> ${value}`);
    return response && parseGlobalSettingsResponse(response);
  }

  /** Saves the device's own live state to preset `slot` (opcode 0x46). Resolves `true` on ack. */
  async saveToSlot(slot: number): Promise<boolean> {
    const response = await this.request(buildSavePresetSysEx(slot), (bytes) => isSavePresetResponse(bytes, slot), `Save to slot ${slot}`);
    return response !== null;
  }

  // ---- AMP/FX2 profile slots -----------------------------------------------------------------

  /** Adapts request/reply to the profile-command family: each call builds a fresh frame (new
   * sequence number), waits for the reply with the same opcode and sequence, decoded. */
  private profileTransact(): CommandTransact {
    return async (build, label) => {
      const frame = build();
      const raw = await this.request(frame, (bytes) => isCommandReply(bytes, frame), label, PROFILE_COMMAND_TIMEOUT_MS);
      return raw ? parseCommandMessage(raw) : null;
    };
  }

  /** Reads every AMP/FX2 profile slot's catalog record (read-only). Empty when nothing answered. */
  readProfileCatalog(): Promise<ProfileCatalogRecord[]> {
    return readProfileCatalog(this.profileTransact());
  }

  /** Reads the stored body of profile slot `slot` (0-37), or CAB IR slot `slot` (0-29) with `ir`,
   * and checks its CRC-32 against the catalog (read-only). */
  readProfileData(slot: number, ir = false): Promise<ProfileReadResult> {
    return readProfileData(this.profileTransact(), slot, ir);
  }

  /** Reads every CAB IR slot's catalog record (read-only). Empty when nothing answered. */
  readIrCatalog(): Promise<ProfileCatalogRecord[]> {
    return readIrCatalog(this.profileTransact());
  }

  /** Uploads a `.ead` profile file into `slot` (0-37) with ToneCommand's exact command sequence.
   * OVERWRITES that slot — the only way back is the official app's "Restore Factory Content". */
  uploadProfile(params: {
    slot: number;
    data: Uint8Array;
    name: string;
    onProgress?: (phase: UploadPhase, sent: number, total: number) => void;
  }): Promise<UploadResult> {
    return runProfileUpload({ transact: this.profileTransact(), ...params });
  }

  // ---- live ----------------------------------------------------------------------------------

  /** Listens to the device's unsolicited pushes and keeps the link alive with the heartbeat the
   * device requires before it sends any. Returns the stop function. See `startLiveSession`. */
  startLive(handlers: LiveHandlers): () => void {
    return startLiveSession(this.rx, this.outputId, handlers);
  }
}
