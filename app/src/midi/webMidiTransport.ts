import type { MessageListener, MidiPortInfo, MidiTransport, OutgoingMessage } from './types';

const CC_STATUS = 0xb0;
const PC_STATUS = 0xc0;

export class WebMidiTransport implements MidiTransport {
  readonly kind = 'webmidi' as const;
  readonly label = 'Web MIDI (hardware)';

  private access: MIDIAccess | null = null;
  private listeners = new Set<MessageListener>();
  private portListeners = new Set<() => void>();

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async init(): Promise<void> {
    if (!this.isSupported()) {
      throw new Error(
        'Web MIDI API is not available in this browser. Use Chrome, Edge, or Opera, or switch to the Simulator.',
      );
    }
    this.access = await navigator.requestMIDIAccess!({ sysex: false });
    this.access.onstatechange = () => this.portListeners.forEach((cb) => cb());
  }

  listOutputs(): MidiPortInfo[] {
    if (!this.access) return [];
    const outputs: MidiPortInfo[] = [];
    this.access.outputs.forEach((port) => {
      outputs.push({ id: port.id, name: port.name || port.id });
    });
    return outputs;
  }

  onPortsChanged(cb: () => void): () => void {
    this.portListeners.add(cb);
    return () => this.portListeners.delete(cb);
  }

  private getOutput(outputId: string): MIDIOutput | null {
    if (!this.access) return null;
    let found: MIDIOutput | null = null;
    this.access.outputs.forEach((port) => {
      if (port.id === outputId) found = port;
    });
    return found;
  }

  private emit(msg: OutgoingMessage) {
    this.listeners.forEach((cb) => cb(msg));
  }

  sendCC(outputId: string, channel: number, cc: number, value: number, description?: string): void {
    const port = this.getOutput(outputId);
    const status = CC_STATUS | ((channel - 1) & 0x0f);
    port?.send([status, cc & 0x7f, value & 0x7f]);
    this.emit({ kind: 'cc', channel, cc, value, timestamp: performance.now(), description });
  }

  sendProgramChange(outputId: string, channel: number, program: number, description?: string): void {
    const port = this.getOutput(outputId);
    const status = PC_STATUS | ((channel - 1) & 0x0f);
    port?.send([status, program & 0x7f]);
    this.emit({ kind: 'pc', channel, program, timestamp: performance.now(), description });
  }

  onMessageSent(cb: MessageListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
