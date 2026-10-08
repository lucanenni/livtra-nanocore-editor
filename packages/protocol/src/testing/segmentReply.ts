import { buildReplyFrame, SEGMENT_LAST, SEGMENT_MORE } from '../midi/segmentedReplies';
import { unpack7BitSafe } from '../midi/safePacking';

/** Splits a USB-shaped reply frame the way the device does over Bluetooth LE: segments of at most
 * 64 data bytes, each its own frame with status 0x10/0x11 and a `u16 total, u16 offset` prefix. */
export function segmentReply(frame: readonly number[], segmentSize = 64): number[][] {
  const un = unpack7BitSafe(frame.slice(5, -1));
  const seq = un[1] | (un[2] << 8);
  const opcode = un[3] | (un[4] << 8);
  const len = un[6] | (un[7] << 8);
  const payload = un.slice(8, 8 + len);
  const out: number[][] = [];
  for (let offset = 0; offset === 0 || offset < payload.length; offset += segmentSize) {
    const data = payload.slice(offset, offset + segmentSize);
    const last = offset + segmentSize >= payload.length;
    const body = [payload.length & 0xff, payload.length >> 8, offset & 0xff, offset >> 8, ...data];
    out.push(buildReplyFrame(seq, opcode, last ? SEGMENT_LAST : SEGMENT_MORE, body));
  }
  return out;
}
