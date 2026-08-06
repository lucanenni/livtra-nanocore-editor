import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebMidiTransport } from '../webMidiTransport';

/**
 * Exercises the real Web MIDI code path (not the Simulator) against a mocked
 * `navigator.requestMIDIAccess`, since actual browser MIDI permission can't be
 * granted in an automated/sandboxed environment. This pins down exactly what
 * SimulatorTransport-only testing couldn't: the raw byte encoding WebMidiTransport
 * sends over `MIDIOutput.send()` — status byte nibble packing, 7-bit masking, and
 * multi-output/port-change handling.
 */

function makeFakeOutput(id: string, name: string) {
  return {
    id,
    name,
    type: 'output' as const,
    state: 'connected' as const,
    connection: 'open' as const,
    send: vi.fn(),
    onstatechange: null,
    open: vi.fn(),
    close: vi.fn(),
  };
}

function makeFakeAccess(outputs: ReturnType<typeof makeFakeOutput>[]) {
  const outputMap = {
    forEach(cb: (port: any, key: string) => void) {
      for (const o of outputs) cb(o, o.id);
    },
    values() {
      return outputs[Symbol.iterator]();
    },
  };
  return {
    inputs: { forEach() {}, values() { return [][Symbol.iterator](); } },
    outputs: outputMap,
    sysexEnabled: false,
    onstatechange: null,
  };
}

describe('WebMidiTransport', () => {
  let originalRequestMIDIAccess: typeof navigator.requestMIDIAccess;

  beforeEach(() => {
    originalRequestMIDIAccess = navigator.requestMIDIAccess;
  });

  afterEach(() => {
    (navigator as any).requestMIDIAccess = originalRequestMIDIAccess;
  });

  it('reports unsupported when navigator.requestMIDIAccess is absent', () => {
    (navigator as any).requestMIDIAccess = undefined;
    const t = new WebMidiTransport();
    expect(t.isSupported()).toBe(false);
  });

  it('rejects init() with a clear message when unsupported', async () => {
    (navigator as any).requestMIDIAccess = undefined;
    const t = new WebMidiTransport();
    await expect(t.init()).rejects.toThrow(/Web MIDI API is not available/);
  });

  it('lists real ports returned by requestMIDIAccess after init', async () => {
    const fakeOut = makeFakeOutput('port-1', 'NanoCore Editor Test Monitor');
    (navigator as any).requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeAccess([fakeOut]));

    const t = new WebMidiTransport();
    await t.init();

    expect(t.listOutputs()).toEqual([{ id: 'port-1', name: 'NanoCore Editor Test Monitor' }]);
  });

  it('encodes CC messages with the correct status byte and 7-bit-masked data bytes', async () => {
    const fakeOut = makeFakeOutput('port-1', 'Test Port');
    (navigator as any).requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeAccess([fakeOut]));

    const t = new WebMidiTransport();
    await t.init();

    // Channel 1 (nibble 0) -> status 0xB0; CC20=127 (FX1 ON), matches the MIDI guide's example.
    t.sendCC('port-1', 1, 20, 127);
    expect(fakeOut.send).toHaveBeenLastCalledWith([0xb0, 20, 127]);

    // Channel 16 (nibble 0xF) -> status 0xBF.
    t.sendCC('port-1', 16, 50, 0);
    expect(fakeOut.send).toHaveBeenLastCalledWith([0xbf, 50, 0]);

    // Channel 10 -> nibble 9 -> status 0xB9.
    t.sendCC('port-1', 10, 90, 89);
    expect(fakeOut.send).toHaveBeenLastCalledWith([0xb9, 90, 89]);
  });

  it('masks out-of-range CC/value bytes to 7 bits rather than corrupting the status byte', async () => {
    const fakeOut = makeFakeOutput('port-1', 'Test Port');
    (navigator as any).requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeAccess([fakeOut]));
    const t = new WebMidiTransport();
    await t.init();

    t.sendCC('port-1', 1, 255, 255);
    expect(fakeOut.send).toHaveBeenLastCalledWith([0xb0, 255 & 0x7f, 255 & 0x7f]);
  });

  it('encodes Program Change with a 2-byte message and the correct status nibble', async () => {
    const fakeOut = makeFakeOutput('port-1', 'Test Port');
    (navigator as any).requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeAccess([fakeOut]));
    const t = new WebMidiTransport();
    await t.init();

    t.sendProgramChange('port-1', 1, 12);
    expect(fakeOut.send).toHaveBeenLastCalledWith([0xc0, 12]);
  });

  it('routes messages to the selected output only, not other connected ports', async () => {
    const outA = makeFakeOutput('a', 'Port A');
    const outB = makeFakeOutput('b', 'Port B');
    (navigator as any).requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeAccess([outA, outB]));
    const t = new WebMidiTransport();
    await t.init();

    t.sendCC('b', 1, 1, 1);
    expect(outA.send).not.toHaveBeenCalled();
    expect(outB.send).toHaveBeenCalledWith([0xb0, 1, 1]);
  });

  it('silently no-ops sending to an unknown output id instead of throwing', async () => {
    const fakeOut = makeFakeOutput('port-1', 'Test Port');
    (navigator as any).requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeAccess([fakeOut]));
    const t = new WebMidiTransport();
    await t.init();

    expect(() => t.sendCC('does-not-exist', 1, 1, 1)).not.toThrow();
    expect(fakeOut.send).not.toHaveBeenCalled();
  });

  it('emits an OutgoingMessage (with description) to onMessageSent subscribers for every send', async () => {
    const fakeOut = makeFakeOutput('port-1', 'Test Port');
    (navigator as any).requestMIDIAccess = vi.fn().mockResolvedValue(makeFakeAccess([fakeOut]));
    const t = new WebMidiTransport();
    await t.init();

    const received: any[] = [];
    const unsub = t.onMessageSent((msg) => received.push(msg));

    t.sendCC('port-1', 3, 60, 100, 'AMP: Gain');
    t.sendProgramChange('port-1', 3, 5, 'Recall preset 5');

    expect(received).toEqual([
      expect.objectContaining({ kind: 'cc', channel: 3, cc: 60, value: 100, description: 'AMP: Gain' }),
      expect.objectContaining({ kind: 'pc', channel: 3, program: 5, description: 'Recall preset 5' }),
    ]);

    unsub();
    t.sendCC('port-1', 1, 1, 1);
    expect(received).toHaveLength(2); // no further messages after unsubscribing
  });
});
