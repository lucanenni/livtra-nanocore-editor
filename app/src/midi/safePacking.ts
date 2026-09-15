/**
 * NanoCore's "7-bit-safe" byte packing scheme: a way to embed arbitrary 8-bit bytes inside a
 * SysEx message, whose data bytes may never be `>= 0x80`. A header byte precedes each run of up
 * to 7 raw bytes; header bit `i` holds raw byte `i`'s own bit 7, and the raw bytes themselves are
 * transmitted with bit 7 masked off (`& 0x7f`). This is how the protocol satisfies MIDI's "no
 * SysEx data byte >= 0x80" rule for any multi-byte value (a float32, say) whose raw bytes might
 * otherwise violate it.
 *
 * `unpack7BitSafe` was confirmed 2026-09-09, verified byte-exact against real hardware captures
 * (see `midi/presetReader.ts`'s `decodePresetParamValues`) — every restored float32 parameter
 * value matched a known-good reference to full IEEE-754 precision, not just approximately.
 * `pack7BitSafe` (its inverse, needed to *send* a value rather than just read one) was added
 * 2026-09-12 for `midi/sysex.ts`'s `buildSetParamValueSysEx`, confirmed by round-tripping a live
 * write through a save-and-read-back on real hardware — see docs/MIDI_MAPPING_NOTES.md.
 *
 * Split out of `presetReader.ts` (which re-exports `unpack7BitSafe` for existing callers) so
 * `midi/sysex.ts` can use `pack7BitSafe` without an import cycle — `presetReader.ts` already
 * imports from `sysex.ts`.
 */

/** Read a header, use its bits to restore bit 7 on the next up to 7 bytes, repeat until `bytes`
 * (from `start`) is exhausted. */
export function unpack7BitSafe(bytes: readonly number[], start = 0): number[] {
  const out: number[] = [];
  let pos = start;
  while (pos < bytes.length) {
    const header = bytes[pos];
    pos += 1;
    for (let i = 0; i < 7 && pos < bytes.length; i += 1, pos += 1) {
      out.push(bytes[pos] | (((header >> i) & 1) << 7));
    }
  }
  return out;
}

/** Inverse of `unpack7BitSafe` — pack raw bytes (any of which may have bit 7 set) into the
 * MIDI-safe form: a header byte followed by up to 7 masked (`& 0x7f`) bytes, repeated per run of
 * 7 input bytes. */
export function pack7BitSafe(bytes: readonly number[]): number[] {
  const out: number[] = [];
  for (let start = 0; start < bytes.length; start += 7) {
    const chunk = bytes.slice(start, start + 7);
    let header = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] & 0x80) header |= 1 << i;
    }
    out.push(header, ...chunk.map((b) => b & 0x7f));
  }
  return out;
}
