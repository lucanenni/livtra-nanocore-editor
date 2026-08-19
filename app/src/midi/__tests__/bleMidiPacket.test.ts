import { describe, expect, it } from 'vitest';
import { BLE_MIDI_CHARACTERISTIC_UUID, BLE_MIDI_SERVICE_UUID, encodeBleMidiPacket } from '../bleMidiPacket';

describe('encodeBleMidiPacket', () => {
  it('uses the standard BLE-MIDI service/characteristic UUIDs', () => {
    expect(BLE_MIDI_SERVICE_UUID).toBe('03b80e5a-ede8-4b33-a751-6ce34ec4c700');
    expect(BLE_MIDI_CHARACTERISTIC_UUID).toBe('7772e5db-3868-4112-a1a9-f2669d106bf3');
  });

  it('sets the MSB on the header and timestamp bytes, clear on MIDI data bytes', () => {
    const packet = encodeBleMidiPacket([0xb0, 20, 127], 0);
    expect(packet).toHaveLength(5);
    expect(packet[0] & 0x80).toBe(0x80); // header MSB set
    expect(packet[1] & 0x80).toBe(0x80); // timestamp MSB set
    // The MIDI status byte legitimately has its own high bit set (0xB0) — check the two
    // *data* bytes instead, which must never have the MSB set per the MIDI spec.
    expect(packet[3] & 0x80).toBe(0); // cc number
    expect(packet[4] & 0x80).toBe(0); // value
  });

  it('encodes a zero timestamp as header=0x80, timestampByte=0x80', () => {
    const packet = encodeBleMidiPacket([0xb0, 1, 1], 0);
    expect(packet[0]).toBe(0x80);
    expect(packet[1]).toBe(0x80);
  });

  it('splits a 13-bit timestamp across header (high 6 bits) and timestamp byte (low 7 bits)', () => {
    // 1000 = 7*128 + 104 -> high6 = 1000>>7 = 7 (0x07), low7 = 1000 & 0x7f = 104 (0x68)
    const packet = encodeBleMidiPacket([0xc0, 5], 1000);
    expect(packet[0]).toBe(0x80 | 0x07);
    expect(packet[1]).toBe(0x80 | 0x68);
  });

  it('wraps the timestamp at 13 bits (8192ms)', () => {
    const packet = encodeBleMidiPacket([0xb0, 1, 1], 8192); // 8192 & 0x1fff === 0
    expect(packet[0]).toBe(0x80);
    expect(packet[1]).toBe(0x80);
  });

  it('appends the raw MIDI bytes unchanged after the two header bytes', () => {
    const packet = encodeBleMidiPacket([0xc0, 42], 0);
    expect(Array.from(packet)).toEqual([0x80, 0x80, 0xc0, 42]);
  });
});
