// Real captured NanoCore frames (copied verbatim from midi/__tests__/presetReader.test.ts) — shared by
// the device-layer tests so they replay genuine traffic instead of synthesized bytes.

export function hex(s: string): number[] {
  return s.split(' ').map((b) => parseInt(b, 16));
}

export const SLOT0_CLNARP_P1 = hex(
  'f0 7d 4e 43 71 40 02 01 00 41 00 00 4d 10 00 00 00 00 7f 00 01 00 02 07 00 02 10 43 6c 00 6e 41 72 70 00 00 00 00 00 00 00 60 13 03 40 00 03 08 00 01 02 03 04 00 05 06 07 10 23 00 07 30 03 01 06 00 36 73 1d 00 3f 01 00 00 00 00 02 01 6c 51 38 3e 03 29 5c 09 0f 3d 04 38 1e 05 3e 04 05 52 38 1e 3f 10 14 00 01 08 00 00 03 00 00 00 00 00 3f 01 00 00 00 0c 3f 02 4d 4c 4c 3f 10 00 1e 02 01 00 01 05 00 03 1a 19 19 3f 01 00 00 10 00 3f 02 1f 05 2b 3f 44 03 0a 57 63 3f 04 4d 01 4c 4c 3f 10 0f 03 02 30 00 01 02 00 4d 4c 0c 00 3f 01 33 33 33 3f 10 00 19 04 05 00 00 04 00 63 1a 19 19 3e 01 41 4a 00 21 3f 02 00 00 00 3f 06 03 1a 19 19 3f 10 0f 00 05 04 00 01 02 00 5c 73 0f 42 3e 01 4d 4c 4c 00 3e 10 1e 06 03 01 01 00 05 00 7b 14 2e 3e 01 01 6c 51 38 f7',
);

export const SLOT0_CLNARP_P2 = hex(
  'f0 7d 4e 43 71 00 02 01 00 41 00 00 3c 14 00 00 48 00 7f 00 3e 40 02 71 3d 4a 3f 03 4d 01 4c 4c 3e 04 7b 14 2e 00 3e 10 19 07 06 00 00 00 04 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 00 22 01 54 20 01 05 21 00 01 04 24 01 1e f7',
);

export const LIVE_FX2_TYPE7 = hex(
  'f0 7d 4e 43 71 40 02 01 00 63 00 00 18 00 00 03 2e 54 01 03 06 52 12 03 60 3f 7a 7e 2a 02 3e 6c 51 38 3e 29 5c 05 0f 3d 38 1e 05 3e 52 01 38 1e 3f 01 07 01 00 40 00 00 3f 01 00 05 6e 00 7c 3f 3f 00 00 00 3f 22 1f 05 2b 3f 0a 57 63 06 3f 4d 4c 4c 3f 01 00 06 02 4d 4c 0c 3f 33 33 60 33 3f 00 00 04 1a 19 0c 19 3e 41 4a 21 3f 00 18 00 00 3f 1a 19 19 3f 30 01 00 02 5c 0f 42 3e 07 4d 4c 4c 3e 01 01 05 10 7b 14 2e 3e 6c 51 38 60 3e 71 3d 4a 3f 4d 4c 00 4c 3e 7b 14 2e 3e 00 00 00 04 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 08 00 01 00 02 03 04 05 06 07 f7',
);

export const LIVE_FX1_GATE = hex(
  'f0 7d 4e 43 71 40 02 01 00 63 00 00 08 00 00 03 2e 54 01 00 02 63 4d 4c 4c 3e 21 30 72 00 3e 01 07 01 00 00 00 10 3f 01 00 05 6e 7c 3f 40 3f 00 00 00 3f 1f 05 48 2b 3f 0a 57 63 3f 4d 41 4c 4c 3f 01 00 02 4d 01 4c 0c 3f 33 33 33 3f 18 00 00 04 1a 19 19 3e 03 41 4a 21 3f 00 00 00 06 3f 1a 19 19 3f 01 00 6c 02 5c 0f 42 3e 4d 4c 01 4c 3e 01 01 05 7b 14 04 2e 3e 6c 51 38 3e 71 18 3d 4a 3f 4d 4c 4c 3e 00 7b 14 2e 3e 00 00 04 00 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 08 00 01 02 03 00 04 05 06 07 f7',
);


// Real frames captured over BLUETOOTH (2026-10-01): the device splits a reply into 64-byte segments,
// each its own SysEx message with status 0x10 (more) / 0x11 (last). The three below are ONE opcode-0x63
// (live patch) reply, in order; the fourth is a single-segment 0x68 (ping) reply.
export const BLE_LIVE_PATCH_SEGMENTS = [
  hex('f0 7d 4e 43 71 00 02 01 00 63 00 10 44 02 00 20 00 00 00 03 00 30 54 01 03 06 36 73 1d 20 3f 00 00 00 00 6c 51 50 38 3e 29 5c 0f 3d 38 10 1e 05 3e 52 38 1e 3f 00 00 00 03 00 00 00 3f 30 00 00 00 3f 4d 4c 4c 30 3f 01 00 05 1a 19 19 40 3f 00 00 00 3f 1f 05 08 2b 3f 0a 57 63 3f f7'),
  hex('f0 7d 4e 43 71 00 02 01 00 63 00 10 44 62 00 20 00 40 00 4d 4c 60 4c 3f 01 00 02 4d 4c 00 0c 3f 33 33 33 3f 00 4c 00 04 1a 19 19 3e 41 01 4a 21 3f 00 00 00 3f 03 1a 19 19 3f 01 00 02 76 5c 0f 42 3e 4d 4c 4c 00 3e 01 01 05 7b 14 2e 02 3e 6c 51 38 3e 71 3d 0c 4a 3f 4d 4c 4c 3e f7'),
  hex('f0 7d 4e 43 71 00 02 01 00 63 00 11 24 0a 00 20 00 00 00 7b 14 00 2e 3e 00 00 04 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 08 00 01 02 03 04 05 00 06 07 f7'),
];
export const BLE_PING_REPLY = hex('f0 7d 4e 43 71 00 02 02 00 68 00 11 08 00 00 04 00 00 00 02 00 01 08 13 f7');
