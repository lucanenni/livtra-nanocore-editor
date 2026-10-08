import type { MidiTransport, OutgoingMessage } from '../midi/types';

/** A transport with no MIDI behind it: records what is sent, lets a test play device replies. */
export class FakeTransport implements MidiTransport {
  readonly kind = 'simulator' as const;
  readonly label = 'fake';
  sent: OutgoingMessage[] = [];
  private listeners = new Set<(bytes: number[]) => void>();
  /** Called for every SysEx the host sends; return frames to deliver back. */
  onSysEx: (bytes: number[]) => number[][] = () => [];

  init = async () => {};
  isSupported = () => true;
  listOutputs = () => [{ id: 'nc', name: 'Nanocore' }];
  onPortsChanged = () => () => {};
  onMessageSent = () => () => {};
  sendCC(_o: string, channel: number, cc: number, value: number, description?: string) {
    this.sent.push({ kind: 'cc', channel, cc, value, timestamp: 0, description });
  }
  sendProgramChange(_o: string, channel: number, program: number, description?: string) {
    this.sent.push({ kind: 'pc', channel, program, timestamp: 0, description });
  }
  sendSysEx(_o: string, bytes: number[], description?: string) {
    this.sent.push({ kind: 'sysex', bytes, timestamp: 0, description });
    for (const reply of this.onSysEx(bytes)) setTimeout(() => this.push(reply), 0);
  }
  onSysExReceived(_o: string, cb: (bytes: number[]) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  push(bytes: number[]) {
    this.listeners.forEach((l) => l(bytes));
  }
  get listenerCount() {
    return this.listeners.size;
  }
}
