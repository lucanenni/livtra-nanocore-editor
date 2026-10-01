import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebMidiTransport } from '../../midi';
import { parseActiveSlotFromAmpProfile } from '@nanocore/protocol';
import { usePatchStore } from '../patchStore';
import { LIVE_FX2_TYPE7, SLOT0_CLNARP_P1, SLOT0_CLNARP_P2 } from '@nanocore/protocol/testing/realCaptures';

/**
 * Characterization of `readPresetFromDevice` against a fake device that replays real captured
 * frames — pins down exactly what the store does with them, so the read logic can be moved out of
 * the store without changing behaviour.
 */
type Listener = (bytes: number[]) => void;

function installFakeDevice(opts: { liveProfile: boolean }) {
  const listeners = new Set<Listener>();
  let page = 0;
  const reply = (bytes: number[]) => setTimeout(() => listeners.forEach((l) => l(bytes)), 0);
  // With the live profile in play the slot to read comes from it (not the tracked one); re-tag the
  // saved-state pages with that slot so the device "has" this preset there. Only that one byte.
  const liveSlot = parseActiveSlotFromAmpProfile(LIVE_FX2_TYPE7) ?? 0;
  const forSlot = (frame: number[]) => (opts.liveProfile ? frame.map((b, i) => (i === 15 ? liveSlot : b)) : frame);
  vi.spyOn(WebMidiTransport.prototype, 'init').mockResolvedValue();
  vi.spyOn(WebMidiTransport.prototype, 'listOutputs').mockReturnValue([{ id: 'nc', name: 'Nanocore' }]);
  vi.spyOn(WebMidiTransport.prototype, 'onPortsChanged').mockReturnValue(() => {});
  vi.spyOn(WebMidiTransport.prototype, 'onMessageSent').mockReturnValue(() => {});
  vi.spyOn(WebMidiTransport.prototype, 'sendCC').mockImplementation(() => {});
  vi.spyOn(WebMidiTransport.prototype, 'sendProgramChange').mockImplementation(() => {});
  vi.spyOn(WebMidiTransport.prototype, 'onSysExReceived').mockImplementation((_id, cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  });
  vi.spyOn(WebMidiTransport.prototype, 'sendSysEx').mockImplementation((_id, bytes) => {
    const opcode = bytes[9];
    if (opcode === 0x63 && opts.liveProfile) reply(LIVE_FX2_TYPE7);
    else if (opcode === 0x41) reply(forSlot(++page % 2 === 1 ? SLOT0_CLNARP_P1 : SLOT0_CLNARP_P2));
  });
}

afterEach(() => {
  usePatchStore.getState().disconnectDevice();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('readPresetFromDevice (characterization, real captured frames)', () => {
  beforeEach(() => {
    usePatchStore.getState().resetPatch();
    usePatchStore.setState({ activeSlot: 0, activeSlotName: null });
  });

  for (const liveProfile of [false, true]) {
    it(`decodes a saved preset${liveProfile ? ' overlaid with the live 0x63 state' : ''}`, async () => {
      installFakeDevice({ liveProfile });
      await usePatchStore.getState().initTransport('webmidi');
      await vi.waitFor(() => expect(usePatchStore.getState().activeSlotName).not.toBeNull(), { timeout: 8000 });
      const { activeSlot, activeSlotName, chainOrder, patch } = usePatchStore.getState();
      expect({ activeSlot, activeSlotName, chainOrder, patch }).toMatchSnapshot();
    }, 15000);
  }
});
