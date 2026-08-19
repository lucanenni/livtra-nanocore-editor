import type { MessageListener, MidiPortInfo, MidiTransport, OutgoingMessage } from './types';

const SIMULATED_OUTPUT: MidiPortInfo = { id: 'simulator', name: 'Simulated NanoCore (no hardware needed)' };

/**
 * A transport that doesn't touch any real MIDI hardware. It exists so the whole
 * editor — chain, parameter scaling, preset push — can be built and exercised
 * before a physical NanoCore is available. Every "sent" message is broadcast to
 * subscribers, which the Simulator panel uses to reconstruct device state
 * exactly the way the real firmware is documented to interpret it.
 */
export class SimulatorTransport implements MidiTransport {
  readonly kind = 'simulator' as const;
  readonly label = 'Simulator (no hardware needed)';

  private listeners = new Set<MessageListener>();

  isSupported(): boolean {
    return true;
  }

  async init(): Promise<void> {
    // Nothing to set up.
  }

  listOutputs(): MidiPortInfo[] {
    return [SIMULATED_OUTPUT];
  }

  onPortsChanged(): () => void {
    return () => {};
  }

  private emit(msg: OutgoingMessage) {
    this.listeners.forEach((cb) => cb(msg));
  }

  sendCC(_outputId: string, channel: number, cc: number, value: number, description?: string): void {
    this.emit({ kind: 'cc', channel, cc, value, timestamp: performance.now(), description });
  }

  sendProgramChange(_outputId: string, channel: number, program: number, description?: string): void {
    this.emit({ kind: 'pc', channel, program, timestamp: performance.now(), description });
  }

  onMessageSent(cb: MessageListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
