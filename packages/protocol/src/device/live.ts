import type { MidiTransport } from '../midi/types';
import { buildPingSysEx, parseActiveSlotChangedPush } from '../midi/sysex';
import {
  parseBlockOnOffChangedPush,
  parseGlobalSettingsPush,
  parseParamValueChangedPush,
} from '../midi/presetReader';
import type { GlobalSettings } from '../midi/presetReader';
import { normalizedToReal } from '../midi/scaling';
import { findBlock, findParamSpecBySysexIndex, findType } from '../patch/patchDefaults';

/** ToneCommand's own "are you there" heartbeat cadence. */
export const PING_INTERVAL_MS = 3000;
/** How long a slot-0/1 "slot changed" push is held to see whether it's the Wireless artifact. */
export const AMBIGUOUS_SLOT_CHANGE_HOLD_MS = 150;

export type ParamPush = NonNullable<ReturnType<typeof parseParamValueChangedPush>>;

export interface LiveHandlers {
  /** A different preset slot became active on the device (recalled on the device itself). */
  onSlotChanged?: (slot: number) => void;
  /** A block was switched on/off on the device (footswitch/panel). */
  onBlockOn?: (change: { blockId: string; on: boolean }) => void;
  /** A global/device setting changed on the device's own Settings screen. */
  onGlobalSettings?: (settings: GlobalSettings) => void;
  /** A physical knob was turned. Use `resolveParamPush` to map it onto a parameter. */
  onParamChanged?: (change: ParamPush) => void;
}

/** Starts listening to the device's *unsolicited* pushes (block on/off, active slot, global
 * setting, knob turns) and keeps the connection "active" with the `0x68` heartbeat — a
 * from-scratch connection gets NO unsolicited traffic until it pings (confirmed 2026-09-13).
 * Returns a function that stops both. See docs/MIDI_MAPPING_NOTES.md for the opcodes.
 *
 * WIRELESS/SLOT AMBIGUITY, CONFIRMED AND HANDLED (2026-09-12, `Global.mmon` + a live re-test):
 * toggling Wireless fires its own small push shaped `<0x01> 0x00 <0-or-1>` — identical in
 * opcode/length/shape to the "active slot changed" push `<0x01> 0x00 <slot>`, and a real slot
 * number can itself be 0 or 1. EVERY Wireless toggle is followed within ~10ms by a global-settings
 * push carrying the SAME wireless value; a real slot-0/1 recall produces no settings push at all.
 * So a slot-changed push whose value is 0 or 1 is held for `AMBIGUOUS_SLOT_CHANGE_HOLD_MS`; if a
 * matching-value settings push arrives in that window it is discarded as the Wireless artifact. */
export function startLiveSession(transport: MidiTransport, outputId: string, handlers: LiveHandlers): () => void {
  let pending: { slot: number; timer: ReturnType<typeof setTimeout> } | null = null;

  const unsubscribe = transport.onSysExReceived(outputId, (bytes) => {
    const slot = parseActiveSlotChangedPush(bytes);
    if (slot !== null) {
      if (slot === 0 || slot === 1) {
        if (pending) clearTimeout(pending.timer);
        pending = {
          slot,
          timer: setTimeout(() => {
            pending = null;
            handlers.onSlotChanged?.(slot);
          }, AMBIGUOUS_SLOT_CHANGE_HOLD_MS),
        };
      } else {
        handlers.onSlotChanged?.(slot);
      }
      return;
    }
    const change = parseBlockOnOffChangedPush(bytes);
    if (change) {
      handlers.onBlockOn?.(change);
      return;
    }
    const globalSettings = parseGlobalSettingsPush(bytes);
    if (globalSettings) {
      handlers.onGlobalSettings?.(globalSettings);
      if (pending && (globalSettings.wireless ? 1 : 0) === pending.slot) {
        // The pending "slot changed" push was actually this Wireless toggle — discard it.
        clearTimeout(pending.timer);
        pending = null;
      }
      return;
    }
    // Opcode 0x06 (a physical knob turn). `paramIndex` is the param's real position in its type's
    // param list; the byte after it (`x`) doesn't decode and is ignored. See the `0x06` note in
    // docs/MIDI_MAPPING_NOTES.md.
    const paramChange = parseParamValueChangedPush(bytes);
    if (paramChange) handlers.onParamChanged?.(paramChange);
  });

  const ping = setInterval(() => transport.sendSysEx(outputId, buildPingSysEx(), 'Ping (keepalive)'), PING_INTERVAL_MS);

  return () => {
    unsubscribe();
    clearInterval(ping);
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };
}

/** Maps a knob-turn push onto the parameter it moved in a block of type `typeId`: the param's id
 * and its new value in real units. `null` for anything not a plain range param. */
export function resolveParamPush(typeId: number, change: ParamPush): { paramId: string; value: number } | null {
  const type = findType(findBlock(change.blockId), typeId);
  const spec = findParamSpecBySysexIndex(type, change.paramIndex);
  if (!spec || spec.kind !== 'range') return null;
  return { paramId: spec.id, value: normalizedToReal(spec.min, spec.max, change.value, spec.curve) };
}
