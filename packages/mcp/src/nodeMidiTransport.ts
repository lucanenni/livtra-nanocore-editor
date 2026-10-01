import { Input, Output, verifyLibraryLoaded } from '@julusian/midi/lazy';
import type { MessageListener, MidiPortInfo, MidiTransport, OutgoingMessage } from '@nanocore/protocol';

/** Ports are identified by name: the OS gives a MIDI device one output and one input port that
 * normally share it (CoreMIDI: "Nanocore"), which is how the matching input is found. */
function findInputIndex(input: Input, outputName: string): number {
  const names = Array.from({ length: input.getPortCount() }, (_, i) => input.getPortName(i));
  const exact = names.indexOf(outputName);
  if (exact !== -1) return exact;
  const needle = outputName.toLowerCase();
  return names.findIndex((n) => n.toLowerCase().includes(needle) || needle.includes(n.toLowerCase()));
}

/** `MidiTransport` over a real MIDI port from Node (RtMidi via `@julusian/midi`) — the server-side
 * counterpart of the editor's Web MIDI transport. SysEx is enabled on the input (RtMidi drops it
 * by default). Ports open lazily on first use and stay open until `close()`. */
export class NodeMidiTransport implements MidiTransport {
  readonly kind = 'node' as const;
  readonly label = 'USB MIDI (Node)';

  private outputs = new Map<string, Output>();
  private inputs = new Map<string, { input: Input; listeners: Set<(bytes: number[]) => void> }>();
  private sentListeners = new Set<MessageListener>();

  async init(): Promise<void> {
    verifyLibraryLoaded();
  }

  isSupported(): boolean {
    try {
      verifyLibraryLoaded();
      return true;
    } catch {
      return false;
    }
  }

  listOutputs(): MidiPortInfo[] {
    return Output.getPortNames().map((name) => ({ id: name, name }));
  }

  onPortsChanged(): () => void {
    return () => {}; // ports are listed fresh on demand; there is no hot-plug event in RtMidi
  }

  private output(outputId: string): Output {
    let out = this.outputs.get(outputId);
    if (!out) {
      out = new Output();
      out.openPortByName(outputId);
      this.outputs.set(outputId, out);
    }
    return out;
  }

  private emit(msg: OutgoingMessage) {
    this.sentListeners.forEach((cb) => cb(msg));
  }

  sendCC(outputId: string, channel: number, cc: number, value: number, description?: string): void {
    this.output(outputId).send([0xb0 | ((channel - 1) & 0x0f), cc & 0x7f, value & 0x7f]);
    this.emit({ kind: 'cc', channel, cc, value, timestamp: Date.now(), description });
  }

  sendProgramChange(outputId: string, channel: number, program: number, description?: string): void {
    this.output(outputId).send([0xc0 | ((channel - 1) & 0x0f), program & 0x7f]);
    this.emit({ kind: 'pc', channel, program, timestamp: Date.now(), description });
  }

  sendSysEx(outputId: string, bytes: number[], description?: string): void {
    this.output(outputId).send(bytes);
    this.emit({ kind: 'sysex', bytes, timestamp: Date.now(), description });
  }

  onMessageSent(cb: MessageListener): () => void {
    this.sentListeners.add(cb);
    return () => this.sentListeners.delete(cb);
  }

  onSysExReceived(outputId: string, cb: (bytes: number[]) => void): () => void {
    let entry = this.inputs.get(outputId);
    if (!entry) {
      const input = new Input();
      const index = findInputIndex(input, outputId);
      if (index === -1) throw new Error(`No MIDI input port matching "${outputId}"`);
      input.ignoreTypes(false, true, true); // keep SysEx; drop clock and active sensing
      input.setBufferSize(8192);
      const listeners = new Set<(bytes: number[]) => void>();
      input.on('message', (_delta, message) => {
        if (message[0] === 0xf0) listeners.forEach((l) => l(message));
      });
      input.openPort(index);
      entry = { input, listeners };
      this.inputs.set(outputId, entry);
    }
    entry.listeners.add(cb);
    return () => entry.listeners.delete(cb);
  }

  /** Closes every open port. */
  close(): void {
    for (const out of this.outputs.values()) out.closePort();
    for (const { input } of this.inputs.values()) input.closePort();
    this.outputs.clear();
    this.inputs.clear();
  }
}
