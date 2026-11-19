import { describe, expect, it } from 'vitest';
import { crc32 } from '../crc32';
import {
  IR_SLOT_COUNT,
  PROFILE_CHUNK_SIZE,
  catalogSlotFor,
  customProfileLabel,
  customProfileName,
  readIrCatalog,
  readProfileData,
  readProfileCatalog,
  runIrUpload,
  runProfileUpload,
  sanitizeProfileName,
  validateIrFile,
  validateProfileFile,
  type CommandTransact,
  type UploadPhase,
} from '../profileUpload';
import {
  buildCommandFrameWithSeq,
  buildIrApplySysEx,
  buildIrBeginSysEx,
  buildIrChunkSysEx,
  buildIrFinalizeSysEx,
  buildIrNameSysEx,
  buildIrStorageInfoSysEx,
  buildProfileApplySysEx,
  buildProfileBeginSysEx,
  buildProfileCatalogReadSysEx,
  buildProfileChunkSysEx,
  buildProfileFinalizeSysEx,
  buildProfileNameSysEx,
  buildStorageInfoSysEx,
  isCommandReply,
  parseCommandMessage,
  parseProfileCatalogRecord,
  parseStorageInfo,
  type CommandMessage,
} from '../sysex';

const hex = (s: string) => (s.match(/../g) ?? []).map((h) => parseInt(h, 16));

// Real frames captured 2026-09-30 from ToneCommand (macOS, USB) importing a 12302-byte `.ead`
// into slot 30 (index 0x1d) — see docs/MIDI_MAPPING_NOTES.md, "AMP/FX2 profile upload".
const REAL = {
  info: { seq: 9693, frame: 'f07d4e437002025d2530000000f7' },
  infoReply: 'f07d4e437102025d2530000014000000200700001000000026000000000030000025000000f7',
  begin: { seq: 9694, frame: 'f07d4e437002025e2531000400000e30001df7' },
  beginReply: 'f07d4e437102025e25310000000000f7',
  finalize: { seq: 9888, frame: 'f07d4e43700202202633000800400e30001d22612e0123f7' },
  name: { seq: 9889, frame: 'f07d4e43700202212635000700001d30302e656164f7' },
  apply: { seq: 9892, frame: 'f07d4e43700202242637000100001df7' },
  catalogRead: { seq: 9894, frame: 'f07d4e437002022626360001000000f7' },
  catalogReply:
    'f07d4e4371020226263600001e1000000100522f0018006a3302571a1a0000426f67585443003100000000000000000000f7',
};

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32([])).toBe(0);
    expect(crc32(Array.from('123456789', (c) => c.charCodeAt(0)))).toBe(0xcbf43926);
  });
});

describe('real captured frames', () => {
  it('re-framing each captured request from its decoded fields reproduces it byte for byte', () => {
    for (const { seq, frame } of [REAL.info, REAL.begin, REAL.finalize, REAL.name, REAL.apply, REAL.catalogRead]) {
      const parsed = parseCommandMessage(hex(frame))!;
      expect(parsed.direction).toBe('request');
      expect(parsed.seq).toBe(seq);
      expect(buildCommandFrameWithSeq(parsed.seq, parsed.opcode, parsed.payload)).toEqual(hex(frame));
    }
  });

  it('the builders produce the same opcode and payload as the captured requests', () => {
    const same = (built: number[], real: string) => {
      const a = parseCommandMessage(built)!;
      const b = parseCommandMessage(hex(real))!;
      expect([a.opcode, a.payload]).toEqual([b.opcode, b.payload]);
    };
    same(buildStorageInfoSysEx(), REAL.info.frame);
    same(buildProfileBeginSysEx(0x1d, 12302), REAL.begin.frame);
    same(buildProfileFinalizeSysEx(0x1d, 12302, 0xa3ae6122), REAL.finalize.frame);
    same(buildProfileNameSysEx(0x1d, '00.ead'), REAL.name.frame);
    same(buildProfileApplySysEx(0x1d), REAL.apply.frame);
    same(buildProfileCatalogReadSysEx(0), REAL.catalogRead.frame);
  });

  it('chunk frames carry arbitrary bytes safely (slot+offset header, data with bit 7 set)', () => {
    const frame = buildProfileChunkSysEx(3, 0x010040, [0x80, 0xff, 0x00, 0x7f]);
    expect(frame.slice(1, -1).every((b) => b < 0x80)).toBe(true); // valid SysEx: no data byte >= 0x80
    expect(parseCommandMessage(frame)).toMatchObject({ direction: 'request', opcode: 0x32, payload: [0x40, 0x00, 0x01, 0x03, 0x80, 0xff, 0x00, 0x7f] });
  });

  it('decodes the captured replies', () => {
    const info = parseCommandMessage(hex(REAL.infoReply))!;
    expect(info).toMatchObject({ direction: 'reply', seq: 9693, opcode: 0x30, status: 0 });
    expect(parseStorageInfo(info.payload)).toEqual({
      values: [0x72000, 0x1000, 0x26, 0x3000, 0x25],
      slotCount: 38,
      lastWrittenSlot: 0x25,
    });
    expect(parseCommandMessage(hex(REAL.beginReply))).toMatchObject({ direction: 'reply', opcode: 0x31, status: 0, payload: [] });

    const record = parseProfileCatalogRecord(parseCommandMessage(hex(REAL.catalogReply))!.payload)!;
    expect(record).toEqual({ slot: 0, present: true, lastWritten: false, bodyBytes: 12242, checksum: 0xd782336a, name: 'BogXTC1', assetType: null });
  });

  it('reads a trailing 31st byte as assetType when present', () => {
    const payload = parseCommandMessage(hex(REAL.catalogReply))!.payload.slice();
    payload.push(3); // NA2L
    expect(parseProfileCatalogRecord(payload)!.assetType).toBe(3);
  });

  it('matches a reply to its request by opcode and sequence number only', () => {
    expect(isCommandReply(hex(REAL.beginReply), hex(REAL.begin.frame))).toBe(true);
    expect(isCommandReply(hex(REAL.infoReply), hex(REAL.begin.frame))).toBe(false); // other seq and opcode
    expect(isCommandReply(hex(REAL.begin.frame), hex(REAL.begin.frame))).toBe(false); // a request is not a reply
  });

  it('rejects things that are not frames of this protocol', () => {
    expect(parseCommandMessage([0xf0, 0x7d, 0x4e, 0x43, 0x72, 0x00, 0xf7])).toBeNull();
    expect(parseCommandMessage([0xf0, 0x41, 0x10, 0x00, 0x70, 0x00, 0x02, 0x01, 0xf7])).toBeNull();
  });
});

function sapfFile(totalLength: number, fill = 0x5a): Uint8Array {
  const data = new Uint8Array(totalLength).fill(fill);
  data.set([0x53, 0x41, 0x50, 0x46, 0x01, 0, 0, 0], 0);
  const body = totalLength - 60;
  data.set([body & 0xff, (body >> 8) & 0xff, (body >> 16) & 0xff, (body >>> 24) & 0xff], 24);
  for (let i = 60; i < totalLength; i += 1) data[i] = (i * 37 + 11) & 0xff; // deterministic, uses bit 7
  return data;
}

describe('validateProfileFile', () => {
  it('accepts a well-formed container', () => {
    expect(validateProfileFile(sapfFile(300))).toEqual({ ok: true, bodyBytes: 240 });
  });

  it('names the first problem it finds', () => {
    expect(validateProfileFile(new Uint8Array(10))).toEqual({ ok: false, problem: 'too-short' });
    const badMagic = sapfFile(100); badMagic[0] = 0x41;
    expect(validateProfileFile(badMagic)).toEqual({ ok: false, problem: 'bad-magic' });
    const badVersion = sapfFile(100); badVersion[4] = 2;
    expect(validateProfileFile(badVersion)).toEqual({ ok: false, problem: 'bad-version' });
    const truncated = sapfFile(100).slice(0, 90);
    expect(validateProfileFile(truncated)).toEqual({ ok: false, problem: 'length-mismatch' });
    expect(validateProfileFile(new Uint8Array(300 * 1024))).toEqual({ ok: false, problem: 'too-large' });
  });
});

describe('sanitizeProfileName', () => {
  it('keeps printable ASCII, trims, caps at 16 and never returns empty', () => {
    expect(sanitizeProfileName('  00.ead  ')).toBe('00.ead');
    expect(sanitizeProfileName('Caffè ☕ amp')).toBe('Caff? ? amp');
    expect(sanitizeProfileName('x'.repeat(40))).toHaveLength(16);
    expect(sanitizeProfileName('   ')).toBe('profile');
  });
});

/** A tiny in-memory NanoCore that speaks the captured profile protocol, for exercising
 * `runProfileUpload` without hardware. */
function fakeDevice(options: { dropReplyOnce?: (msg: CommandMessage) => boolean; statusFor?: (opcode: number) => number } = {}) {
  const log: { opcode: number; payload: number[] }[] = [];
  const store = { slot: -1, length: 0, data: [] as number[], crc: -1, name: '' };
  const dropped = new Set<string>();
  const transact: CommandTransact = async (build) => {
    const request = parseCommandMessage(build())!;
    log.push({ opcode: request.opcode, payload: request.payload });
    const u32 = (o: number) => (request.payload[o] | (request.payload[o + 1] << 8) | (request.payload[o + 2] << 16) | (request.payload[o + 3] << 24)) >>> 0;
    let payload: number[] = [];
    switch (request.opcode) {
      case 0x30: payload = [0x00, 0x20, 0x07, 0, 0x00, 0x10, 0, 0, 0x26, 0, 0, 0, 0x00, 0x30, 0, 0, 0x25, 0, 0, 0]; break;
      case 0x31: store.slot = u32(0) >>> 24; store.length = u32(0) & 0xffffff; store.data = []; break;
      case 0x32: {
        const header = u32(0);
        expect(header >>> 24).toBe(store.slot);
        const offset = header & 0xffffff;
        const chunk = request.payload.slice(4);
        for (let i = 0; i < chunk.length; i += 1) store.data[offset + i] = chunk[i];
        break;
      }
      case 0x33: store.crc = u32(4); break;
      case 0x35: store.name = String.fromCharCode(...request.payload.slice(1)); break;
    }
    const key = `${request.opcode}:${u32(0)}`;
    if (options.dropReplyOnce?.(request) && !dropped.has(key)) { dropped.add(key); return null; }
    return { direction: 'reply', seq: request.seq, opcode: request.opcode, status: options.statusFor?.(request.opcode) ?? 0, payload };
  };
  return { transact, log, store };
}

describe('runProfileUpload', () => {
  const data = sapfFile(60 + 200); // 260 bytes = 4 full chunks + a 4-byte tail

  it('uploads the file in acknowledged 64-byte chunks, then finalizes, names and applies', async () => {
    const device = fakeDevice();
    const phases: UploadPhase[] = [];
    const result = await runProfileUpload({ transact: device.transact, slot: 29, data, name: '00.ead', onProgress: (p) => phases.push(p) });

    expect(result).toEqual({ ok: true, applyFailed: false });
    expect(device.store.slot).toBe(29);
    expect(device.store.length).toBe(260);
    expect(device.store.data).toEqual(Array.from(data));
    expect(device.store.crc).toBe(crc32(data));
    expect(device.store.name).toBe('00.ead');
    // exactly the captured order: info, begin, 5 chunks, finalize, name, info, apply, info
    expect(device.log.map((m) => m.opcode)).toEqual([0x30, 0x31, 0x32, 0x32, 0x32, 0x32, 0x32, 0x33, 0x35, 0x30, 0x37, 0x30]);
    expect(PROFILE_CHUNK_SIZE).toBe(64);
    expect(phases[0]).toBe('info');
    expect(phases).toContain('writing');
    expect(phases.at(-1)).toBe('applying');
  });

  it('survives a dropped chunk acknowledgement by resending that chunk', async () => {
    const device = fakeDevice({ dropReplyOnce: (m) => m.opcode === 0x32 });
    const result = await runProfileUpload({ transact: device.transact, slot: 3, data, name: 'x' });
    expect(result).toEqual({ ok: true, applyFailed: false });
    expect(device.store.data).toEqual(Array.from(data));
    expect(device.log.filter((m) => m.opcode === 0x32).length).toBeGreaterThan(5); // resends happened
  });

  it('stops at the first non-zero status and reports where', async () => {
    const device = fakeDevice({ statusFor: (op) => (op === 0x33 ? 5 : 0) });
    const result = await runProfileUpload({ transact: device.transact, slot: 29, data, name: 'x' });
    expect(result).toEqual({ ok: false, phase: 'finalize', reason: 'device-status', status: 5, offset: undefined });
    expect(device.log.some((m) => m.opcode === 0x35)).toBe(false); // never got as far as naming
  });

  it('reports a failed apply step without failing the upload — the data is already committed (real FX2 slots always fail apply this way, 2026-11-20)', async () => {
    const device = fakeDevice({ statusFor: (op) => (op === 0x37 ? 4 : 0) });
    const result = await runProfileUpload({ transact: device.transact, slot: 29, data, name: 'x' });
    expect(result).toEqual({ ok: true, applyFailed: true });
    expect(device.store.name).toBe('x'); // name (and the data before it) still landed
  });

  it('reports no response, and refuses a slot the device does not have before writing anything', async () => {
    const silent: CommandTransact = async () => null;
    expect(await runProfileUpload({ transact: silent, slot: 1, data, name: 'x' })).toMatchObject({ ok: false, phase: 'info', reason: 'no-response' });

    const device = fakeDevice();
    const result = await runProfileUpload({ transact: device.transact, slot: 38, data, name: 'x' });
    expect(result).toEqual({ ok: false, phase: 'info', reason: 'slot-out-of-range' });
    expect(device.log.map((m) => m.opcode)).toEqual([0x30]); // only the read-only info query was sent
  });

  it('gives up on a chunk that never gets acknowledged', async () => {
    const base = fakeDevice();
    const transact: CommandTransact = (build, label) => (label.includes('bytes 64-') ? Promise.resolve(null) : base.transact(build, label));
    const result = await runProfileUpload({ transact, slot: 1, data, name: 'x', chunkRetries: 1 });
    expect(result).toMatchObject({ ok: false, phase: 'writing', reason: 'no-response', offset: 64 });
  });
});

describe('IR write builders (0x50-0x57) — exact opcode/offset parity with the AMP family', () => {
  it('shares frame shape with the AMP builders, opcode offset by +0x20 for every confirmed step', () => {
    const pairs: [number[], number[]][] = [
      [buildStorageInfoSysEx(), buildIrStorageInfoSysEx()],
      [buildProfileBeginSysEx(5, 4096), buildIrBeginSysEx(5, 4096)],
      [buildProfileChunkSysEx(5, 64, [1, 2, 3]), buildIrChunkSysEx(5, 64, [1, 2, 3])],
      [buildProfileFinalizeSysEx(5, 4096, 0x12345678), buildIrFinalizeSysEx(5, 4096, 0x12345678)],
      [buildProfileNameSysEx(5, 'MyCab'), buildIrNameSysEx(5, 'MyCab')],
    ];
    for (const [ampFrame, irFrame] of pairs) {
      const amp = parseCommandMessage(ampFrame)!;
      const ir = parseCommandMessage(irFrame)!;
      expect(ir.opcode).toBe(amp.opcode + 0x20);
      expect(ir.payload).toEqual(amp.payload); // same payload shape, only the opcode differs
    }
    // IR_APPLY (0x57) sits at the same relative position after NAME as AMP's APPLY (0x37) does.
    expect(parseCommandMessage(buildIrApplySysEx(5))!.opcode).toBe(parseCommandMessage(buildProfileApplySysEx(5))!.opcode + 0x20);
  });
});

describe('validateIrFile', () => {
  it('accepts a 4-byte-aligned buffer of finite float32 samples', () => {
    const buf = new Uint8Array(16);
    new DataView(buf.buffer).setFloat32(0, 0.5, true);
    expect(validateIrFile(buf)).toEqual({ ok: true, sampleCount: 4 });
  });

  it('rejects empty, misaligned and non-finite data', () => {
    expect(validateIrFile(new Uint8Array(0))).toEqual({ ok: false, problem: 'too-short' });
    expect(validateIrFile(new Uint8Array(6))).toEqual({ ok: false, problem: 'not-aligned' });
    const nanBuf = new Uint8Array(4);
    new DataView(nanBuf.buffer).setFloat32(0, NaN, true);
    expect(validateIrFile(nanBuf)).toEqual({ ok: false, problem: 'non-finite' });
  });
});

/** A tiny in-memory NanoCore that speaks the IR write protocol, for exercising `runIrUpload`
 * without hardware (mirrors `fakeDevice` above, IR opcodes and a 30-slot/4096-byte storage). */
function fakeIrDevice(options: { statusFor?: (opcode: number) => number } = {}) {
  const log: { opcode: number; payload: number[] }[] = [];
  const store = { slot: -1, length: 0, data: [] as number[], crc: -1, name: '' };
  const transact: CommandTransact = async (build) => {
    const request = parseCommandMessage(build())!;
    log.push({ opcode: request.opcode, payload: request.payload });
    const u32 = (o: number) => (request.payload[o] | (request.payload[o + 1] << 8) | (request.payload[o + 2] << 16) | (request.payload[o + 3] << 24)) >>> 0;
    let payload: number[] = [];
    switch (request.opcode) {
      case 0x50: payload = [0, 0, 0, 0, 0, 0, 0, 0, 0x1e, 0, 0, 0, 0x00, 0x10, 0, 0, 0, 0, 0, 0]; break; // slotCount 30, limit 4096
      case 0x51: store.slot = u32(0) >>> 24; store.length = u32(0) & 0xffffff; store.data = []; break;
      case 0x52: {
        const offset = u32(0) & 0xffffff;
        const chunk = request.payload.slice(4);
        for (let i = 0; i < chunk.length; i += 1) store.data[offset + i] = chunk[i];
        break;
      }
      case 0x53: store.crc = u32(4); break;
      case 0x55: store.name = String.fromCharCode(...request.payload.slice(1)); break;
    }
    return { direction: 'reply', seq: request.seq, opcode: request.opcode, status: options.statusFor?.(request.opcode) ?? 0, payload };
  };
  return { transact, log, store };
}

describe('runIrUpload', () => {
  const data = new Uint8Array(4 * 65); // 260 bytes, not a round number of 64-byte chunks

  it('uploads the IR in acknowledged 64-byte chunks, finalizes, names and applies', async () => {
    const device = fakeIrDevice();
    const phases: UploadPhase[] = [];
    const result = await runIrUpload({ transact: device.transact, slot: 7, data, name: 'MyCab', onProgress: (p) => phases.push(p) });

    expect(result).toEqual({ ok: true, applyFailed: false });
    expect(device.store.slot).toBe(7);
    expect(device.store.data).toEqual(Array.from(data));
    expect(device.store.crc).toBe(crc32(data));
    expect(device.store.name).toBe('MyCab');
    expect(device.log.map((m) => m.opcode)).toEqual([0x50, 0x51, 0x52, 0x52, 0x52, 0x52, 0x52, 0x53, 0x55, 0x57]);
    expect(phases.at(-1)).toBe('applying');
  });

  it('refuses data larger than the live size limit before writing anything', async () => {
    const device = fakeIrDevice();
    const tooBig = new Uint8Array(4100);
    const result = await runIrUpload({ transact: device.transact, slot: 0, data: tooBig, name: 'x' });
    expect(result).toEqual({ ok: false, phase: 'info', reason: 'too-large' });
    expect(device.log.map((m) => m.opcode)).toEqual([0x50]);
  });

  it('refuses a slot the IR storage does not have', async () => {
    const device = fakeIrDevice();
    const result = await runIrUpload({ transact: device.transact, slot: 30, data, name: 'x' });
    expect(result).toEqual({ ok: false, phase: 'info', reason: 'slot-out-of-range' });
  });

  it('stops at the first non-zero status before the apply step, as a hard failure', async () => {
    const device = fakeIrDevice({ statusFor: (op) => (op === 0x53 ? 5 : 0) });
    const result = await runIrUpload({ transact: device.transact, slot: 7, data, name: 'x' });
    expect(result).toEqual({ ok: false, phase: 'finalize', reason: 'device-status', status: 5, offset: undefined });
    expect(device.log.some((m) => m.opcode === 0x55)).toBe(false); // never got as far as naming
  });

  it('reports a failed apply step without failing the upload — the data is already committed', async () => {
    const device = fakeIrDevice({ statusFor: (op) => (op === 0x57 ? 0x7e : 0) });
    const result = await runIrUpload({ transact: device.transact, slot: 7, data, name: 'MyCab' });
    expect(result).toEqual({ ok: true, applyFailed: true });
    expect(device.store.name).toBe('MyCab'); // name (and the data before it) still landed
  });
});

describe('readProfileData', () => {
  const body = Array.from({ length: 150 }, (_, i) => (i * 7) & 0xff);
  /** A pedal holding `body` in every slot, answering reads `perReply` bytes at a time. */
  const pedal = (checksum: number, perReply = 59): CommandTransact => async (build) => {
    const request = parseCommandMessage(build())!;
    const [slot, lo, hi] = request.payload;
    if (request.opcode === 0x36 || request.opcode === 0x56) {
      const payload = Array.from({ length: 30 }, () => 0);
      payload[0] = slot; payload[1] = 1; payload[3] = body.length;
      [0, 8, 16, 24].forEach((shift, i) => (payload[7 + i] = (checksum >>> shift) & 0xff));
      return { direction: 'reply', seq: request.seq, opcode: request.opcode, status: 0, payload };
    }
    const at = lo | (hi << 8);
    const payload = [slot, lo, hi, body.length, 0, ...body.slice(at, at + perReply)];
    return { direction: 'reply', seq: request.seq, opcode: request.opcode, status: 0, payload };
  };

  it('reassembles the stored body from short replies and checks its CRC-32', async () => {
    const result = await readProfileData(pedal(crc32(body)), 5);
    expect(result).toMatchObject({ ok: true, crcMatches: true });
    if (result.ok) expect(Array.from(result.body)).toEqual(body);
  });

  it('reports a body that never matches the catalog checksum, after re-reading it', async () => {
    expect(await readProfileData(pedal(crc32(body) ^ 1), 5)).toMatchObject({ ok: true, crcMatches: false, attempts: 3 });
  });

  it('re-reads a slot whose first read came back damaged', async () => {
    const clean = pedal(crc32(body));
    let damaged = true;
    const transact: CommandTransact = async (build, label) => {
      const reply = await clean(build, label);
      if (reply && reply.opcode === 0x39 && damaged) {
        damaged = false;
        return { ...reply, payload: [...reply.payload.slice(0, 5), ...reply.payload.slice(5).map((b) => b ^ 0xff)] };
      }
      return reply;
    };
    expect(await readProfileData(transact, 5)).toMatchObject({ ok: true, crcMatches: true, attempts: 2 });
  });

  it('reads IR slots with 0x56/0x59', async () => {
    const opcodes = new Set<number>();
    const inner = pedal(crc32(body));
    const transact: CommandTransact = (build, label) => {
      opcodes.add(parseCommandMessage(build())!.opcode);
      return inner(build, label);
    };
    expect(await readProfileData(transact, 2, true)).toMatchObject({ ok: true });
    expect([...opcodes].sort()).toEqual([0x56, 0x59]);
  });
});

describe('readIrCatalog', () => {
  it('reads the 30 CAB IR slots with 0x56', async () => {
    const opcodes = new Set<number>();
    const transact: CommandTransact = async (build) => {
      const request = parseCommandMessage(build())!;
      opcodes.add(request.opcode);
      const payload = Array.from({ length: 30 }, () => 0);
      payload[0] = request.payload[0]; payload[1] = 1;
      return { direction: 'reply', seq: request.seq, opcode: request.opcode, status: 0, payload };
    };
    expect(await readIrCatalog(transact)).toHaveLength(IR_SLOT_COUNT);
    expect([...opcodes]).toEqual([0x56]);
  });
});

describe('customProfileName', () => {
  const record = (slot: number, name: string, present = true) => ({ slot, present, lastWritten: false, bodyBytes: 0, checksum: 0, name, assetType: null });

  it('maps AMP, FX2 and CAB types onto their catalog slots', () => {
    expect(catalogSlotFor('amp', 5)).toBe(5);
    expect(catalogSlotFor('fx2', 7)).toBe(37);
    expect(catalogSlotFor('fx2', 8)).toBeNull(); // FX2 types past the drives/boosts have no slot
    expect(catalogSlotFor('cab', 29)).toBe(29);
    expect(catalogSlotFor('rev', 0)).toBeNull();
  });

  it('names a slot only when it no longer holds the factory model', () => {
    const catalog = [record(5, 'My Amp NAM'), record(0, 'BogXTC1'), record(31, 'klone'), record(6, 'Hiw103 ', false)];
    expect(customProfileName(catalog, 'amp', 5, 'Fd65Dk')).toBe('My Amp NAM');
    expect(customProfileName(catalog, 'amp', 0, 'BogXTC1')).toBeNull();
    expect(customProfileName(catalog, 'fx2', 1, 'Klone')).toBeNull(); // case-insensitive
    expect(customProfileName(catalog, 'amp', 6, 'Hiw103')).toBeNull(); // not present
    expect(customProfileName(null, 'amp', 5, 'Fd65Dk')).toBeNull();
  });
});

describe('readProfileCatalog', () => {
  it('gives up when the first slot gets no reply at all', async () => {
    let calls = 0;
    const transact: CommandTransact = async () => {
      calls += 1;
      return null;
    };
    expect(await readProfileCatalog(transact)).toEqual([]);
    expect(calls).toBe(1);
  });

  it('reads all 38 slots and skips the ones that fail', async () => {
    const transact: CommandTransact = async (build) => {
      const request = parseCommandMessage(build())!;
      const slot = request.payload[0];
      if (slot === 5) return null;
      const payload = Array.from({ length: 30 }, () => 0);
      payload[0] = slot; payload[1] = 1;
      for (const [i, ch] of Array.from(`S${slot}`).entries()) payload[14 + i] = ch.charCodeAt(0);
      return { direction: 'reply', seq: request.seq, opcode: 0x36, status: 0, payload };
    };
    const records = await readProfileCatalog(transact);
    expect(records).toHaveLength(37);
    expect(records.map((r) => r.slot)).not.toContain(5);
    expect(records[0]).toMatchObject({ slot: 0, present: true, name: 'S0' });
  });
});

describe('customProfileLabel', () => {
  const record = (slot: number, name: string) => ({ slot, present: true, lastWritten: false, bodyBytes: 0, checksum: 0, name, assetType: null });
  const types = [
    { id: 0, name: 'Bog412A' },
    { id: 1, name: 'Bog412B' },
    { id: 2, name: 'Eng412A' },
    { id: 3, name: 'Eng412B' },
  ];
  const catalog = [record(0, 'Acoustic Mic IR'), record(1, 'acoustic mic ir'), record(2, 'My Cab IR'), record(3, 'Eng412B')];

  it('puts the slot number in front of a name that several slots share', () => {
    expect(customProfileLabel(catalog, 'cab', types, 0)).toBe('#1 Acoustic Mic IR');
    expect(customProfileLabel(catalog, 'cab', types, 1)).toBe('#2 acoustic mic ir'); // case-insensitive match
  });

  it('leaves a unique custom name alone, and a factory slot unnamed', () => {
    expect(customProfileLabel(catalog, 'cab', types, 2)).toBe('My Cab IR');
    expect(customProfileLabel(catalog, 'cab', types, 3)).toBeNull();
  });
});
