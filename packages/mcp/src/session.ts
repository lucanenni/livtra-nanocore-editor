import {
  ACTIVE_PRESET_SLOT,
  GLOBAL_SETTING_FIELD,
  NanoCoreDevice,
  PROFILE_FIRST_FX2_SLOT,
  PROFILE_SLOT_COUNT,
  amp,
  applySnapshotToPatch,
  buildDefaultPatch,
  findBlock,
  fx2,
  nanocoreSpec,
  remapParamsForType,
  resolveParamPush,
  sanitizeProfileName,
  validateProfileFile,
} from '@nanocore/protocol';
import type { GlobalSettings, MidiTransport, PatchState, ProfileCatalogRecord, UploadResult } from '@nanocore/protocol';
import { NodeMidiTransport } from './nodeMidiTransport';
import { coerceParamValue, resolveBlock, resolveParam, resolveType } from './format';

/** Highest preset slot this server will write (the spec's `presetSlots`, 1-based on the device). */
export const MAX_SAVE_SLOT = nanocoreSpec.meta.presetSlots;

/** Name of profile slot `slot` (0-based) as the official app ships it. */
export function factoryProfileName(slot: number): string {
  if (slot < PROFILE_FIRST_FX2_SLOT) return amp.types[slot]?.name ?? `Slot ${slot + 1}`;
  return fx2.types.find((t) => t.id === slot - PROFILE_FIRST_FX2_SLOT)?.name ?? `Slot ${slot + 1}`;
}

export type SettingName = 'wireless' | 'loopback' | 'input_gain_db' | 'usb_volume' | 'bt_volume' | 'midi_channel';

/** The connection to one NanoCore plus this server's picture of its current patch. Everything the
 * tools do goes through here, so it can be exercised with a fake transport. */
export class NanoCoreSession {
  private readonly openTransport: () => MidiTransport;
  private transport: MidiTransport | null = null;
  private device: NanoCoreDevice | null = null;
  private stopLive: (() => void) | null = null;

  portName: string | null = null;
  patch: PatchState = buildDefaultPatch();
  chainOrder: string[] = nanocoreSpec.blocks.map((b) => b.id);
  /** 0-based slot of the preset the device has loaded. */
  activeSlot: number = ACTIVE_PRESET_SLOT;
  presetName: string | null = null;
  /** AMP/CAB models set from here: the device cannot report an unsaved AMP/CAB model back (its
   * live state omits it), so they are remembered and re-applied after every read, until the slot
   * changes. */
  private modelOverrides = new Map<string, number>();
  /** Same for the chain order: the pedal only reports the SAVED order, so one set from here is
   * remembered and re-applied after every read, until the slot changes. */
  private chainOverride: string[] | null = null;

  constructor(openTransport: () => MidiTransport = () => new NodeMidiTransport()) {
    this.openTransport = openTransport;
  }

  get connected(): boolean {
    return this.device !== null;
  }

  private async ensureTransport(): Promise<MidiTransport> {
    if (!this.transport) {
      const t = this.openTransport();
      await t.init();
      this.transport = t;
    }
    return this.transport;
  }

  async listPorts(): Promise<string[]> {
    return (await this.ensureTransport()).listOutputs().map((p) => p.name);
  }

  /** Connects to `port` (case-insensitive name or substring), or to the port named like the
   * NanoCore when omitted. Reads the device's current patch once connected. */
  async connect(port?: string, channel = 1): Promise<{ port: string }> {
    const transport = await this.ensureTransport();
    const outputs = transport.listOutputs();
    const needle = (port ?? 'nanocore').toLowerCase();
    const match = outputs.find((o) => o.name.toLowerCase() === needle) ?? outputs.find((o) => o.name.toLowerCase().includes(needle));
    if (!match) {
      throw new Error(
        port
          ? `No MIDI port matching "${port}". Available: ${outputs.map((o) => o.name).join(', ') || 'none'}.`
          : `No NanoCore found among the MIDI ports (${outputs.map((o) => o.name).join(', ') || 'none'}). Plug it in over USB, or pass the port name.`,
      );
    }
    this.disconnect();
    this.device = new NanoCoreDevice(transport, match.id, channel);
    this.portName = match.name;
    this.modelOverrides.clear();
    this.chainOverride = null;
    this.startLive();
    try {
      await this.refresh();
    } catch (err) {
      // Connected, but the device didn't answer the read — leave it connected (sends still work).
      this.lastReadError = err instanceof Error ? err.message : String(err);
    }
    return { port: match.name };
  }

  lastReadError: string | null = null;

  disconnect(): void {
    this.stopLive?.();
    this.stopLive = null;
    this.device = null;
    this.portName = null;
  }

  /** Closes the MIDI ports too (process shutdown). */
  close(): void {
    this.disconnect();
    (this.transport as { close?: () => void } | null)?.close?.();
    this.transport = null;
  }

  private requireDevice(): NanoCoreDevice {
    if (!this.device) throw new Error('Not connected to a NanoCore. Call connect first.');
    return this.device;
  }

  /** Keeps the local picture current with what happens on the pedal itself (footswitch, knobs,
   * preset recalls) and keeps the link alive. */
  private startLive(): void {
    this.stopLive = this.requireDevice().startLive({
      onSlotChanged: (slot) => {
        this.activeSlot = slot;
        this.modelOverrides.clear();
        this.chainOverride = null;
        void this.refresh().catch(() => {});
      },
      onBlockOn: ({ blockId, on }) => {
        const prev = this.patch[blockId];
        if (prev) this.patch = { ...this.patch, [blockId]: { ...prev, on } };
      },
      onParamChanged: (change) => {
        const prev = this.patch[change.blockId];
        if (!prev) return;
        const resolved = resolveParamPush(prev.typeId, change);
        if (resolved) this.patch = { ...this.patch, [change.blockId]: { ...prev, params: { ...prev.params, [resolved.paramId]: resolved.value } } };
      },
    });
  }

  /** Re-reads the device's current patch into this session. */
  async refresh(): Promise<void> {
    const device = this.requireDevice();
    const { slot, state } = await device.readSnapshot(this.activeSlot);
    this.activeSlot = slot;
    if (!state) throw new Error('The NanoCore did not answer the patch read (is another app holding the port?).');
    this.lastReadError = null;
    if (state.chainOrder) this.chainOrder = state.chainOrder;
    if (this.chainOverride) this.chainOrder = this.chainOverride;
    if (state.name !== null) this.presetName = state.name;
    let patch = applySnapshotToPatch(this.patch, state);
    for (const [blockId, typeId] of this.modelOverrides) {
      const block = findBlock(blockId);
      const type = block.types.find((t) => t.id === typeId);
      if (type && patch[blockId]) patch = { ...patch, [blockId]: { ...patch[blockId], typeId, params: remapParamsForType(block, type, patch[blockId].params) } };
    }
    this.patch = patch;
  }

  setBlock(blockRef: string, change: { on?: boolean; type?: string | number }): void {
    const device = this.requireDevice();
    const block = resolveBlock(blockRef);
    // Resolve everything before sending anything, so a bad request changes nothing.
    const type = change.type !== undefined ? resolveType(block, change.type) : null;
    if (change.on === undefined && !type) throw new Error('Nothing to change: pass "on" and/or "type".');
    if (type) {
      const prev = this.patch[block.id];
      this.patch = { ...this.patch, [block.id]: { ...prev, typeId: type.id, params: remapParamsForType(block, type, prev.params) } };
      if (block.id === 'amp' || block.id === 'cab') this.modelOverrides.set(block.id, type.id);
      device.sendBlockType(block.id, type.id);
    }
    if (change.on !== undefined) {
      this.patch = { ...this.patch, [block.id]: { ...this.patch[block.id], on: change.on } };
      device.sendBlockOn(block.id, change.on);
    }
  }

  /** Sets one parameter of a block's current type; returns the value as stored. */
  setParam(blockRef: string, paramRef: string, input: number | string): { label: string; value: number } {
    const device = this.requireDevice();
    const block = resolveBlock(blockRef);
    const state = this.patch[block.id];
    const spec = resolveParam(block, state.typeId, paramRef);
    const value = coerceParamValue(spec, input);
    this.patch = { ...this.patch, [block.id]: { ...state, params: { ...state.params, [spec.id]: value } } };
    device.sendParam(block.id, state.typeId, spec.id, value);
    return { label: spec.label, value };
  }

  setChainOrder(order: string[]): void {
    const device = this.requireDevice();
    const ids = order.map((r) => resolveBlock(r).id);
    const current = nanocoreSpec.blocks.map((b) => b.id);
    if (ids.length !== current.length || !current.every((id) => ids.includes(id))) {
      throw new Error(`The chain order must list each of the ${current.length} blocks exactly once: ${current.join(', ')}.`);
    }
    this.chainOrder = ids;
    this.chainOverride = ids;
    device.sendChainOrder(ids);
  }

  /** Renames the live patch (not persisted until `saveToSlot`); returns the name sent. */
  rename(name: string): string {
    const device = this.requireDevice();
    const sent = device.renamePreset(name);
    this.presetName = sent;
    return sent;
  }

  /** Saves the pedal's current live state into preset `number` (1-based, as the device shows it). */
  async saveToSlot(number: number): Promise<boolean> {
    const device = this.requireDevice();
    if (!Number.isInteger(number) || number < 1 || number > MAX_SAVE_SLOT) {
      throw new Error(`Preset number must be 1-${MAX_SAVE_SLOT}.`);
    }
    return device.saveToSlot(number - 1);
  }

  /** Recalls preset `number` (1-based, as the device shows it) by Program Change, then reads it. */
  async recall(number: number, settleMs = 250): Promise<void> {
    const device = this.requireDevice();
    if (!Number.isInteger(number) || number < 1 || number > 128) throw new Error('Preset number must be 1-128.');
    this.modelOverrides.clear();
    this.chainOverride = null;
    device.recallProgram(number - 1);
    this.activeSlot = number - 1;
    await new Promise((r) => setTimeout(r, settleMs));
    await this.refresh();
  }

  async globalSettings(): Promise<GlobalSettings> {
    const settings = await this.requireDevice().readGlobalSettings();
    if (!settings) throw new Error('The NanoCore did not answer the global-settings read.');
    return settings;
  }

  async setGlobalSetting(name: SettingName, value: number | boolean): Promise<GlobalSettings> {
    const device = this.requireDevice();
    const num = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    const bad = (msg: string) => new Error(`${name}: ${msg}`);
    let field: number;
    let raw: number;
    switch (name) {
      case 'wireless':
      case 'loopback':
        if (num !== 0 && num !== 1) throw bad('must be true or false.');
        field = name === 'wireless' ? GLOBAL_SETTING_FIELD.WIRELESS : GLOBAL_SETTING_FIELD.LOOPBACK;
        raw = num;
        break;
      case 'input_gain_db':
        if (!Number.isInteger(num) || num < -64 || num > 63) throw bad('must be a whole number of dB between -64 and 63.');
        field = GLOBAL_SETTING_FIELD.INPUT_GAIN;
        raw = num & 0x7f; // signed 7-bit two's complement on the wire
        break;
      case 'usb_volume':
      case 'bt_volume':
        if (!Number.isInteger(num) || num < 0 || num > 100) throw bad('must be a whole number 0-100.');
        field = name === 'usb_volume' ? GLOBAL_SETTING_FIELD.USB_VOLUME : GLOBAL_SETTING_FIELD.BT_VOLUME;
        raw = num;
        break;
      case 'midi_channel':
        if (!Number.isInteger(num) || num < 0 || num > 16) throw bad('must be 0 (Omni) or a channel 1-16.');
        field = GLOBAL_SETTING_FIELD.MIDI_CHANNEL;
        raw = num;
        break;
    }
    const settings = await device.setGlobalSetting(field, raw);
    if (!settings) throw new Error('The NanoCore did not acknowledge the setting.');
    return settings;
  }

  async profileCatalog(): Promise<Array<ProfileCatalogRecord & { kind: 'AMP' | 'FX2'; factoryName: string }>> {
    const records = await this.requireDevice().readProfileCatalog();
    if (records.length === 0) throw new Error('The NanoCore did not answer the profile catalog read.');
    return records.map((r) => ({ ...r, kind: r.slot < PROFILE_FIRST_FX2_SLOT ? 'AMP' : 'FX2', factoryName: factoryProfileName(r.slot) }));
  }

  /** Uploads a `.ead` file into profile slot `number` (1-based). Overwrites that slot. */
  async uploadProfile(number: number, data: Uint8Array, name: string): Promise<UploadResult> {
    const device = this.requireDevice();
    if (!Number.isInteger(number) || number < 1 || number > PROFILE_SLOT_COUNT) throw new Error(`Profile slot must be 1-${PROFILE_SLOT_COUNT}.`);
    const check = validateProfileFile(data);
    if (!check.ok) throw new Error(`Not a valid .ead profile file (${check.problem}).`);
    return device.uploadProfile({ slot: number - 1, data, name: sanitizeProfileName(name) });
  }
}
