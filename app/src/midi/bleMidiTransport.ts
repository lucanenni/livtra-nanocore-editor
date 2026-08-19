import type { MessageListener, MidiPortInfo, MidiTransport, OutgoingMessage } from './types';
import { BLE_MIDI_CHARACTERISTIC_UUID, BLE_MIDI_SERVICE_UUID, encodeBleMidiPacket } from './bleMidiPacket';

const CC_STATUS = 0xb0;
const PC_STATUS = 0xc0;

/**
 * Connects directly to a NanoCore's Bluetooth MIDI service from the page, via the Web
 * Bluetooth API — an alternative to pairing it at the OS level first (System Bluetooth /
 * Audio MIDI Setup on macOS) and then picking it up through WebMidiTransport. Chromium-only,
 * same as Web MIDI, and requires a secure context (HTTPS or localhost).
 *
 * `init()` must be called directly from a user-gesture handler (e.g. a button's onClick) —
 * Web Bluetooth's device picker only opens with active user activation on the call stack.
 */
export class BleMidiTransport implements MidiTransport {
  readonly kind = 'bluetooth' as const;
  readonly label = 'Bluetooth (Web Bluetooth)';

  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private listeners = new Set<MessageListener>();
  private portListeners = new Set<() => void>();
  private handleGattDisconnect = () => {
    this.characteristic = null;
    this.portListeners.forEach((cb) => cb());
  };

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async init(): Promise<void> {
    if (!this.isSupported()) {
      throw new Error(
        'Web Bluetooth API is not available in this browser. Use Chrome, Edge, or Opera over HTTPS (or localhost).',
      );
    }
    // Already connected (e.g. re-selecting this transport) — nothing to do.
    if (this.device?.gatt?.connected && this.characteristic) return;

    const device = await navigator.bluetooth!.requestDevice({
      filters: [{ services: [BLE_MIDI_SERVICE_UUID] }],
    });
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC_UUID);

    this.device?.removeEventListener('gattserverdisconnected', this.handleGattDisconnect);
    this.device = device;
    this.characteristic = characteristic;
    device.addEventListener('gattserverdisconnected', this.handleGattDisconnect);
  }

  /** Drops the GATT connection (does not forget the browser's pairing permission). */
  disconnect(): void {
    this.device?.gatt?.disconnect();
  }

  listOutputs(): MidiPortInfo[] {
    if (!this.device || !this.characteristic) return [];
    return [{ id: this.device.id, name: this.device.name || 'Bluetooth MIDI device' }];
  }

  onPortsChanged(cb: () => void): () => void {
    this.portListeners.add(cb);
    return () => this.portListeners.delete(cb);
  }

  private write(packet: Uint8Array) {
    const c = this.characteristic;
    if (!c) return;
    const send = c.properties.writeWithoutResponse
      ? c.writeValueWithoutResponse(packet)
      : c.writeValue(packet);
    send.catch(() => {
      // A dropped write (e.g. the link just died) will also fire gattserverdisconnected,
      // which already updates connection state — nothing extra to do here.
    });
  }

  private emit(msg: OutgoingMessage) {
    this.listeners.forEach((cb) => cb(msg));
  }

  sendCC(outputId: string, channel: number, cc: number, value: number, description?: string): void {
    if (!this.device || outputId !== this.device.id) return;
    const status = CC_STATUS | ((channel - 1) & 0x0f);
    this.write(encodeBleMidiPacket([status, cc & 0x7f, value & 0x7f]));
    this.emit({ kind: 'cc', channel, cc, value, timestamp: performance.now(), description });
  }

  sendProgramChange(outputId: string, channel: number, program: number, description?: string): void {
    if (!this.device || outputId !== this.device.id) return;
    const status = PC_STATUS | ((channel - 1) & 0x0f);
    this.write(encodeBleMidiPacket([status, program & 0x7f]));
    this.emit({ kind: 'pc', channel, program, timestamp: performance.now(), description });
  }

  onMessageSent(cb: MessageListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
