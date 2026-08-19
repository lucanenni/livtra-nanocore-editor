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
