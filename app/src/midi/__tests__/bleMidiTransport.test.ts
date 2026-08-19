import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BleMidiTransport } from '../bleMidiTransport';
import { BLE_MIDI_CHARACTERISTIC_UUID, BLE_MIDI_SERVICE_UUID } from '../bleMidiPacket';

/**
 * Exercises BleMidiTransport against a mocked `navigator.bluetooth`, since real Bluetooth
 * pairing needs a user gesture and hardware that isn't available in an automated environment.
 * Pins down the GATT connect flow and the raw BLE-MIDI packet bytes written to the
 * characteristic — the send-side encoding is covered in more depth in bleMidiPacket.test.ts.
 */

function makeFakeCharacteristic(opts: { writeWithoutResponse?: boolean } = {}) {
  return {
    uuid: BLE_MIDI_CHARACTERISTIC_UUID,
    properties: {
      write: true,
      writeWithoutResponse: opts.writeWithoutResponse ?? true,
      notify: false,
      read: false,
    },
    writeValue: vi.fn().mockResolvedValue(undefined),
    writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFakeDevice(characteristic: ReturnType<typeof makeFakeCharacteristic>, id = 'ble-1', name = 'NanoCore') {
  const listeners: Record<string, (() => void)[]> = {};
  const device: any = {
    id,
    name,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    removeEventListener: vi.fn(),
    _fireDisconnect: () => listeners['gattserverdisconnected']?.forEach((cb) => cb()),
  };
  const server = {
    connected: true,
    connect: vi.fn().mockResolvedValue(undefined as unknown as void),
    disconnect: vi.fn(() => device._fireDisconnect()),
    getPrimaryService: vi.fn().mockResolvedValue({
      getCharacteristic: vi.fn().mockResolvedValue(characteristic),
    }),
  };
  server.connect.mockResolvedValue(server);
  device.gatt = server;
  return device;
}

describe('BleMidiTransport', () => {
  let originalBluetooth: typeof navigator.bluetooth;

  beforeEach(() => {
    originalBluetooth = navigator.bluetooth;
  });

  afterEach(() => {
    (navigator as any).bluetooth = originalBluetooth;
  });

  it('reports unsupported when navigator.bluetooth is absent', () => {
    (navigator as any).bluetooth = undefined;
    const t = new BleMidiTransport();
    expect(t.isSupported()).toBe(false);
  });

  it('rejects init() with a clear message when unsupported', async () => {
    (navigator as any).bluetooth = undefined;
    const t = new BleMidiTransport();
    await expect(t.init()).rejects.toThrow(/Web Bluetooth API is not available/);
  });

  it('requests a device filtered to the BLE-MIDI service and connects through GATT', async () => {
    const characteristic = makeFakeCharacteristic();
    const device = makeFakeDevice(characteristic);
    const requestDevice = vi.fn().mockResolvedValue(device);
    (navigator as any).bluetooth = { requestDevice, getAvailability: vi.fn() };

    const t = new BleMidiTransport();
    await t.init();

    expect(requestDevice).toHaveBeenCalledWith({ filters: [{ services: [BLE_MIDI_SERVICE_UUID] }] });
    expect(device.gatt.connect).toHaveBeenCalled();
    expect(device.gatt.getPrimaryService).toHaveBeenCalledWith(BLE_MIDI_SERVICE_UUID);
    expect(t.listOutputs()).toEqual([{ id: 'ble-1', name: 'NanoCore' }]);
  });

  it('does not re-prompt the picker if already connected', async () => {
    const characteristic = makeFakeCharacteristic();
    const device = makeFakeDevice(characteristic);
    const requestDevice = vi.fn().mockResolvedValue(device);
    (navigator as any).bluetooth = { requestDevice, getAvailability: vi.fn() };

    const t = new BleMidiTransport();
    await t.init();
    await t.init();

    expect(requestDevice).toHaveBeenCalledTimes(1);
  });

  it('writes BLE-MIDI-encoded CC packets via writeValueWithoutResponse when supported', async () => {
    const characteristic = makeFakeCharacteristic({ writeWithoutResponse: true });
    const device = makeFakeDevice(characteristic);
    (navigator as any).bluetooth = { requestDevice: vi.fn().mockResolvedValue(device), getAvailability: vi.fn() };

    const t = new BleMidiTransport();
    await t.init();
    t.sendCC('ble-1', 1, 20, 127);

    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    const packet = characteristic.writeValueWithoutResponse.mock.calls[0][0] as Uint8Array;
    // header, timestamp, status(0xB0 ch1), cc, value — same CC20=127 "FX1 ON" example as the
    // plain Web MIDI test, just BLE-MIDI framed.
    expect(Array.from(packet.slice(2))).toEqual([0xb0, 20, 127]);
    expect(characteristic.writeValue).not.toHaveBeenCalled();
  });

  it('falls back to writeValue when writeWithoutResponse is unsupported', async () => {
    const characteristic = makeFakeCharacteristic({ writeWithoutResponse: false });
    const device = makeFakeDevice(characteristic);
    (navigator as any).bluetooth = { requestDevice: vi.fn().mockResolvedValue(device), getAvailability: vi.fn() };

    const t = new BleMidiTransport();
    await t.init();
    t.sendProgramChange('ble-1', 1, 12);

    expect(characteristic.writeValue).toHaveBeenCalledTimes(1);
    const packet = characteristic.writeValue.mock.calls[0][0] as Uint8Array;
    expect(Array.from(packet.slice(2))).toEqual([0xc0, 12]);
  });

  it('silently no-ops sending to an unknown output id instead of throwing', async () => {
    const characteristic = makeFakeCharacteristic();
    const device = makeFakeDevice(characteristic);
    (navigator as any).bluetooth = { requestDevice: vi.fn().mockResolvedValue(device), getAvailability: vi.fn() };

    const t = new BleMidiTransport();
    await t.init();

    expect(() => t.sendCC('does-not-exist', 1, 1, 1)).not.toThrow();
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled();
  });

  it('clears the output list when the GATT link disconnects', async () => {
    const characteristic = makeFakeCharacteristic();
    const device = makeFakeDevice(characteristic);
    (navigator as any).bluetooth = { requestDevice: vi.fn().mockResolvedValue(device), getAvailability: vi.fn() };

    const t = new BleMidiTransport();
    await t.init();
    expect(t.listOutputs()).toHaveLength(1);

    const onChange = vi.fn();
    t.onPortsChanged(onChange);
    device._fireDisconnect();

    expect(t.listOutputs()).toHaveLength(0);
    expect(onChange).toHaveBeenCalled();
  });

  it('disconnect() drops the GATT connection', async () => {
    const characteristic = makeFakeCharacteristic();
    const device = makeFakeDevice(characteristic);
    (navigator as any).bluetooth = { requestDevice: vi.fn().mockResolvedValue(device), getAvailability: vi.fn() };

    const t = new BleMidiTransport();
    await t.init();
    t.disconnect();

    expect(device.gatt.disconnect).toHaveBeenCalled();
    expect(t.listOutputs()).toHaveLength(0);
  });

  it('emits an OutgoingMessage (with description) to onMessageSent subscribers', async () => {
    const characteristic = makeFakeCharacteristic();
    const device = makeFakeDevice(characteristic);
    (navigator as any).bluetooth = { requestDevice: vi.fn().mockResolvedValue(device), getAvailability: vi.fn() };

    const t = new BleMidiTransport();
    await t.init();

    const received: any[] = [];
    t.onMessageSent((msg) => received.push(msg));
    t.sendCC('ble-1', 1, 60, 100, 'AMP: Gain');

    expect(received).toEqual([expect.objectContaining({ kind: 'cc', channel: 1, cc: 60, value: 100, description: 'AMP: Gain' })]);
  });
});
