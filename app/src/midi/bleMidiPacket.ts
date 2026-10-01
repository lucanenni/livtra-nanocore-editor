/**
 * BLE-MIDI packet encoding per the MIDI Manufacturers Association's "MIDI over Bluetooth Low
 * Energy" spec. Every packet starts with a header byte and a timestamp byte, both with the MSB
 * set to distinguish them from MIDI data bytes (which always have the MSB clear):
 *
 *   header byte:    1 0 T T T T T T   (bits 5-0 = high 6 bits of a 13-bit ms timestamp)
 *   timestamp byte: 1 T T T T T T T   (bits 6-0 = low 7 bits of the same timestamp)
 *
 * followed by the raw MIDI message bytes. We send one message per packet (no running-status
 * compression) — simpler and well within the default 20-byte ATT payload, so no MTU
 * negotiation is needed either.
 */

export const BLE_MIDI_SERVICE_UUID = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_CHARACTERISTIC_UUID = '7772e5db-3868-4112-a1a9-f2669d106bf3';

const TIMESTAMP_MASK = 0x1fff; // 13-bit, wraps every 8192ms per spec

export function encodeBleMidiPacket(midiBytes: number[], nowMs: number = performance.now()): Uint8Array {
  const timestamp = Math.floor(nowMs) & TIMESTAMP_MASK;
  const header = 0x80 | ((timestamp >> 7) & 0x3f);
  const timestampByte = 0x80 | (timestamp & 0x7f);
  return new Uint8Array([header, timestampByte, ...midiBytes]);
}

/** Max raw MIDI bytes per BLE-MIDI packet, leaving room for the 2-byte header+timestamp within
 * the default 20-byte ATT payload (no MTU negotiation, matching encodeBleMidiPacket above). */
const MAX_MIDI_BYTES_PER_PACKET = 18;

/**
 * SysEx messages (unlike the 2-3 byte CC/PC ones) can exceed a single BLE-MIDI packet — e.g. the
 * NanoCore's chain-reorder command is ~25 bytes. Per the BLE-MIDI spec, a long SysEx is simply
 * split across multiple packets, each with its own header+timestamp; the receiver concatenates
 * the data bytes until it sees the trailing 0xF7. No new status byte is needed for continuation
 * packets since SysEx is just a running data stream.
 */
export function encodeBleMidiSysEx(sysexBytes: number[], nowMs: number = performance.now()): Uint8Array[] {
  const packets: Uint8Array[] = [];
  for (let i = 0; i < sysexBytes.length; i += MAX_MIDI_BYTES_PER_PACKET) {
    packets.push(encodeBleMidiPacket(sysexBytes.slice(i, i + MAX_MIDI_BYTES_PER_PACKET), nowMs));
  }
  return packets;
}

/**
 * Reassembles incoming BLE-MIDI notification packets back into complete SysEx messages —
 * the receive-side mirror of `encodeBleMidiSysEx`. Assumes the device packs its own
 * responses the same simple way we send ours (each notification is `[header, timestamp,
 * ...raw MIDI bytes]`, a long SysEx simply continuing across packets with no repeated status
 * byte) — this hasn't been independently verified against real hardware traffic (this project's
 * capture setup only observes device→host, and even so, capturing raw *notification* framing
 * would need a lower-level BLE sniffer, not just a MIDI listener), so treat as a reasonable best
 * effort rather than a confirmed decode. Only SysEx (`0xF0`...`0xF7`) is reassembled; any other
 * MIDI bytes in a notification (leftover CC/PC traffic, mid-transfer) are dropped rather than
 * misinterpreted, since consumers of this class only care about the NanoCore's SysEx replies.
 */
export class BleMidiSysExAssembler {
  private buffer: number[] = [];
  private inSysEx = false;

  /** Feeds one notification's raw `characteristicvaluechanged` value. Returns a complete
   * `F0...F7` message once one finishes across one or more calls, else `null`. */
  push(notificationValue: Uint8Array | number[]): number[] | null {
    // Strip the mandatory 2-byte header+timestamp prefix (see encodeBleMidiPacket).
    const data = Array.from(notificationValue).slice(2);
    for (const byte of data) {
      if (byte === 0xf0) {
        this.buffer = [0xf0];
        this.inSysEx = true;
      } else if (this.inSysEx) {
        this.buffer.push(byte);
        if (byte === 0xf7) {
          this.inSysEx = false;
          const complete = this.buffer;
          this.buffer = [];
          return complete;
        }
      }
    }
    return null;
  }
}
