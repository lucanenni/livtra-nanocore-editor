import type { MessageListener, MidiPortInfo, MidiTransport } from './types';
import { pack7BitSafe, unpack7BitSafe } from './safePacking';

/** Status values of a segmented reply. Over USB a reply's status byte is `0` (OK) and the whole
 * payload comes in one SysEx message. Over Bluetooth LE (captured 2026-10-01) the device instead
 * splits the payload into segments of at most 64 data bytes, each its own SysEx message with the
 * same sequence number and opcode, and a status of `0x10` (more follow) or `0x11` (last). */
export const SEGMENT_MORE = 0x10;
export const SEGMENT_LAST = 0x11;

/** Each segment's payload starts with `u16 total length, u16 offset` (little-endian), then data. */
const SEGMENT_PREFIX_BYTES = 4;
const MAX_PENDING = 16;

const HEADER = [0xf0, 0x7d, 0x4e, 0x43, 0x71];

/** Builds a USB-shaped reply frame: `F0 7D 4E 43 71 <pack7(02 | seq u16 | opcode u16 | status |
 * len u16 | payload)> F7`. */
export function buildReplyFrame(seq: number, opcode: number, status: number, payload: readonly number[]): number[] {
  const body = [0x02, seq & 0xff, (seq >> 8) & 0xff, opcode & 0xff, (opcode >> 8) & 0xff, status, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload];
  return [...HEADER, ...pack7BitSafe(body), 0xf7];
}

interface Pending {
  total: number;
  parts: Map<number, number[]>;
}

/** Returns a stateful function that turns the device's incoming SysEx messages into the shape every
 * parser here expects. Messages that are not segmented replies pass through untouched; a segment is
 * swallowed (`null`) until the last one arrives, and then the whole reply is delivered as ONE
 * USB-shaped frame (status 0, full payload) — so nothing downstream needs to know which transport
 * the device is on. A reply whose segments don't add up is dropped rather than half-delivered. */
export function createReplyReassembler(): (bytes: readonly number[]) => number[] | null {
  const pending = new Map<string, Pending>();

  return (bytes) => {
    const passthrough = () => Array.from(bytes);
    if (bytes.length < 14 || bytes[bytes.length - 1] !== 0xf7 || !HEADER.every((b, i) => bytes[i] === b)) return passthrough();
    const un = unpack7BitSafe(bytes.slice(5, -1));
    if (un.length < 8 || un[0] !== 0x02) return passthrough();
    const status = un[5];
    if (status !== SEGMENT_MORE && status !== SEGMENT_LAST) return passthrough();

    const seq = un[1] | (un[2] << 8);
    const opcode = un[3] | (un[4] << 8);
    const len = un[6] | (un[7] << 8);
    const body = un.slice(8, 8 + len);
    if (body.length < SEGMENT_PREFIX_BYTES) return passthrough();
    const total = body[0] | (body[1] << 8);
    const offset = body[2] | (body[3] << 8);

    const key = `${seq}:${opcode}`;
    let entry = pending.get(key);
    if (!entry) {
      if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
      entry = { total, parts: new Map() };
      pending.set(key, entry);
    }
    entry.parts.set(offset, body.slice(SEGMENT_PREFIX_BYTES));
    if (status === SEGMENT_MORE) return null;

    pending.delete(key);
    const payload: number[] = [];
    for (const off of [...entry.parts.keys()].sort((a, b) => a - b)) {
      if (off !== payload.length) return null; // a gap — a segment went missing
      payload.push(...entry.parts.get(off)!);
    }
    if (payload.length !== entry.total) return null;
    return buildReplyFrame(seq, opcode, 0, payload);
  };
}

/** A `MidiTransport` that hands out reassembled replies from `onSysExReceived` and passes everything
 * else straight through. Each subscription gets its own reassembler, so concurrent requests can't
 * mix segments. */
export function withReplyReassembly(inner: MidiTransport): MidiTransport {
  return {
    get kind() {
      return inner.kind;
    },
    get label() {
      return inner.label;
    },
    init: () => inner.init(),
    isSupported: () => inner.isSupported(),
    listOutputs: (): MidiPortInfo[] => inner.listOutputs(),
    onPortsChanged: (cb) => inner.onPortsChanged(cb),
    sendCC: (...args) => inner.sendCC(...args),
    sendProgramChange: (...args) => inner.sendProgramChange(...args),
    sendSysEx: (...args) => inner.sendSysEx(...args),
    onMessageSent: (cb: MessageListener) => inner.onMessageSent(cb),
    onSysExReceived: (outputId, cb) => {
      const reassemble = createReplyReassembler();
      return inner.onSysExReceived(outputId, (bytes) => {
        const frame = reassemble(bytes);
        if (frame) cb(frame);
      });
    },
  };
}
