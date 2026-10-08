import { describe, expect, it } from 'vitest';
import { buildReplyFrame, createReplyReassembler } from '../segmentedReplies';
import { unpack7BitSafe } from '../safePacking';
import { decodeLiveBlockParams } from '../presetReader';
import { isAmpProfileResponse } from '../sysex';
import { segmentReply } from '../../testing/segmentReply';
import { BLE_LIVE_PATCH_SEGMENTS, BLE_PING_REPLY, LIVE_FX2_TYPE7, SLOT0_CLNARP_P1, SLOT0_CLNARP_P2, hex } from '../../testing/realCaptures';

/** Payload/seq/opcode of a USB-shaped reply frame. */
function parts(frame: readonly number[]) {
  const un = unpack7BitSafe(frame.slice(5, -1));
  const len = un[6] | (un[7] << 8);
  return { seq: un[1] | (un[2] << 8), opcode: un[3] | (un[4] << 8), status: un[5], payload: un.slice(8, 8 + len) };
}

describe('buildReplyFrame', () => {
  it('rebuilds a real USB reply byte for byte', () => {
    for (const frame of [LIVE_FX2_TYPE7, SLOT0_CLNARP_P1, SLOT0_CLNARP_P2]) {
      const p = parts(frame);
      expect(buildReplyFrame(p.seq, p.opcode, p.status, p.payload)).toEqual(frame);
    }
  });
});

describe('createReplyReassembler — real Bluetooth capture', () => {
  it('holds the first two segments and delivers the whole reply on the last', () => {
    const reassemble = createReplyReassembler();
    expect(reassemble(BLE_LIVE_PATCH_SEGMENTS[0])).toBeNull();
    expect(reassemble(BLE_LIVE_PATCH_SEGMENTS[1])).toBeNull();
    const frame = reassemble(BLE_LIVE_PATCH_SEGMENTS[2])!;
    expect(frame).not.toBeNull();
    const p = parts(frame);
    expect(p).toMatchObject({ opcode: 0x63, status: 0 });
    expect(p.payload).toHaveLength(160); // 64 + 64 + 32, the capture's declared total
    // …and it is a reply the existing parsers understand.
    expect(isAmpProfileResponse(frame)).toBe(true);
    expect(decodeLiveBlockParams(frame)).toHaveLength(8);
  });

  it('turns a single-segment reply (ping) into a plain status-0 reply', () => {
    const frame = createReplyReassembler()(BLE_PING_REPLY)!;
    expect(parts(frame)).toMatchObject({ opcode: 0x68, status: 0, payload: [0x02, 0x00, 0x88, 0x13] });
  });
});

describe('createReplyReassembler — behaviour', () => {
  const reassembleAll = (frames: number[][], r = createReplyReassembler()) => frames.map((f) => r(f)).filter((f) => f !== null);

  it('round-trips real USB replies through segmentation', () => {
    for (const frame of [LIVE_FX2_TYPE7, SLOT0_CLNARP_P1, SLOT0_CLNARP_P2]) {
      const segments = segmentReply(frame);
      expect(reassembleAll(segments)).toEqual([frame]);
    }
  });

  it('segments a long reply into 64-byte pieces', () => {
    expect(segmentReply(LIVE_FX2_TYPE7).length).toBe(Math.ceil(parts(LIVE_FX2_TYPE7).payload.length / 64));
  });

  it('puts segments back in order when they arrive out of order', () => {
    const segments = segmentReply(LIVE_FX2_TYPE7);
    const [first, ...rest] = segments;
    const last = rest.pop()!;
    expect(reassembleAll([first, ...rest.reverse(), last])).toEqual([LIVE_FX2_TYPE7]);
  });

  it('drops a reply with a missing segment instead of delivering a short one', () => {
    const segments = segmentReply(LIVE_FX2_TYPE7);
    expect(reassembleAll([segments[0], segments[segments.length - 1]])).toEqual([]);
  });

  it('keeps interleaved replies apart by sequence number and opcode', () => {
    const a = segmentReply(LIVE_FX2_TYPE7);
    const b = segmentReply(SLOT0_CLNARP_P1);
    const mixed: number[][] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) mixed.push(a[i]);
      if (b[i]) mixed.push(b[i]);
    }
    const out = reassembleAll(mixed);
    expect(out).toHaveLength(2);
    expect(out).toEqual(expect.arrayContaining([LIVE_FX2_TYPE7, SLOT0_CLNARP_P1]));
  });

  it('leaves everything that is not a segmented reply untouched', () => {
    const r = createReplyReassembler();
    expect(r(LIVE_FX2_TYPE7)).toEqual(LIVE_FX2_TYPE7); // a normal USB reply
    const push = hex('f0 7d 4e 43 72 00 02 61 00 02 00 05 01 f7'); // an unsolicited push
    expect(r(push)).toEqual(push);
    const error = buildReplyFrame(7, 0x32, 5, []); // a real error status is not a segment
    expect(r(error)).toEqual(error);
    expect(r([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7])).toEqual([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]); // someone else's SysEx
  });
});
