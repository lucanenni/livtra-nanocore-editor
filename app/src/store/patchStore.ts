import { create } from 'zustand';
import { nanocoreSpec } from '../data/nanocoreSpec';
import { BleMidiTransport, SimulatorTransport, WebMidiTransport } from '../midi';
import type { MidiPortInfo, MidiTransport, OutgoingMessage } from '../midi/types';
import { enumIndexToCC, normalizedToReal, onOffToCC, realToCC, realToNormalized } from '../midi/scaling';
import {
  ACTIVE_PRESET_SLOT,
  CHAIN_ORDER_BLOCK_IDS,
  buildAmpProfileReadSysEx,
  buildBlockTypeSysEx,
  buildChainOrderPrimeSysEx,
  buildChainOrderSysEx,
  buildGlobalSettingSysEx,
  buildGlobalSettingsPollSysEx,
  buildPingSysEx,
  buildReadPresetSysEx,
  buildRenamePresetSysEx,
  buildSavePresetSysEx,
  buildSetParamValueSysEx,
  isAmpProfileResponse,
  isGlobalSettingsResponse,
  isReadPresetResponse,
  isSavePresetResponse,
  parseActiveSlotChangedPush,
} from '../midi/sysex';
import {
  decodeLiveBlockParams,
  decodePresetParamValues,
  parseActiveSlotFromAmpProfile,
  parseBlockOnOffChangedPush,
  parseChainOrderFromAmpProfile,
  parseChainOrderFromPreset,
  parseGlobalSettingsPush,
  parseGlobalSettingsResponse,
  parseParamValueChangedPush,
  parsePresetName,
  parseReadPresetResponse,
} from '../midi/presetReader';
import type { GlobalSettings } from '../midi/presetReader';
import {
  activeParams,
  buildBlockDefault,
  buildDefaultPatch,
  findBlock,
  findParamSpec,
  findParamSpecBySysexIndex,
  findType,
  remapParamsForType,
  validatePatch,
} from './patchDefaults';
import { loadPresets, savePresets } from './localPresetStorage';
import type { BlockPatchState, PatchState, PresetEntry } from './patchTypes';

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
/** The persistent (not one-shot) subscription started by `startLivePushListener` — active while
 * `connection.connected`, torn down by `stopLivePushListener`. Separate from `unsubMessages`
 * (which just logs outgoing sends) — this listens to the device's own unsolicited pushes. */
let unsubLivePush: (() => void) | null = null;
/** The periodic `0x68` heartbeat timer started by `startPingInterval`, stopped by
 * `stopPingInterval`. See `midi/sysex.ts`'s `buildPingSysEx` doc comment — this exists purely to
 * test whether replicating ToneCommand's ~3s "are you there" heartbeat is what makes the device
 * treat our connection as active enough to send its own unsolicited pushes. */
let pingIntervalId: ReturnType<typeof setInterval> | null = null;
const PING_INTERVAL_MS = 3000;
/** Holds a slot-0-or-1 `isActiveSlotChangedPush` briefly so `startLivePushListener` can check
 * whether it's actually the ambiguous Wireless-toggle push in disguise — see that function's doc
 * comment. `null` when nothing is pending. */
let pendingAmbiguousSlotChange: { slot: number; timer: ReturnType<typeof setTimeout> } | null = null;
const AMBIGUOUS_SLOT_CHANGE_HOLD_MS = 150;
let initGeneration = 0;

/** How long to wait for each page of a read-preset response before giving up (e.g. an older
 * firmware that doesn't answer opcode 0x41, or the Simulator, which never replies at all). */
const READ_PRESET_TIMEOUT_MS = 3000;

/** Shared by `moveBlockInChain` and `setChainOrder`: updates local state and sends the resulting
 * order via SysEx (fieldId 0x05 — see midi/sysex.ts). */
function applyChainOrder(get: () => PatchStore, set: (partial: Partial<PatchStore>) => void, newOrder: string[]): void {
  set({ chainOrder: newOrder });
  const state = get();
  const outputId = currentOutputId(state);
  if (!outputId) return;
  const transport = transportFor(state.connection.transportKind);
  const ids = newOrder.map((id) => CHAIN_ORDER_BLOCK_IDS[id]);
  // ToneCommand always sends this fieldId-0x00 "prime" message right before its own chain-order
  // set — see buildChainOrderPrimeSysEx's doc comment. Our own sends never included it and showed
  // a reproducible discrepancy from ToneCommand's (screen-confirmed working) behavior.
  transport.sendSysEx(outputId, buildChainOrderPrimeSysEx(), 'Chain order (prime)');
  transport.sendSysEx(outputId, buildChainOrderSysEx(ids), `Chain order -> ${newOrder.join(' > ')}`);
}

/** Sends one SysEx request and resolves with the first reply matching `isResponse`, or `null` on
 * timeout. Shared by `requestReadPresetPage` and `requestAmpProfile` — both are simple
 * request/one-matching-reply exchanges over `MidiTransport.onSysExReceived`'s stream, which also
 * carries unrelated device chatter (hence needing `isResponse` rather than taking the next
 * message unconditionally). */
function requestSysExResponse(
  transport: MidiTransport,
  outputId: string,
  request: number[],
  isResponse: (bytes: readonly number[]) => boolean,
  label: string,
): Promise<number[] | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: number[] | null) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(result);
    };
    const unsubscribe = transport.onSysExReceived(outputId, (bytes) => {
      if (isResponse(bytes)) finish(bytes);
    });
    const timer = setTimeout(() => finish(null), READ_PRESET_TIMEOUT_MS);
    transport.sendSysEx(outputId, request, label);
  });
}

/** See `midi/presetReader.ts` for why this needs two round-trips (one per page) and
 * `midi/sysex.ts`'s `buildReadPresetSysEx` doc comment for the one part of this exchange not
 * re-confirmed this session (the exact request bytes). `slot` is whatever `PatchStore.activeSlot`
 * currently tracks — see `ACTIVE_PRESET_SLOT`'s doc comment for why this can't be hardcoded. */
function requestReadPresetPage(transport: MidiTransport, outputId: string, slot: number, page: 1 | 2): Promise<number[] | null> {
  return requestSysExResponse(
    transport,
    outputId,
    buildReadPresetSysEx(page, slot),
    (bytes) => isReadPresetResponse(bytes, slot),
    `Read current patch (page ${page}, slot ${slot})`,
  );
}

/** Reads the active AMP's profile purely for its chain-order-shaped footer — see
 * `midi/presetReader.ts`'s `parseChainOrderFromAmpProfile` for the format and how confident we
 * are in it (one confirmed example, not independently re-verified). */
function requestAmpProfile(transport: MidiTransport, outputId: string): Promise<number[] | null> {
  return requestSysExResponse(transport, outputId, buildAmpProfileReadSysEx(), isAmpProfileResponse, 'Read AMP profile (chain order)');
}

/** Starts listening for the device's *unsolicited* "block on/off changed", "active preset slot
 * changed" and "global setting changed" pushes (see `midi/sysex.ts`'s
 * `isBlockOnOffChangedPush`/`isActiveSlotChangedPush`/`isGlobalSettingsPush`) — this is how the
 * device announces changes made directly on it (footswitch/panel/its own Settings screen),
 * independent of (and much faster than) the saved-state-only opcode-`0x41` read. An earlier
 * same-day capture with a stale/dead capture port wrongly suggested the device never pushes
 * anything unprompted; `Polling_2.mmon` showed otherwise — see the nanocore-patch-change-detection
 * memory. Idempotent (replaces any previous subscription) and a no-op for the Simulator (nothing
 * to listen to). Call `stopLivePushListener` on disconnect.
 *
 * CONFIRMED 2026-09-12 (previously an open question — see the removed caveat this replaced):
 * these pushes DO arrive on a from-scratch connection, no ToneCommand needed, as long as
 * something keeps pinging (this store's own `startPingInterval` already does, unconditionally,
 * once connected) — verified with a plain from-scratch `python-rtmidi` listener sending nothing
 * of its own, which still saw pushes the moment a physical control changed, apparently
 * piggy-backing on whatever else was pinging the shared port at the time.
 *
 * WIRELESS/SLOT AMBIGUITY, CONFIRMED AND HANDLED (2026-09-12, `Global.mmon` + a live re-test):
 * toggling Wireless fires its own small unsolicited push shaped `<0x01> 0x00 <0-or-1>` —
 * identical opcode/length/shape to `isActiveSlotChangedPush`'s `<0x01> 0x00 <slot>`, and a real
 * slot number can itself be 0 or 1. Confirmed by direct hardware re-test: EVERY Wireless toggle
 * produces this push immediately followed (within ~10ms) by an `isGlobalSettingsPush` carrying
 * the SAME wireless value; a real slot-0/1 recall (also directly tested) produces no accompanying
 * settings push at all. So: a slot-changed push whose value is 0 or 1 is held for
 * `AMBIGUOUS_SLOT_CHANGE_HOLD_MS` rather than acted on immediately; if a matching-value settings
 * push arrives in that window, it's discarded as the Wireless artifact instead of triggering a
 * spurious `readPresetFromDevice()`. */
function startLivePushListener(
  get: () => PatchStore,
  set: (partial: Partial<PatchStore>) => void,
  transport: MidiTransport,
  outputId: string,
): void {
  unsubLivePush?.();
  const commitSlotChange = (slot: number) => {
    set({ activeSlot: slot });
    // A different slot is now active (the user recalled another preset on the device) — the
    // whole patch needs re-reading, not just this one field.
    void get().readPresetFromDevice();
  };
  unsubLivePush = transport.onSysExReceived(outputId, (bytes) => {
    const slot = parseActiveSlotChangedPush(bytes);
    if (slot !== null) {
      if (slot === 0 || slot === 1) {
        // Ambiguous with the Wireless push (see doc comment above) — hold briefly rather than
        // acting immediately, in case a same-value global-settings push shows up right after.
        if (pendingAmbiguousSlotChange) clearTimeout(pendingAmbiguousSlotChange.timer);
        pendingAmbiguousSlotChange = {
          slot,
          timer: setTimeout(() => {
            pendingAmbiguousSlotChange = null;
            commitSlotChange(slot);
          }, AMBIGUOUS_SLOT_CHANGE_HOLD_MS),
        };
      } else {
        commitSlotChange(slot);
      }
      return;
    }
    const change = parseBlockOnOffChangedPush(bytes);
    if (change) {
      const prev = get().patch[change.blockId];
      if (prev) set({ patch: { ...get().patch, [change.blockId]: { ...prev, on: change.on } } });
      return;
    }
    const globalSettings = parseGlobalSettingsPush(bytes);
    if (globalSettings) {
      set({ globalSettings });
      if (pendingAmbiguousSlotChange && (globalSettings.wireless ? 1 : 0) === pendingAmbiguousSlotChange.slot) {
        // The pending "slot changed" push was actually this Wireless toggle — discard it.
        clearTimeout(pendingAmbiguousSlotChange.timer);
        pendingAmbiguousSlotChange = null;
      }
      return;
    }
    // Opcode 0x06 (a physical knob turn on the device). Confirmed 2026-09-13 via two isolated
    // FX1 Compressor sweeps (Threshold, Ratio): the byte previously dismissed as "a constant, so
    // useless" is in fact the correct paramIndex — it just happens to be constant *because* only
    // one param was being turned per sweep (0 for Threshold, 1 for Ratio, matching each one's
    // real position in fx1.ts's Compressor params array). `x` (the next byte) still doesn't
    // correlate with anything — same value pushed with different `x`, same `x` with different
    // values — so it's read but ignored, most likely an internal buffer/message-slot tag. See
    // docs/MIDI_MAPPING_NOTES.md's `0x06` note for the full writeup.
    const paramChange = parseParamValueChangedPush(bytes);
    if (paramChange) {
      const blockState = get().patch[paramChange.blockId];
      if (blockState) {
        const block = findBlock(paramChange.blockId);
        const type = findType(block, blockState.typeId);
        const spec = findParamSpecBySysexIndex(type, paramChange.paramIndex);
        if (spec && spec.kind === 'range') {
          const value = normalizedToReal(spec.min, spec.max, paramChange.value, spec.curve);
          set({
            patch: {
              ...get().patch,
              [paramChange.blockId]: {
                ...blockState,
                params: { ...blockState.params, [spec.id]: value },
              },
            },
          });
        }
      }
      return;
    }
  });
}

function stopLivePushListener(): void {
  unsubLivePush?.();
  unsubLivePush = null;
  if (pendingAmbiguousSlotChange) {
    clearTimeout(pendingAmbiguousSlotChange.timer);
    pendingAmbiguousSlotChange = null;
  }
}

/** Starts sending `buildPingSysEx()` every `PING_INTERVAL_MS`, matching ToneCommand's own
 * behavior for as long as it's connected. Idempotent (clears any previous timer first). See
 * `pingIntervalId`'s doc comment for why this exists. */
function startPingInterval(transport: MidiTransport, outputId: string): void {
  stopPingInterval();
  pingIntervalId = setInterval(() => {
    transport.sendSysEx(outputId, buildPingSysEx(), 'Ping (keepalive)');
  }, PING_INTERVAL_MS);
}

function stopPingInterval(): void {
  if (pingIntervalId !== null) clearInterval(pingIntervalId);
  pingIntervalId = null;
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
    stopLivePushListener();
    stopPingInterval();
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
        startLivePushListener(get, set, transport, autoOutputId);
        startPingInterval(transport, autoOutputId);
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
    stopLivePushListener();
    stopPingInterval();
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
      startLivePushListener(get, set, transport, state.connection.outputId);
      startPingInterval(transport, state.connection.outputId);
      void get().readPresetFromDevice();
      void get().pollGlobalSettings();
    }
  },

  disconnectDevice: () => {
    stopLivePushListener();
    stopPingInterval();
    set((s) => ({ connection: { ...s.connection, connected: false, autoConnected: false }, activeSlotName: null, globalSettings: null }));
  },

  disconnectBluetooth: () => {
    stopLivePushListener();
    stopPingInterval();
    bleMidiTransport.disconnect();
    if (get().connection.transportKind === 'bluetooth') {
      set((s) => ({
        connection: { ...s.connection, outputs: [], outputId: null, connected: false, autoConnected: false, ready: false },
        activeSlotName: null,
        globalSettings: null,
      }));
    }
  },

  readPresetFromDevice: async () => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);

    // Read the (live-state) 0x63 AMP profile FIRST — it carries the currently-loaded slot number,
    // which is the reliable way to know what to read: `state.activeSlot` only updates from the
    // 0x01 push, and if that's missed (recall done on the device panel, push not delivered) it
    // stays on the sentinel scratch slot and every 0x41-derived value ends up from the wrong
    // preset. Fall back to the tracked slot if the profile didn't come back or didn't parse.
    const ampProfile = await requestAmpProfile(transport, outputId);
    const slot = (ampProfile && parseActiveSlotFromAmpProfile(ampProfile)) ?? state.activeSlot;
    if (slot !== state.activeSlot) set({ activeSlot: slot });

    const page1 = await requestReadPresetPage(transport, outputId, slot, 1);
    if (!page1) return; // no reply (Simulator, older firmware, or a dropped connection)
    const page2 = await requestReadPresetPage(transport, outputId, slot, 2);
    if (!page2) return;

    // Effect-chain order: from the 0x41 param stream's header (byte-exact for all 40 factory
    // presets), falling back to the less-reliable 0x63 footer (which returns null for some real
    // presets, e.g. slot 25 "Dot8th"). An unrecognized shape from both just leaves it alone.
    const chainOrder =
      parseChainOrderFromPreset(page1) ?? (ampProfile ? parseChainOrderFromAmpProfile(ampProfile) : null);
    if (chainOrder) set({ chainOrder });

    const parsed = parseReadPresetResponse(page1, page2);
    // On/off, type/variant and normalized param values for ALL 8 blocks: prefer the LIVE state
    // from the already-fetched opcode-0x63 AMP profile (`decodeLiveBlockParams`, confirmed
    // 2026-09-13) over the SAVED state from this opcode-0x41 read (`decodePresetParamValues`).
    // The two can genuinely disagree — 0x41 only ever reflects what was last saved to this slot,
    // so live-editing without saving (as ordinary use of the device does all the time) used to
    // show up in the editor as the stale saved values until the next unsolicited push nudged one
    // field at a time. `parsed` (parseReadPresetResponse, below) is the last-resort fallback: its
    // AMP/CAB model indices (page-2 footer) and its ampOn/cabOn/eqOn fill in only when NEITHER
    // decoder above produced anything for a given block.
    const decodedParams = new Map(decodePresetParamValues(page1, page2).map((b) => [b.blockId, b]));
    if (ampProfile) {
      for (const live of decodeLiveBlockParams(ampProfile)) {
        // AMP/CAB are the one exception: confirmed 2026-09-13 that their live "model" byte never
        // moves no matter what model is actually set (direct SysEx model-select tests, on/off and
        // every param value DID track correctly in the same response) — this response apparently
        // just doesn't carry their model index at all, mirroring how 0x41's own tag structure
        // already excludes AMP/CAB and needs a separate footer instead. Keep whichever variant the
        // saved-state decode above already found (or the live one as a last resort if that's all
        // there is) rather than clobbering a correct saved model id with this decoder's meaningless
        // placeholder byte for these two blocks specifically.
        const variant =
          (live.blockId === 'amp' || live.blockId === 'cab') && decodedParams.has(live.blockId)
            ? decodedParams.get(live.blockId)!.variant
            : live.variant;
        decodedParams.set(live.blockId, { ...live, variant });
      }
    }

    // Display-only (see `activeSlotName`) — byte-exact against all 40 factory names, best-effort
    // for anything longer/non-ASCII. Keep any previously-decoded name on a failed re-decode.
    const presetName = parsePresetName(page1);
    if (presetName !== null) set({ activeSlotName: presetName });

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

    set((s) => {
      const patch = { ...s.patch };
      for (const [blockId, typeId, on] of updates) {
        const prev = patch[blockId];
        if (!prev) continue;
        let next = prev;
        if (typeId !== null) {
          try {
            const block = findBlock(blockId);
            const type = findType(block, typeId);
            const params = remapParamsForType(block, type, prev.params);
            // Un-normalize each decoded 0.0-1.0 value into its param's own real range and merge it
            // in, positionally against `activeParams` (common params then the selected type's own,
            // the device's own order). A decoded list shorter than the param list is normal for a
            // few FX2 types that pin and omit their last param — those keep their prior value.
            const decoded = decodedParams.get(blockId);
            if (decoded) {
              const specs = activeParams(block, typeId);
              decoded.values.forEach((normalized, i) => {
                const spec = specs[i];
                if (!spec) return;
                params[spec.id] =
                  spec.kind === 'range'
                    ? normalizedToReal(spec.min, spec.max, normalized, spec.curve)
                    : normalized;
              });
            }
            next = { ...next, typeId, params };
          } catch {
            // Unrecognized type-id (e.g. the REV -1 correction landing outside the known
            // range) — leave this block's patch state as it was rather than guess.
          }
        }
        if (on !== null) next = { ...next, on };
        patch[blockId] = next;
      }
      return { patch };
    });
  },

  pollGlobalSettings: async () => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    const response = await requestSysExResponse(
      transport,
      outputId,
      buildGlobalSettingsPollSysEx(),
      isGlobalSettingsResponse,
      'Read global settings',
    );
    const globalSettings = response && parseGlobalSettingsResponse(response);
    if (globalSettings) set({ globalSettings });
  },

  setGlobalSetting: async (fieldId, value) => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    const response = await requestSysExResponse(
      transport,
      outputId,
      buildGlobalSettingSysEx(fieldId, value),
      isGlobalSettingsResponse,
      `Set global setting ${fieldId} -> ${value}`,
    );
    const globalSettings = response && parseGlobalSettingsResponse(response);
    if (globalSettings) set({ globalSettings });
  },

  setBlockOn: (blockId, on) => {
    const block = findBlock(blockId);
    set((s) => ({
      patch: { ...s.patch, [blockId]: { ...s.patch[blockId], on } },
      activePresetDirty: true,
    }));
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    transport.sendCC(
      outputId,
      state.connection.channel,
      block.onOffCC,
      onOffToCC(on),
      `${block.name} ${on ? 'ON' : 'OFF'}`,
    );
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
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    if (block.sysexTypeField !== undefined) {
      // Confirmed on real hardware: typeCC has no effect for this block — SysEx is the only way.
      // See midi/sysex.ts and docs/MIDI_MAPPING_NOTES.md.
      transport.sendSysEx(
        outputId,
        buildBlockTypeSysEx(block.sysexTypeField, typeId),
        `${block.name} type -> ${type.name}`,
      );
    } else {
      transport.sendCC(outputId, state.connection.channel, block.typeCC, typeId, `${block.name} type -> ${type.name}`);
    }
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
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const block = findBlock(blockId);
    const blockState = state.patch[blockId];
    const spec = findParamSpec(block, blockState.typeId, paramId);
    const transport = transportFor(state.connection.transportKind);
    const displayValue = spec.kind === 'range' ? value.toFixed(spec.decimals ?? 0) : spec.options[value];
    const label = `${block.name} ${findType(block, blockState.typeId).name}: ${spec.label} = ${displayValue}${
      spec.kind === 'range' && spec.unit ? spec.unit : ''
    }`;
    if (spec.kind === 'range' && spec.sysexParamIndex !== undefined) {
      // No working CC for this one — see RangeParam.sysexParamIndex's doc comment.
      const normalized = realToNormalized(spec.min, spec.max, value, spec.curve);
      transport.sendSysEx(outputId, buildSetParamValueSysEx(CHAIN_ORDER_BLOCK_IDS[blockId], spec.sysexParamIndex, normalized), label);
      return;
    }
    const raw = spec.kind === 'range' ? realToCC(spec.min, spec.max, value, spec.curve) : enumIndexToCC(value, spec.options.length);
    // spec.cc is guaranteed here: the sysexParamIndex-without-cc case returned above, and every
    // other RangeParam (via paramHelpers.range) and every EnumParam always carries a real cc.
    transport.sendCC(outputId, state.connection.channel, spec.cc ?? 0, raw, label);
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
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    const { channel } = state.connection;

    for (const block of nanocoreSpec.blocks) {
      const blockState: BlockPatchState = state.patch[block.id] ?? buildBlockDefault(block);
      transport.sendCC(outputId, channel, block.onOffCC, onOffToCC(blockState.on), `${block.name} ${blockState.on ? 'ON' : 'OFF'}`);
      const typeName = findType(block, blockState.typeId).name;
      if (block.sysexTypeField !== undefined) {
        transport.sendSysEx(
          outputId,
          buildBlockTypeSysEx(block.sysexTypeField, blockState.typeId),
          `${block.name} type -> ${typeName}`,
        );
      } else {
        transport.sendCC(outputId, channel, block.typeCC, blockState.typeId, `${block.name} type -> ${typeName}`);
      }
      for (const spec of activeParams(block, blockState.typeId)) {
        const value = blockState.params[spec.id] ?? (spec.kind === 'range' ? spec.min : 0);
        if (spec.kind === 'range' && spec.sysexParamIndex !== undefined) {
          const normalized = realToNormalized(spec.min, spec.max, value, spec.curve);
          transport.sendSysEx(
            outputId,
            buildSetParamValueSysEx(CHAIN_ORDER_BLOCK_IDS[block.id], spec.sysexParamIndex, normalized),
            `${block.name}: ${spec.label}`,
          );
          continue;
        }
        const raw = spec.kind === 'range' ? realToCC(spec.min, spec.max, value, spec.curve) : enumIndexToCC(value, spec.options.length);
        transport.sendCC(outputId, channel, spec.cc ?? 0, raw, `${block.name}: ${spec.label}`);
      }
    }
  },

  recallProgram: (program) => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    transport.sendProgramChange(outputId, state.connection.channel, program, `Recall device preset ${program}`);
  },

  stepPreset: (direction) => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    const cc = direction === 'prev' ? 81 : 82;
    const label = direction === 'prev' ? 'Previous preset' : 'Next preset';
    transport.sendCC(outputId, state.connection.channel, cc, 127, label);
    // Momentary control: release shortly after, per MIDI guide ("64-127 triggers").
    window.setTimeout(() => transport.sendCC(outputId, state.connection.channel, cc, 0, `${label} (release)`), 80);
  },

  setTuner: (on) => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    transport.sendCC(outputId, state.connection.channel, 80, onOffToCC(on), `Tuner ${on ? 'ON' : 'OFF'}`);
  },

  saveToDeviceSlot: async (slot) => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return false;
    const transport = transportFor(state.connection.transportKind);
    const response = await requestSysExResponse(
      transport,
      outputId,
      buildSavePresetSysEx(slot),
      (bytes) => isSavePresetResponse(bytes, slot),
      `Save to slot ${slot}`,
    );
    return response !== null;
  },

  renamePresetOnDevice: (name) => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    const truncated = name.slice(0, 8);
    transport.sendSysEx(outputId, buildRenamePresetSysEx(truncated), `Rename patch -> "${truncated}"`);
    set({ activeSlotName: truncated });
  },

  sendTestCC: (cc, value, description) => {
    const state = get();
    const outputId = currentOutputId(state);
    if (!outputId) return;
    const transport = transportFor(state.connection.transportKind);
    transport.sendCC(outputId, state.connection.channel, cc, value, description ?? `Test CC${cc} = ${value}`);
  },

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
