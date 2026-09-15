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
    // sysex: true is required to send SysEx (AMP/CAB model select, chain reorder — see
    // ../midi/sysex.ts) and triggers Chrome's separate, more sensitive "full MIDI access"
    // permission prompt instead of the plain MIDI one.
    this.access = await navigator.requestMIDIAccess!({ sysex: true });
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

  /** Web MIDI exposes inputs/outputs as separate ports with different ids even for the same
   * physical device — match by name (the NanoCore's input/output pair share one) to find the
   * sibling input to listen on for `onSysExReceived`. */
  private getMatchingInput(outputId: string): MIDIInput | null {
    if (!this.access) return null;
    const output = this.getOutput(outputId);
    if (!output) return null;
    let found: MIDIInput | null = null;
    this.access.inputs.forEach((port) => {
      if (port.name === output.name) found = port;
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

  sendSysEx(outputId: string, bytes: number[], description?: string): void {
    const port = this.getOutput(outputId);
    port?.send(bytes);
    this.emit({ kind: 'sysex', bytes, timestamp: performance.now(), description });
  }

  onMessageSent(cb: MessageListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onSysExReceived(outputId: string, cb: (bytes: number[]) => void): () => void {
    const input = this.getMatchingInput(outputId);
    if (!input) return () => {};
    // `addEventListener` (rather than the single-slot `onmidimessage`) so multiple concurrent
    // subscribers don't clobber each other.
    const handler = (ev: Event) => {
      // Newer DOM lib types `MIDIMessageEvent.data` as `Uint8Array | null`.
      const data = (ev as MIDIMessageEvent).data;
      if (data && data[0] === 0xf0) cb(Array.from(data));
    };
    input.addEventListener('midimessage', handler);
    return () => input.removeEventListener('midimessage', handler);
  }
}
