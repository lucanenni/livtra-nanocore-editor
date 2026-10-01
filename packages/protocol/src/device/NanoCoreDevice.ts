import { enumIndexToCC, onOffToCC, realToCC, realToNormalized } from '../midi/scaling';
import type { MidiTransport } from '../midi/types';
import { withReplyReassembly } from '../midi/segmentedReplies';
import {
  CHAIN_ORDER_BLOCK_IDS,
  buildAmpProfileReadSysEx,
  buildBlockTypeSysEx,
  buildChainOrderPrimeSysEx,
  buildChainOrderSysEx,
  buildGlobalSettingSysEx,
  buildGlobalSettingsPollSysEx,
  buildReadPresetSysEx,
  buildRenamePresetSysEx,
  buildSavePresetSysEx,
  buildSetParamValueSysEx,
  isAmpProfileResponse,
  isCommandReply,
  isGlobalSettingsResponse,
  isReadPresetResponse,
  isSavePresetResponse,
  parseCommandMessage,
} from '../midi/sysex';
import type { ProfileCatalogRecord } from '../midi/sysex';
import { parseGlobalSettingsResponse } from '../midi/presetReader';
import type { GlobalSettings } from '../midi/presetReader';
import { readProfileCatalog, runProfileUpload } from '../midi/profileUpload';
import type { CommandTransact, UploadPhase, UploadResult } from '../midi/profileUpload';
import { nanocoreSpec } from '../data/nanocoreSpec';
import { activeParams, buildBlockDefault, findBlock, findParamSpec, findType } from '../patch/patchDefaults';
import type { BlockPatchState, PatchState } from '../patch/patchTypes';
import { PROFILE_COMMAND_TIMEOUT_MS, requestSysExResponse } from './request';
import { buildSnapshot, slotFromLiveProfile } from './snapshot';
import type { DeviceSnapshot } from './snapshot';
import { startLiveSession } from './live';
import type { LiveHandlers } from './live';

/** Maximum preset-name length the device accepts (opcode 0x6d, field 0x08). */
export const PRESET_NAME_MAX = 8;

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
      // Confirmed on real hardware: typeCC has no effect for this block — SysEx is the only way.
      this.transport.sendSysEx(this.outputId, buildBlockTypeSysEx(block.sysexTypeField, typeId), `${block.name} type -> ${type.name}`);
    } else {
      this.transport.sendCC(this.outputId, this.channel, block.typeCC, typeId, `${block.name} type -> ${type.name}`);
    }
  }

  /** Sends one parameter value (real units) of a block currently set to `typeId`. */
  sendParam(blockId: string, typeId: number, paramId: string, value: number): void {
    const block = findBlock(blockId);
    const spec = findParamSpec(block, typeId, paramId);
    const displayValue = spec.kind === 'range' ? value.toFixed(spec.decimals ?? 0) : spec.options[value];
    const label = `${block.name} ${findType(block, typeId).name}: ${spec.label} = ${displayValue}${
      spec.kind === 'range' && spec.unit ? spec.unit : ''
    }`;
    if (spec.kind === 'range' && spec.sysexParamIndex !== undefined) {
      // No working CC for this one — see RangeParam.sysexParamIndex's doc comment.
      const normalized = realToNormalized(spec.min, spec.max, value, spec.curve);
      this.transport.sendSysEx(this.outputId, buildSetParamValueSysEx(CHAIN_ORDER_BLOCK_IDS[blockId], spec.sysexParamIndex, normalized), label);
      return;
    }
    const raw = spec.kind === 'range' ? realToCC(spec.min, spec.max, value, spec.curve) : enumIndexToCC(value, spec.options.length);
    // spec.cc is guaranteed here: the sysexParamIndex-without-cc case returned above, and every
    // other RangeParam (via paramHelpers.range) and every EnumParam always carries a real cc.
    this.transport.sendCC(this.outputId, this.channel, spec.cc ?? 0, raw, label);
  }

  /** Pushes a whole patch: for every block its on/off, type and each active parameter. */
  sendFullPatch(patch: PatchState): void {
    const { transport, outputId, channel } = this;
    for (const block of nanocoreSpec.blocks) {
      const blockState: BlockPatchState = patch[block.id] ?? buildBlockDefault(block);
      transport.sendCC(outputId, channel, block.onOffCC, onOffToCC(blockState.on), `${block.name} ${blockState.on ? 'ON' : 'OFF'}`);
      const typeName = findType(block, blockState.typeId).name;
      if (block.sysexTypeField !== undefined) {
        transport.sendSysEx(outputId, buildBlockTypeSysEx(block.sysexTypeField, blockState.typeId), `${block.name} type -> ${typeName}`);
      } else {
        transport.sendCC(outputId, channel, block.typeCC, blockState.typeId, `${block.name} type -> ${typeName}`);
      }
      for (const spec of activeParams(block, blockState.typeId)) {
        const value = blockState.params[spec.id] ?? (spec.kind === 'range' ? spec.min : 0);
        if (spec.kind === 'range' && spec.sysexParamIndex !== undefined) {
          const normalized = realToNormalized(spec.min, spec.max, value, spec.curve);
          transport.sendSysEx(outputId, buildSetParamValueSysEx(CHAIN_ORDER_BLOCK_IDS[block.id], spec.sysexParamIndex, normalized), `${block.name}: ${spec.label}`);
          continue;
        }
        const raw = spec.kind === 'range' ? realToCC(spec.min, spec.max, value, spec.curve) : enumIndexToCC(value, spec.options.length);
        transport.sendCC(outputId, channel, spec.cc ?? 0, raw, `${block.name}: ${spec.label}`);
      }
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
    const readPage = (page: 1 | 2) =>
      this.request(buildReadPresetSysEx(page, slot), (bytes) => isReadPresetResponse(bytes, slot), `Read current patch (page ${page}, slot ${slot})`);
    const page1 = await readPage(1);
    if (!page1) return { slot, state: null };
    const page2 = await readPage(2);
    if (!page2) return { slot, state: null };
    return { slot, state: buildSnapshot(ampProfile, page1, page2) };
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
