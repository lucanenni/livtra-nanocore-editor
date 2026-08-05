export interface MidiPortInfo {
  id: string;
  name: string;
}

/** A single outgoing message, kept around for the activity log / simulator mirror. */
export interface OutgoingMessage {
  kind: 'cc' | 'pc';
  channel: number; // 1-16
  cc?: number;
  program?: number;
  value?: number;
  timestamp: number;
  /** Human-readable summary filled in by the caller, e.g. "MOD Phaser: Mix = 50". */
  description?: string;
}

export type MessageListener = (msg: OutgoingMessage) => void;

export interface MidiTransport {
  readonly kind: 'webmidi' | 'simulator';
  readonly label: string;
  init(): Promise<void>;
  isSupported(): boolean;
  listOutputs(): MidiPortInfo[];
  onPortsChanged(cb: () => void): () => void;
  sendCC(outputId: string, channel: number, cc: number, value: number, description?: string): void;
  sendProgramChange(outputId: string, channel: number, program: number, description?: string): void;
  /** Subscribe to every message this transport sends (used to drive the on-screen simulator/log). */
  onMessageSent(cb: MessageListener): () => void;
}
