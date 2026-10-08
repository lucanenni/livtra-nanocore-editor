import { create } from 'zustand';
import {
  ACTIVE_PRESET_SLOT,
  NanoCoreDevice,
  applySnapshotToPatch,
  buildDefaultPatch,
  findBlock,
  findType,
  nanocoreSpec,
  remapParamsForType,
  resolveParamPush,
  validatePatch,
} from '@nanocore/protocol';
import type {
  GlobalSettings,
  MidiPortInfo,
  MidiTransport,
  OutgoingMessage,
  PatchState,
  PresetEntry,
  ProfileCatalogRecord,
  UploadPhase,
  UploadResult,
} from '@nanocore/protocol';
import { BleMidiTransport, SimulatorTransport, WebMidiTransport } from '../midi';
import { loadPresets, savePresets } from './localPresetStorage';

const MAX_LOG_LENGTH = 300;

const webMidiTransport = new WebMidiTransport();
const simulatorTransport = new SimulatorTransport();
const bleMidiTransport = new BleMidiTransport();

function transportFor(kind: TransportKind): MidiTransport {
  if (kind === 'webmidi') return webMidiTransport;
  if (kind === 'bluetooth') return bleMidiTransport;
  return simulatorTransport;
}

/** Finds the NanoCore in a port list by name (case-insensitive substring — real captures use
 * names like "Nanocore"). Returns `null` rather than falling back to some other port: this is
 * also what `initTransport` uses to decide it's safe to auto-connect (see
 * `ConnectionState.autoConnected`) — auto-connecting to an unrelated first-listed port (an audio
 * interface, other gear) was the original bug this whole Connect step exists to prevent. */
function findNanocoreOutput(outputs: MidiPortInfo[]): MidiPortInfo | null {
  return outputs.find((o) => /nanocore/i.test(o.name)) ?? null;
}

/** Turns a raw transport `init()` failure into something worth showing the user — no internal
 * API names, and a deliberate cancel (dismissing the browser's device chooser or permission
 * prompt) surfaces as `null` (not an error state) since nothing actually went wrong. */
function friendlyTransportError(err: unknown): string | null {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (/cancel|abort|dismiss|user gesture/i.test(raw)) return null;
  if (/not allowed|permission|denied|SecurityError/i.test(raw)) {
    return 'MIDI access was blocked. Allow it for this site in your browser settings, then reload.';
  }
  if (/not (available|supported)|no such|undefined is not/i.test(raw)) {
    return "This browser doesn't support the connection you picked — use Chrome, Edge, or Opera, or switch to the Simulator.";
  }
  return "Couldn't start that connection. Try again, pick a different transport, or use the Simulator.";
}

let unsubPorts: (() => void) | null = null;
let unsubMessages: (() => void) | null = null;
/** Stops the live session (push listener + keepalive ping) started by `startLive` — active while
 * `connection.connected` on a real transport. See `NanoCoreDevice.startLive` in
 * `@nanocore/protocol` for what it listens to and why the ping is required. */
let stopLiveSession: (() => void) | null = null;
let initGeneration = 0;

/** A device handle for the current connection, or `null` while nothing is connected — every send
 * and read below goes through this, so a not-connected store is a silent no-op. */
function deviceFor(state: PatchStore): NanoCoreDevice | null {
  const outputId = currentOutputId(state);
  if (!outputId) return null;
  return new NanoCoreDevice(transportFor(state.connection.transportKind), outputId, state.connection.channel);
}

/** Shared by `moveBlockInChain` and `setChainOrder`: updates local state and sends the resulting
 * order via SysEx (fieldId 0x05 — see midi/sysex.ts). */
function applyChainOrder(get: () => PatchStore, set: (partial: Partial<PatchStore>) => void, newOrder: string[]): void {
  set({ chainOrder: newOrder });
  deviceFor(get())?.sendChainOrder(newOrder);
}

/** Starts the live session: the device's own unsolicited pushes (footswitch/panel changes, knob
 * turns, global settings) are folded into the store as they arrive. Idempotent — replaces any
 * previous session. No-op for the Simulator (callers don't start it there). */
function startLive(
  get: () => PatchStore,
  set: (partial: Partial<PatchStore>) => void,
  transport: MidiTransport,
  outputId: string,
): void {
  stopLiveSession?.();
  stopLiveSession = new NanoCoreDevice(transport, outputId, get().connection.channel).startLive({
    onSlotChanged: (slot) => {
      set({ activeSlot: slot });
      // A different slot is now active (the user recalled another preset on the device) — the
      // whole patch needs re-reading, not just this one field.
      void get().readPresetFromDevice();
    },
    onBlockOn: ({ blockId, on }) => {
      const prev = get().patch[blockId];
      if (prev) set({ patch: { ...get().patch, [blockId]: { ...prev, on } } });
    },
    onGlobalSettings: (globalSettings) => set({ globalSettings }),
    onParamChanged: (change) => {
      const blockState = get().patch[change.blockId];
      if (!blockState) return;
      const resolved = resolveParamPush(blockState.typeId, change);
      if (!resolved) return;
      set({
        patch: {
          ...get().patch,
          [change.blockId]: { ...blockState, params: { ...blockState.params, [resolved.paramId]: resolved.value } },
        },
      });
    },
  });
}

export type TransportKind = 'webmidi' | 'simulator' | 'bluetooth';

interface ConnectionState {
  transportKind: TransportKind;
  outputId: string | null;
  /** True once the user has explicitly clicked Connect with `outputId` set. MIDI itself has no
   * session/handshake to reflect here (a port is just always "there" once granted) — this is a
   * purely app-level gate: every send action below is a no-op while `false` (see
   * `currentOutputId`), and it's what `readPresetFromDevice` fires on. Reset to `false` by
   * `initTransport`, switching transports, or picking a different output — always requires an
   * explicit Connect afterwards, never re-inferred. */
  connected: boolean;
  /** True only when `connected` was set by `initTransport` auto-detecting a NanoCore by name,
   * never by an explicit `connectDevice()` click — purely so `ConnectionPanel.tsx` can show a
   * "found and connected automatically" hint once, instead of the auto-connect being silent.
   * Cleared by any explicit connection action (Connect, Disconnect, or picking a different
   * output). */
  autoConnected: boolean;
  channel: number; // 1-16, transmit channel
  outputs: MidiPortInfo[];
  ready: boolean;
  initializing: boolean;
  error: string | null;
}

export interface ProfileUploadState {
  status: 'idle' | 'running' | 'done' | 'error';
  phase?: UploadPhase;
  slot?: number;
  /** Bytes acknowledged so far / total file length. */
  sent: number;
  total: number;
  /** Set when `status === 'error'`. */
  failure?: Extract<UploadResult, { ok: false }>;
}

interface PatchStore {
  patch: PatchState;
  /** Effect chain order (block ids). Kept separately from `patch`/presets for now — SysEx-only,
   * not covered by the manual, and not yet round-tripped through preset save/export. See
   * setChainOrder below and docs/MIDI_MAPPING_NOTES.md. */
  chainOrder: string[];
  /** Which preset slot `readPresetFromDevice` targets — tracked from the device's own
   * `isActiveSlotChangedPush` notifications (the user recalling a different preset on the
   * device itself), not a fixed constant. See `midi/sysex.ts`'s `ACTIVE_PRESET_SLOT` doc comment
   * for why this can't just be hardcoded. */
  activeSlot: number;
  /** The active preset's name as decoded from the device's own opcode-`0x41` read
   * (`parsePresetName`), or `null` before the first successful read / if it couldn't be decoded.
   * Display-only — not part of `patch` and not sent back to the device. */
  activeSlotName: string | null;
  /** The device's AMP/FX2 profile-slot catalog (38 records, read-only `0x36` reads) — `null` until
   * `readProfileCatalog` succeeds; cleared on disconnect. */
  profileCatalog: ProfileCatalogRecord[] | null;
  profileUpload: ProfileUploadState;
  /** The device's global/device-level settings (Wireless, Loopback, Input Gain, USB/BT Volume,
   * MIDI Channel) — `null` before the first successful `pollGlobalSettings()` or if the device
   * hasn't answered yet. Kept live by the same push listener as `patch`'s on/off state (opcode
   * `0x07`, see `midi/sysex.ts`'s `GLOBAL_SETTINGS_PUSH_OPCODE`). NOT persisted with a preset —
   * these are device-wide, not per-patch. Language has no CC/SysEx at all (confirmed absent from
   * a real capture that changed it) — it's a ToneCommand UI-only setting, not modeled here. */
  globalSettings: GlobalSettings | null;
  connection: ConnectionState;
  log: OutgoingMessage[];
  presets: PresetEntry[];
  activePresetId: string | null;
  activePresetDirty: boolean;

  // Connection
  initTransport: (kind: TransportKind) => Promise<void>;
  refreshOutputs: () => void;
  setOutput: (id: string) => void;
  setChannel: (ch: number) => void;
  clearLog: () => void;
  /** The app-level "actually start talking to it" step — see `ConnectionState.connected`'s doc
   * comment. No-op without an `outputId` selected. Triggers `readPresetFromDevice` once
   * connected (not for the Simulator — nothing to read). */
  connectDevice: () => void;
  /** Stops sending anything (see `ConnectionState.connected`) without touching the underlying
   * MIDI/Bluetooth connection itself — for that, see `disconnectBluetooth` (Bluetooth-only, and
   * about the actual GATT link, so the device picker can pick a different device next). */
  disconnectDevice: () => void;
  disconnectBluetooth: () => void;
  /** Reads the device's currently active (saved) patch back and syncs each block's type — and,
   * where confirmed (MOD; DEL/REV extrapolated — see `midi/presetReader.ts`), on/off state —
   * into `patch`. Parameter values aren't decoded yet, so they're left as whatever they were.
   * A no-op if there's no connected output, and resolves without changing anything if the
   * device doesn't answer within a few seconds (e.g. the Simulator, or older firmware). Called
   * automatically by `connectDevice`; also safe to call by hand (e.g. a "read from device"
   * button while already connected). */
  readPresetFromDevice: () => Promise<void>;
  /** Reads `globalSettings` back from the device (opcode `0x65`). A no-op if there's no connected
   * output; resolves without changing anything on timeout. Called automatically by
   * `connectDevice`; also safe to call by hand. */
  pollGlobalSettings: () => Promise<void>;
  /** Sets one global setting on the device (opcode `0x66`) and updates `globalSettings` from its
   * response. `fieldId` from `midi/sysex.ts`'s `GLOBAL_SETTING_FIELD`; `value` already encoded
   * per that field (Input Gain is signed 7-bit two's complement — see that constant's doc
   * comment). No-op without a connected output. */
  setGlobalSetting: (fieldId: number, value: number) => Promise<void>;

  // Patch editing
  setBlockOn: (blockId: string, on: boolean) => void;
  setBlockType: (blockId: string, typeId: number) => void;
  setParam: (blockId: string, paramId: string, value: number) => void;
  loadPatch: (patch: PatchState) => void;
  resetPatch: () => void;
  /** Moves a block one step left/right in the effect chain and sends the resulting order via
   * SysEx (fieldId 0x05 — see midi/sysex.ts). No-ops at either end of the chain. */
  moveBlockInChain: (blockId: string, direction: 'left' | 'right') => void;
  /** Replaces the whole chain order at once (e.g. after a drag-and-drop reorder in ChainView)
   * and sends it via SysEx immediately — same wire effect as repeated `moveBlockInChain` calls,
   * just in one step. Ignored (no state change, nothing sent) if `newOrder` isn't a permutation
   * of the current chain's block ids. */
  setChainOrder: (newOrder: string[]) => void;

  // Device-level actions
  sendFullPatch: () => void;
  recallProgram: (program: number) => void;
  stepPreset: (direction: 'prev' | 'next') => void;
  setTuner: (on: boolean) => void;
  /** Saves whatever the device currently considers its active/edited patch state to `slot` (opcode
   * `0x46` — see `midi/sysex.ts`'s `SAVE_PRESET_OPCODE` doc comment). This is NOT the same as
   * `sendFullPatch` followed by a save-to-slot in one step — it saves the device's own live state,
   * so call `sendFullPatch` first if the intent is "save what's currently in the editor". Resolves
   * `true` once the device acks the save, `false` on timeout or with no connected output. */
  saveToDeviceSlot: (slot: number) => Promise<boolean>;
  /** Renames the currently-active/edited patch on the device (opcode `0x6d`, field `0x08` — see
   * `midi/sysex.ts`'s `buildRenamePresetSysEx` doc comment). This is a LIVE edit like any other —
   * it does NOT persist on its own; call `saveToDeviceSlot` afterward to make it stick, same as
   * any other unsaved live tweak. Truncated to the device's real 8-character cap. Updates
   * `activeSlotName` immediately (optimistic — the device doesn't push a confirmation, and
   * `readPresetFromDevice` won't show it either until it's actually saved, since the name comes
   * from the `0x41` saved-state read, not the live `0x63` one). No-op without a connected output. */
  renamePresetOnDevice: (name: string) => void;
  /** Sends one raw MIDI CC message directly, bypassing every param/type/on-off action above — for
   * `CCReferencePanel.tsx`'s "send a test value" buttons, so someone configuring an external MIDI
   * controller can confirm a CC number reaches the device and watch it react, independent of this
   * editor's own UI state (no store field is updated). No-op without a connected output. */
  sendTestCC: (cc: number, value: number, description?: string) => void;
  /** Reads every AMP/FX2 profile slot's catalog record into `profileCatalog` (read-only). Resolves
   * `true` if at least one slot answered. */
  readProfileCatalog: () => Promise<boolean>;
  /** Uploads a `.ead` profile file into `slot` (0-37) with ToneCommand's exact command sequence
   * (see `midi/profileUpload.ts`), reporting progress through `profileUpload` and refreshing
   * `profileCatalog` afterwards. OVERWRITES that slot — the only way back to factory content is
   * ToneCommand's "Restore Factory Content". Ignored while another upload is running. */
  uploadProfile: (params: { slot: number; data: Uint8Array; name: string }) => Promise<boolean>;
  resetProfileUpload: () => void;

  // Local preset library
  savePresetLocal: (name: string) => void;
  renamePreset: (id: string, name: string) => void;
  updateActivePreset: () => void;
  deletePreset: (id: string) => void;
  applyPreset: (id: string) => void;
  exportPresets: () => string;
  importPresets: (json: string) => { ok: boolean; error?: string };

  // Single-patch export/import (the current, possibly-unsaved patch — distinct from the
  // saved preset library above).
  exportCurrentPatch: () => string;
  importPatch: (json: string) => { ok: boolean; error?: string };
}

function currentOutputId(state: PatchStore): string | null {
  return state.connection.connected ? state.connection.outputId : null;
}

export const usePatchStore = create<PatchStore>((set, get) => ({
  patch: buildDefaultPatch(),
  chainOrder: nanocoreSpec.blocks.map((b) => b.id),
  activeSlot: ACTIVE_PRESET_SLOT,
  activeSlotName: null,
  profileCatalog: null,
  profileUpload: { status: 'idle', sent: 0, total: 0 },
  globalSettings: null,
  connection: {
    transportKind: 'simulator',
    outputId: null,
    connected: false,
    autoConnected: false,
    channel: 1,
    outputs: [],
    ready: false,
    initializing: false,
    error: null,
  },
  log: [],
  presets: loadPresets(),
  activePresetId: null,
  activePresetDirty: false,

  initTransport: async (kind) => {
    // Guard against overlapping calls (React StrictMode's double-effect in dev, or the user
    // rapidly switching transports): only the most recent call is allowed to (un)subscribe.
    const myGeneration = ++initGeneration;
    unsubPorts?.();
    unsubMessages?.();
    unsubPorts = null;
    unsubMessages = null;
    stopLiveSession?.();
    stopLiveSession = null;
    set((s) => ({
      connection: {
        ...s.connection,
        transportKind: kind,
        connected: false,
        autoConnected: false,
        initializing: true,
        error: null,
      },
    }));

    const transport = transportFor(kind);
    try {
      await transport.init();
      if (myGeneration !== initGeneration) return; // superseded by a newer initTransport call
      const outputs = transport.listOutputs();
      const nanocore = findNanocoreOutput(outputs);
      // The Simulator has no real device/port ambiguity and nothing to read on connect — treat
      // it as always-connected, same as before this file grew a real Connect step. For a real
      // transport, only auto-connect when a port is actually named "Nanocore" — on a machine
      // with more than one MIDI device (an audio interface, other gear), guessing the first
      // port is exactly the bug this Connect step exists to prevent. Anything else still
      // requires an explicit connectDevice().
      const connected = kind === 'simulator' || nanocore !== null;
      set((s) => ({
        connection: {
          ...s.connection,
          ready: true,
          initializing: false,
          outputs,
          outputId: nanocore?.id ?? outputs[0]?.id ?? null,
          connected,
          autoConnected: kind !== 'simulator' && nanocore !== null,
        },
      }));
      unsubPorts = transport.onPortsChanged(() => {
        set((s) => ({ connection: { ...s.connection, outputs: transport.listOutputs() } }));
      });
      unsubMessages = transport.onMessageSent((msg) => {
        set((s) => ({ log: [msg, ...s.log].slice(0, MAX_LOG_LENGTH) }));
      });
      const autoOutputId = nanocore?.id ?? outputs[0]?.id ?? null;
      if (connected && kind !== 'simulator' && autoOutputId) {
        startLive(get, set, transport, autoOutputId);
        void get().readPresetFromDevice();
      }
    } catch (err) {
      if (myGeneration !== initGeneration) return;
      set((s) => ({
        connection: { ...s.connection, ready: false, initializing: false, error: friendlyTransportError(err) },
      }));
    }
  },

  refreshOutputs: () => {
    const transport = transportFor(get().connection.transportKind);
    set((s) => ({ connection: { ...s.connection, outputs: transport.listOutputs() } }));
  },

  setOutput: (id) => {
    // Picking a *different* device always requires a fresh, explicit Connect — never silently
    // carry over "connected" from whatever was selected before.
    stopLiveSession?.();
    stopLiveSession = null;
    set((s) => ({
      connection: {
        ...s.connection,
        outputId: id,
        connected: s.connection.transportKind === 'simulator',
        autoConnected: false,
      },
    }));
  },
  setChannel: (ch) => set((s) => ({ connection: { ...s.connection, channel: Math.min(16, Math.max(1, ch)) } })),
  clearLog: () => set({ log: [] }),

  connectDevice: () => {
    const state = get();
    if (!state.connection.outputId) return;
    set((s) => ({ connection: { ...s.connection, connected: true, autoConnected: false } }));
    if (state.connection.transportKind !== 'simulator') {
      const transport = transportFor(state.connection.transportKind);
      startLive(get, set, transport, state.connection.outputId);
      void get().readPresetFromDevice();
      void get().pollGlobalSettings();
    }
  },

  disconnectDevice: () => {
    stopLiveSession?.();
    stopLiveSession = null;
    set((s) => ({ connection: { ...s.connection, connected: false, autoConnected: false }, activeSlotName: null, profileCatalog: null, globalSettings: null }));
  },

  disconnectBluetooth: () => {
    stopLiveSession?.();
    stopLiveSession = null;
    bleMidiTransport.disconnect();
    if (get().connection.transportKind === 'bluetooth') {
      set((s) => ({
        connection: { ...s.connection, outputs: [], outputId: null, connected: false, autoConnected: false, ready: false },
        activeSlotName: null,
        profileCatalog: null,
        globalSettings: null,
      }));
    }
  },

  readPresetFromDevice: async () => {
    const state = get();
    const device = deviceFor(state);
    if (!device) return;
    // The device layer reads the LIVE state first (it carries the loaded slot — the reliable way to
    // know what to read; `state.activeSlot` only updates from the 0x01 push), then that slot's
    // SAVED state, and decodes both. See `NanoCoreDevice.readSnapshot` / `buildSnapshot`.
    const { slot, state: snapshot } = await device.readSnapshot(state.activeSlot);
    if (slot !== state.activeSlot) set({ activeSlot: slot });
    if (!snapshot) return; // no reply (Simulator, older firmware, or a dropped connection)
    if (snapshot.chainOrder) set({ chainOrder: snapshot.chainOrder });
    // Display-only (see `activeSlotName`). Keep any previously-decoded name on a failed re-decode.
    if (snapshot.name !== null) set({ activeSlotName: snapshot.name });
    // Merge into the *current* patch (not the one from when the read started), so edits made while
    // the read was in flight aren't lost for blocks the snapshot knows nothing about.
    set((s) => ({ patch: applySnapshotToPatch(s.patch, snapshot) }));
  },

  pollGlobalSettings: async () => {
    const globalSettings = await deviceFor(get())?.readGlobalSettings();
    if (globalSettings) set({ globalSettings });
  },

  setGlobalSetting: async (fieldId, value) => {
    const globalSettings = await deviceFor(get())?.setGlobalSetting(fieldId, value);
    if (globalSettings) set({ globalSettings });
  },

  setBlockOn: (blockId, on) => {
    findBlock(blockId); // throws for an unknown block id before any state changes
    set((s) => ({
      patch: { ...s.patch, [blockId]: { ...s.patch[blockId], on } },
      activePresetDirty: true,
    }));
    deviceFor(get())?.sendBlockOn(blockId, on);
  },

  setBlockType: (blockId, typeId) => {
    const block = findBlock(blockId);
    const type = findType(block, typeId);
    set((s) => {
      const prev = s.patch[blockId];
      return {
        patch: {
          ...s.patch,
          [blockId]: { ...prev, typeId, params: remapParamsForType(block, type, prev.params) },
        },
        activePresetDirty: true,
      };
    });
    deviceFor(get())?.sendBlockType(blockId, typeId);
  },

  setParam: (blockId, paramId, value) => {
    set((s) => ({
      patch: {
        ...s.patch,
        [blockId]: { ...s.patch[blockId], params: { ...s.patch[blockId].params, [paramId]: value } },
      },
      activePresetDirty: true,
    }));
    const state = get();
    deviceFor(state)?.sendParam(blockId, state.patch[blockId].typeId, paramId, value);
  },

  loadPatch: (patch) => set({ patch, activePresetDirty: true }),

  resetPatch: () =>
    set({
      patch: buildDefaultPatch(),
      chainOrder: nanocoreSpec.blocks.map((b) => b.id),
      activePresetId: null,
      activePresetDirty: false,
    }),

  moveBlockInChain: (blockId, direction) => {
    const order = get().chainOrder;
    const i = order.indexOf(blockId);
    const j = direction === 'left' ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= order.length) return; // already at an end, or unknown block

    const newOrder = [...order];
    [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
    applyChainOrder(get, set, newOrder);
  },

  setChainOrder: (newOrder) => {
    const current = get().chainOrder;
    if (newOrder.length !== current.length || !current.every((id) => newOrder.includes(id))) {
      return; // not a reordering of the same blocks — ignore rather than corrupt the chain
    }
    applyChainOrder(get, set, newOrder);
  },

  sendFullPatch: () => {
    const state = get();
    deviceFor(state)?.sendFullPatch(state.patch);
  },

  recallProgram: (program) => {
    deviceFor(get())?.recallProgram(program);
  },

  stepPreset: (direction) => {
    deviceFor(get())?.stepPreset(direction);
  },

  setTuner: (on) => {
    deviceFor(get())?.setTuner(on);
  },

  saveToDeviceSlot: async (slot) => {
    const device = deviceFor(get());
    return device ? device.saveToSlot(slot) : false;
  },

  renamePresetOnDevice: (name) => {
    const device = deviceFor(get());
    if (!device) return;
    set({ activeSlotName: device.renamePreset(name) });
  },

  sendTestCC: (cc, value, description) => {
    deviceFor(get())?.sendCC(cc, value, description);
  },

  readProfileCatalog: async () => {
    const device = deviceFor(get());
    if (!device) return false;
    const records = await device.readProfileCatalog();
    if (records.length === 0) return false;
    set({ profileCatalog: records });
    return true;
  },

  uploadProfile: async ({ slot, data, name }) => {
    const state = get();
    const device = deviceFor(state);
    if (!device || state.profileUpload.status === 'running') return false;
    set({ profileUpload: { status: 'running', phase: 'info', slot, sent: 0, total: data.length } });
    const result = await device.uploadProfile({
      slot,
      data,
      name,
      onProgress: (phase, sent, total) => set({ profileUpload: { status: 'running', phase, slot, sent, total } }),
    });
    if (!result.ok) {
      set({ profileUpload: { status: 'error', slot, sent: get().profileUpload.sent, total: data.length, failure: result } });
      return false;
    }
    set({ profileUpload: { status: 'done', slot, sent: data.length, total: data.length } });
    await get().readProfileCatalog();
    return true;
  },

  resetProfileUpload: () => set({ profileUpload: { status: 'idle', sent: 0, total: 0 } }),

  savePresetLocal: (name) => {
    const state = get();
    const entry: PresetEntry = {
      id: crypto.randomUUID(),
      name: name.trim() || 'Untitled preset',
      patch: state.patch,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const presets = [...state.presets, entry];
    savePresets(presets);
    set({ presets, activePresetId: entry.id, activePresetDirty: false });
  },

  renamePreset: (id, name) => {
    const presets = get().presets.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
    savePresets(presets);
    set({ presets });
  },

  updateActivePreset: () => {
    const state = get();
    if (!state.activePresetId) return;
    const presets = state.presets.map((p) =>
      p.id === state.activePresetId ? { ...p, patch: state.patch, updatedAt: Date.now() } : p,
    );
    savePresets(presets);
    set({ presets, activePresetDirty: false });
  },

  deletePreset: (id) => {
    const presets = get().presets.filter((p) => p.id !== id);
    savePresets(presets);
    set((s) => ({
      presets,
      activePresetId: s.activePresetId === id ? null : s.activePresetId,
    }));
  },

  applyPreset: (id) => {
    const preset = get().presets.find((p) => p.id === id);
    if (!preset) return;
    set({ patch: preset.patch, activePresetId: id, activePresetDirty: false });
  },

  exportPresets: () => JSON.stringify(get().presets, null, 2),

  importPresets: (json) => {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return { ok: false, error: 'Expected a JSON array of presets.' };
      // Re-key ids to avoid collisions with existing presets.
      const incoming: PresetEntry[] = parsed.map((p: PresetEntry) => ({
        ...p,
        id: crypto.randomUUID(),
      }));
      const presets = [...get().presets, ...incoming];
      savePresets(presets);
      set({ presets });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  exportCurrentPatch: () => JSON.stringify(get().patch, null, 2),

  importPatch: (json) => {
    try {
      const parsed = JSON.parse(json);
      const result = validatePatch(parsed);
      if (!result.ok) return result;
      set({ patch: result.patch, activePresetId: null, activePresetDirty: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
}));
