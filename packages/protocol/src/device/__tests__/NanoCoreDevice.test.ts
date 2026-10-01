import { afterEach, describe, expect, it, vi } from 'vitest';
import { NanoCoreDevice } from '../NanoCoreDevice';
import { applySnapshotToPatch } from '../snapshot';
import { AMBIGUOUS_SLOT_CHANGE_HOLD_MS, PING_INTERVAL_MS, resolveParamPush } from '../live';
import { buildDefaultPatch } from '../../patch/patchDefaults';
import { parseActiveSlotFromAmpProfile } from '../../midi/presetReader';
import { FakeTransport } from '../../testing/FakeTransport';
import { segmentReply } from '../../testing/segmentReply';
import { LIVE_FX2_TYPE7, SLOT0_CLNARP_P1, SLOT0_CLNARP_P2, hex } from '../../testing/realCaptures';

afterEach(() => vi.useRealTimers());

describe('NanoCoreDevice sending', () => {
  it('sends on/off, a CC-typed block type and a CC param on the configured channel', () => {
    const t = new FakeTransport();
    const d = new NanoCoreDevice(t, 'nc', 3);
    d.sendBlockOn('fx1', true);
    d.sendBlockType('mod', 2);
    d.sendParam('fx1', 0, 'threshold', -20);
    expect(t.sent.every((m) => m.kind === 'cc' && m.channel === 3)).toBe(true);
    expect(t.sent[0].description).toBe('FX1 ON');
    expect(t.sent[0].value).toBe(127);
    expect(t.sent.length).toBeGreaterThanOrEqual(3);
  });

  it('sends the chain order as the prime message followed by the order itself', () => {
    const t = new FakeTransport();
    new NanoCoreDevice(t, 'nc').sendChainOrder(['eq', 'fx1', 'mod', 'fx2', 'amp', 'cab', 'del', 'rev']);
    expect(t.sent.map((m) => m.kind)).toEqual(['sysex', 'sysex']);
    expect(t.sent[0].description).toBe('Chain order (prime)');
    expect(t.sent[1].description).toBe('Chain order -> eq > fx1 > mod > fx2 > amp > cab > del > rev');
  });

  it('truncates a rename to the 8-character cap and reports what it sent', () => {
    const t = new FakeTransport();
    expect(new NanoCoreDevice(t, 'nc').renamePreset('A very long name')).toBe('A very l');
    expect(t.sent[0].description).toBe('Rename patch -> "A very l"');
  });

  it('sends a whole patch: every block gets an on/off and a type', () => {
    const t = new FakeTransport();
    new NanoCoreDevice(t, 'nc').sendFullPatch(buildDefaultPatch());
    const labels = t.sent.map((m) => m.description ?? '');
    for (const block of ['FX1', 'FX2', 'AMP', 'CAB', 'MOD', 'DEL', 'REV', 'EQ']) {
      expect(labels.some((l) => l.startsWith(`${block} `) && l.includes('type ->'))).toBe(true);
    }
  });
});

describe('NanoCoreDevice.readSnapshot (real captured frames)', () => {
  /** Plays the device: live profile for 0x63, the saved-state pages for 0x41 (in request order). */
  function fakeDevice(liveProfile: boolean) {
    const t = new FakeTransport();
    const liveSlot = parseActiveSlotFromAmpProfile(LIVE_FX2_TYPE7) ?? 0;
    // Re-tag the saved pages' slot byte so the device "has" this preset in the live profile's slot.
    const forSlot = (frame: number[]) => (liveProfile ? frame.map((b, i) => (i === 15 ? liveSlot : b)) : frame);
    let page = 0;
    t.onSysEx = (bytes) => {
      if (bytes[9] === 0x63 && liveProfile) return [LIVE_FX2_TYPE7];
      if (bytes[9] === 0x41) return [forSlot(++page % 2 === 1 ? SLOT0_CLNARP_P1 : SLOT0_CLNARP_P2)];
      return [];
    };
    return { t, liveSlot };
  }

  it('reads the saved preset when there is no live profile, falling back to the given slot', async () => {
    vi.useFakeTimers();
    const { t } = fakeDevice(false);
    const promise = new NanoCoreDevice(t, 'nc').readSnapshot(0);
    await vi.runAllTimersAsync();
    const snap = await promise;
    expect(snap.slot).toBe(0);
    expect(snap.state?.name).toBe('ClnArp');
    expect(snap.state?.chainOrder).toHaveLength(8);
    const patch = applySnapshotToPatch(buildDefaultPatch(), snap.state!);
    expect(Object.keys(patch)).toHaveLength(8);
  });

  it('takes the slot from the live profile and overlays its state', async () => {
    vi.useFakeTimers();
    const { t, liveSlot } = fakeDevice(true);
    const promise = new NanoCoreDevice(t, 'nc').readSnapshot(5);
    await vi.runAllTimersAsync();
    const snap = await promise;
    expect(snap.slot).toBe(liveSlot);
    expect(snap.state?.decodedParams.get('fx2')?.on).toBe(true); // live FX2 is on in this capture
  });

  it('reads the same patch when the device answers over Bluetooth, every reply split into segments', async () => {
    vi.useFakeTimers();
    const { t } = fakeDevice(true);
    const usbScript = t.onSysEx;
    t.onSysEx = (bytes) => usbScript(bytes).flatMap((reply) => segmentReply(reply));
    const promise = new NanoCoreDevice(t, 'nc').readSnapshot(5);
    await vi.runAllTimersAsync();
    const snap = await promise;
    expect(snap.state?.name).toBe('ClnArp');
    expect(snap.state?.decodedParams.get('fx2')?.on).toBe(true);

    // identical result to the same device over USB
    const usb = fakeDevice(true);
    const usbPromise = new NanoCoreDevice(usb.t, 'nc').readSnapshot(5);
    await vi.runAllTimersAsync();
    expect(snap).toEqual(await usbPromise);
  });

  it('resolves with state=null (only the slot) when the saved pages never answer', async () => {
    vi.useFakeTimers();
    const promise = new NanoCoreDevice(new FakeTransport(), 'nc').readSnapshot(7);
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ slot: 7, state: null });
  });
});

describe('startLive (device pushes)', () => {
  it('pings on the heartbeat cadence and stops cleanly', () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    const stop = new NanoCoreDevice(t, 'nc').startLive({});
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(t.sent.filter((m) => m.description === 'Ping (keepalive)')).toHaveLength(2);
    stop();
    expect(t.listenerCount).toBe(0);
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(t.sent.filter((m) => m.description === 'Ping (keepalive)')).toHaveLength(2);
  });

  it('forwards a block on/off push', () => {
    const t = new FakeTransport();
    const onBlockOn = vi.fn();
    const stop = new NanoCoreDevice(t, 'nc').startLive({ onBlockOn });
    t.push(hex('f0 7d 4e 43 72 00 02 61 00 02 00 05 01 f7')); // MOD on (real capture)
    expect(onBlockOn).toHaveBeenCalledWith({ blockId: 'mod', on: true });
    stop();
  });

  it('forwards a knob push and maps it onto the parameter it moved', () => {
    const t = new FakeTransport();
    const onParamChanged = vi.fn();
    const stop = new NanoCoreDevice(t, 'nc').startLive({ onParamChanged });
    t.push(hex('f0 7d 4e 43 72 00 02 62 00 06 00 05 00 04 66 66 66 3e f7')); // MOD param 0 (real capture)
    expect(onParamChanged).toHaveBeenCalledTimes(1);
    const change = onParamChanged.mock.calls[0][0];
    expect(change).toMatchObject({ blockId: 'mod', paramIndex: 0 });
    expect(resolveParamPush(0, change)).not.toBeNull();
    stop();
  });

  it('holds a slot-0/1 push and drops it when a same-value global-settings push follows (Wireless)', () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    const onSlotChanged = vi.fn();
    const onGlobalSettings = vi.fn();
    const stop = new NanoCoreDevice(t, 'nc').startLive({ onSlotChanged, onGlobalSettings });
    // A slot-changed-shaped push with value 0, then (within the hold window) a settings push whose
    // wireless flag is 0 (real capture) — the Wireless artifact, not a recall of slot 0.
    t.push(hex('f0 7d 4e 43 72 00 02 28 01 01 00 00 f7'));
    t.push(hex('f0 7d 4e 43 72 00 02 55 00 07 00 01 00 02 01 7b 64 64 00 f7'));
    vi.advanceTimersByTime(AMBIGUOUS_SLOT_CHANGE_HOLD_MS * 2);
    expect(onGlobalSettings).toHaveBeenCalledTimes(1);
    expect(onSlotChanged).not.toHaveBeenCalled();
    stop();
  });

  it('still delivers a slot-0/1 push after the hold window when no settings push follows', () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    const onSlotChanged = vi.fn();
    const stop = new NanoCoreDevice(t, 'nc').startLive({ onSlotChanged });
    t.push(hex('f0 7d 4e 43 72 00 02 28 01 01 00 01 f7'));
    expect(onSlotChanged).not.toHaveBeenCalled(); // held
    vi.advanceTimersByTime(AMBIGUOUS_SLOT_CHANGE_HOLD_MS + 1);
    expect(onSlotChanged).toHaveBeenCalledWith(1);
    t.push(hex('f0 7d 4e 43 72 00 02 28 01 01 00 29 f7')); // a non-ambiguous slot goes straight through
    expect(onSlotChanged).toHaveBeenLastCalledWith(41);
    stop();
  });
});
