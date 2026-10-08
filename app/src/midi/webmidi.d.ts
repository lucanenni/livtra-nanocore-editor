/**
 * Minimal ambient typings for the Web MIDI API — not part of the default
 * TypeScript DOM lib. Covers only what this project uses (output enumeration
 * and sending raw messages).
 */
interface MIDIOptions {
  sysex?: boolean;
  software?: boolean;
}

interface MIDIPort extends EventTarget {
  readonly id: string;
  readonly manufacturer?: string;
  readonly name?: string;
  readonly type: 'input' | 'output';
  readonly version?: string;
  readonly state: 'connected' | 'disconnected';
  readonly connection: 'open' | 'closed' | 'pending';
  onstatechange: ((this: MIDIPort, ev: Event) => unknown) | null;
  open(): Promise<MIDIPort>;
  close(): Promise<MIDIPort>;
}

interface MIDIOutput extends MIDIPort {
  send(data: number[] | Uint8Array, timestamp?: number): void;
  clear(): void;
}

interface MIDIInput extends MIDIPort {
  onmidimessage: ((this: MIDIInput, ev: MIDIMessageEvent) => unknown) | null;
}

interface MIDIMessageEvent extends Event {
  readonly data: Uint8Array;
}

interface MIDIInputMap {
  forEach(callback: (value: MIDIInput, key: string, map: MIDIInputMap) => void): void;
  values(): IterableIterator<MIDIInput>;
}

interface MIDIOutputMap {
  forEach(callback: (value: MIDIOutput, key: string, map: MIDIOutputMap) => void): void;
  values(): IterableIterator<MIDIOutput>;
}

interface MIDIAccess extends EventTarget {
  readonly inputs: MIDIInputMap;
  readonly outputs: MIDIOutputMap;
  readonly sysexEnabled: boolean;
  onstatechange: ((this: MIDIAccess, ev: Event) => unknown) | null;
}

interface Navigator {
  requestMIDIAccess?(options?: MIDIOptions): Promise<MIDIAccess>;
}
