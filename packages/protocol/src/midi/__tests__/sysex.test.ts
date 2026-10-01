import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildAmpModelSysEx,
  buildAmpProfileReadSysEx,
  buildBlockTypeSysEx,
  buildCabModelSysEx,
  buildChainOrderSysEx,
  buildGlobalSettingSysEx,
  buildGlobalSettingsPollSysEx,
  buildReadPresetSysEx,
  buildRenamePresetSysEx,
  buildSavePresetSysEx,
  buildSetParamValueSysEx,
  GLOBAL_SETTING_FIELD,
  isActiveSlotChangedPush,
  isAmpProfileResponse,
  isBlockOnOffChangedPush,
  isGlobalSettingsPush,
  isGlobalSettingsResponse,
  isReadPresetResponse,
  isSavePresetResponse,
  isSetParamValueResponse,
  parseActiveSlotChangedPush,
  resetSysExSequence,
  SYSEX_FIELD,
} from '../sysex';

/**
 * Byte-exact regression tests against real MIDI traffic captured (MIDI Monitor) between the
 * official ToneCommand app and a real NanoCore, isolating one action per capture — see
 * docs/MIDI_MAPPING_NOTES.md for the full write-up. The captured `<conn>` byte varied (0x00/
 * 0x02) across sessions with no apparent effect; we always send 0x00, so these examples reflect
 * that rather than the literal capture.
 */
function hex(s: string): number[] {
  return s.split(' ').map((b) => parseInt(b, 16));
}

describe('NanoCore SysEx builders (see docs/MIDI_MAPPING_NOTES.md)', () => {
  beforeEach(() => resetSysExSequence());

  it('builds an AMP model-select message matching a captured hardware example', () => {
    // Captured: 7d 4e 43 70 00 02 5b 00 6d 00 02 00 00 06 0f (AMP model 0x0f = "Pey51501")
    expect(buildAmpModelSysEx(0x0f)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x6d, 0x00, 0x02, 0x00, 0x00, 0x06, 0x0f, 0xf7,
    ]);
  });

  it('builds a CAB model-select message matching a captured hardware example', () => {
    // Captured: 7d 4e 43 70 02 02 0a 00 6d 00 02 00 00 07 13 (CAB model 0x13 = "Ran112B")
    expect(buildCabModelSysEx(0x13)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x6d, 0x00, 0x02, 0x00, 0x00, 0x07, 0x13, 0xf7,
    ]);
  });

  it('buildBlockTypeSysEx is the generic form of the AMP/CAB builders above', () => {
    resetSysExSequence();
    const generic = buildBlockTypeSysEx(SYSEX_FIELD.AMP_MODEL, 0x0f);
    resetSysExSequence();
    const specific = buildAmpModelSysEx(0x0f);
    expect(generic).toEqual(specific);
  });

  describe('buildRenamePresetSysEx (Rename.mmon, 3 real captures: 2/7/8-char names)', () => {
    it('a short name (fits in the first 6 bytes) needs no separator', () => {
      // Captured: 7d 4e 43 70 02 02 4f 01 6d 00 04 00 00 08 02 41 42
      expect(buildRenamePresetSysEx('AB')).toEqual([
        0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x6d, 0x00, 0x04, 0x00, 0x00, 0x08, 0x02, 0x41, 0x42,
        0xf7,
      ]);
    });

    it('a 7-char name gets a 0x00 separator inserted after the 6th logical byte', () => {
      // Captured: 7d 4e 43 70 00 02 78 00 6d 00 09 00 00 08 07 43 6c 6e 54 65 00 73 74
      expect(buildRenamePresetSysEx('ClnTest')).toEqual([
        0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x6d, 0x00, 0x09, 0x00, 0x00, 0x08, 0x07, 0x43, 0x6c,
        0x6e, 0x54, 0x65, 0x00, 0x73, 0x74, 0xf7,
      ]);
    });

    it("an 8-char name (the device's real cap) still needs only one separator", () => {
      // Captured: 7d 4e 43 70 02 02 55 01 6d 00 0a 00 00 08 08 4c 6f 6e 67 4e 00 61 6d 65
      expect(buildRenamePresetSysEx('LongName')).toEqual([
        0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x6d, 0x00, 0x0a, 0x00, 0x00, 0x08, 0x08, 0x4c, 0x6f,
        0x6e, 0x67, 0x4e, 0x00, 0x61, 0x6d, 0x65, 0xf7,
      ]);
    });

    it('truncates a name past the 8-char cap rather than sending an oversized field', () => {
      resetSysExSequence();
      const long = buildRenamePresetSysEx('WayTooLongAName');
      resetSysExSequence();
      const truncated = buildRenamePresetSysEx('WayTooLo');
      expect(long).toEqual(truncated);
    });

    it('an empty name is just a length-0 field, no separator possible', () => {
      resetSysExSequence();
      expect(buildRenamePresetSysEx('')).toEqual([
        0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x6d, 0x00, 0x02, 0x00, 0x00, 0x08, 0x00, 0xf7,
      ]);
    });
  });

  it('increments the sequence number on every call, wrapping at 128 (not 256)', () => {
    // seqLo is inserted into the frame as a raw data byte, never masked at the call site (unlike
    // every value byte here) — it must stay a valid 7-bit MIDI data byte (0-127) or the Web MIDI
    // API throws "contains a status byte" and silently drops the send. Found 2026-09-08 when the
    // real app's session-lifetime counter (never reset outside tests) finally exceeded 127.
    resetSysExSequence();
    const first = buildAmpModelSysEx(0);
    const second = buildAmpModelSysEx(0);
    expect(first[7]).toBe(0x01);
    expect(second[7]).toBe(0x02);

    for (let i = 0; i < 124; i++) buildAmpModelSysEx(0); // seq is now 126
    const atBoundary = buildAmpModelSysEx(0);
    expect(atBoundary[7]).toBe(0x7f);
    expect(atBoundary[7]).toBeLessThan(0x80); // never a value the Web MIDI API would reject

    const afterWrap = buildAmpModelSysEx(0);
    expect(afterWrap[7]).toBe(0x00); // wrapped, not 0x80
  });

  it('builds a chain-order message matching the official app dragging FX1 one step right (MoveFX1.mmon)', () => {
    // The 0x00 padding sits AFTER the 5th order element, not before the whole array — confirmed
    // 2026-09-08 against 7 independent real captures (FX1 dragged one step right at a time, each
    // diffed against the exact known resulting chain). See buildChainOrderSysEx's doc comment.
    // This is step 1 of that capture: EQ,FX1,MOD,FX2,AMP,CAB,DEL,REV (canonical values 7,0,5,1,2,3,4,6).
    expect(buildChainOrderSysEx([7, 0, 5, 1, 2, 3, 4, 6])).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x6d, 0x00, 0x0a, 0x00, 0x00, 0x05, 0x08, 0x07, 0x00,
      0x05, 0x01, 0x02, 0x00, 0x03, 0x04, 0x06, 0xf7,
    ]);
  });

  it('matches all 7 steps of the MoveFX1.mmon capture (FX1 dragged one step right, seven times)', () => {
    resetSysExSequence();
    const steps: [number[], number[]][] = [
      [[7, 0, 5, 1, 2, 3, 4, 6], [0x08, 0x07, 0x00, 0x05, 0x01, 0x02, 0x00, 0x03, 0x04, 0x06]],
      [[7, 5, 0, 1, 2, 3, 4, 6], [0x08, 0x07, 0x05, 0x00, 0x01, 0x02, 0x00, 0x03, 0x04, 0x06]],
      [[7, 5, 1, 0, 2, 3, 4, 6], [0x08, 0x07, 0x05, 0x01, 0x00, 0x02, 0x00, 0x03, 0x04, 0x06]],
      [[7, 5, 1, 2, 0, 3, 4, 6], [0x08, 0x07, 0x05, 0x01, 0x02, 0x00, 0x00, 0x03, 0x04, 0x06]],
      [[7, 5, 1, 2, 3, 0, 4, 6], [0x08, 0x07, 0x05, 0x01, 0x02, 0x03, 0x00, 0x00, 0x04, 0x06]],
      [[7, 5, 1, 2, 3, 4, 0, 6], [0x08, 0x07, 0x05, 0x01, 0x02, 0x03, 0x00, 0x04, 0x00, 0x06]],
      [[7, 5, 1, 2, 3, 4, 6, 0], [0x08, 0x07, 0x05, 0x01, 0x02, 0x03, 0x00, 0x04, 0x06, 0x00]],
    ];
    for (const [order, expectedValueBytes] of steps) {
      const bytes = buildChainOrderSysEx(order);
      expect(bytes.slice(15, 25)).toEqual(expectedValueBytes);
    }
  });

  it('masks out-of-range values to 7 bits rather than corrupting neighboring bytes', () => {
    const msg = buildAmpModelSysEx(255);
    expect(msg[14]).toBe(SYSEX_FIELD.AMP_MODEL); // fieldId untouched
    expect(msg[15]).toBe(255 & 0x7f); // value byte, masked
  });

  it('builds the read-preset requests matching a fresh MIDI-Monitor capture of the official app', () => {
    resetSysExSequence();
    // Captured (spying both directions, not just device->host): the official ToneCommand app's
    // own connection sequence. An earlier version of this builder got this wrong in two ways —
    // see readPage1Value's doc comment in sysex.ts — and a real device silently ignored it.
    expect(buildReadPresetSysEx(1)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x41, 0x00, 0x04, 0x00, 0x08, 0x28, 0x00, 0x00, 0x48, 0xf7,
    ]);
    expect(buildReadPresetSysEx(2)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x02, 0x00, 0x41, 0x00, 0x04, 0x00, 0x0a, 0x28, 0x48, 0x00, 0x48, 0xf7,
    ]);
  });

  it('isReadPresetResponse recognizes a captured page-1 reply', () => {
    // Captured: 7d 4e 43 71 40 02 54 00 41 00 00 4d 00 00 28 00 00 1d ... (opcode 0x41 at index 9)
    const captured = [
      0xf0, 0x7d, 0x4e, 0x43, 0x71, 0x40, 0x02, 0x54, 0x00, 0x41, 0x00, 0x00, 0x4d, 0x00, 0x00, 0x28, 0xf7,
    ];
    expect(isReadPresetResponse(captured)).toBe(true);
    expect(isReadPresetResponse(captured.slice(1, -1))).toBe(true); // stripped payload too
    expect(isReadPresetResponse(buildAmpModelSysEx(0))).toBe(false); // different opcode
  });

  it('isReadPresetResponse rejects the short unrelated opcode-0x41 "ping" seen on real hardware', () => {
    // Captured on real hardware: a frequent, unrelated 16-byte 0x41 message (some other status
    // ping, not investigated) that opcode-only matching used to mistake for a genuine reply,
    // resolving readPresetFromDevice with garbage before the real ~250-byte page ever arrived.
    const ping = [0xf0, 0x7d, 0x4e, 0x43, 0x71, 0x00, 0x02, 0x05, 0x00, 0x41, 0x00, 0x01, 0x00, 0x00, 0x00, 0xf7];
    expect(isReadPresetResponse(ping)).toBe(false);
  });

  it('buildReadPresetSysEx/isReadPresetResponse target a non-default slot when told to', () => {
    // Polling_2.mmon: the official app requesting slot 0x29 (41) right after a push announced the
    // active slot had changed from 0x28 (40) — see readPage1Value's doc comment.
    resetSysExSequence();
    expect(buildReadPresetSysEx(1, 0x29)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x01, 0x00, 0x41, 0x00, 0x04, 0x00, 0x08, 0x29, 0x00, 0x00, 0x48, 0xf7,
    ]);
    const reply28 = [0xf0, 0x7d, 0x4e, 0x43, 0x71, 0x40, 0x02, 0x54, 0x00, 0x41, 0x00, 0x00, 0x4d, 0x00, 0x00, 0x28, 0xf7];
    const reply29 = [0xf0, 0x7d, 0x4e, 0x43, 0x71, 0x40, 0x02, 0x54, 0x00, 0x41, 0x00, 0x00, 0x4d, 0x00, 0x00, 0x29, 0xf7];
    expect(isReadPresetResponse(reply28, 0x29)).toBe(false); // wrong slot for what was asked
    expect(isReadPresetResponse(reply29, 0x29)).toBe(true);
    expect(isReadPresetResponse(reply28)).toBe(true); // default slot still works
  });

  it('recognizes the active-slot-changed push (Polling_2.mmon: preset switched, then switched back)', () => {
    const toSlot41 = [0xf0, 0x7d, 0x4e, 0x43, 0x72, 0x00, 0x02, 0x60, 0x00, 0x01, 0x00, 0x29, 0xf7];
    const toSlot40 = [0xf0, 0x7d, 0x4e, 0x43, 0x72, 0x00, 0x02, 0x60, 0x00, 0x01, 0x00, 0x28, 0xf7];
    expect(isActiveSlotChangedPush(toSlot41)).toBe(true);
    expect(parseActiveSlotChangedPush(toSlot41)).toBe(41);
    expect(parseActiveSlotChangedPush(toSlot40)).toBe(40);
    expect(isActiveSlotChangedPush(buildAmpModelSysEx(0))).toBe(false); // different opcode
    expect(parseActiveSlotChangedPush(buildAmpModelSysEx(0))).toBeNull();
  });

  it('recognizes the block-on/off-changed push (Polling_2.mmon: MOD activated, FX1 deactivated)', () => {
    const modOn = [0xf0, 0x7d, 0x4e, 0x43, 0x72, 0x00, 0x02, 0x61, 0x00, 0x02, 0x00, 0x05, 0x01, 0xf7];
    const fx1Off = [0xf0, 0x7d, 0x4e, 0x43, 0x72, 0x00, 0x02, 0x61, 0x00, 0x02, 0x00, 0x00, 0x00, 0xf7];
    expect(isBlockOnOffChangedPush(modOn)).toBe(true);
    expect(isBlockOnOffChangedPush(fx1Off)).toBe(true);
    expect(isBlockOnOffChangedPush(buildAmpModelSysEx(0))).toBe(false); // different opcode
  });

  it('recognizes an AMP-profile response even for a short preset, but not the request echo', () => {
    // Real 0x63 response for slot 12 ("Smear") — 176 bytes, well under the old > 190 floor that
    // was silently rejecting shorter presets and stranding readPresetFromDevice on the stale slot.
    const slot12Response = hex(
      'f0 7d 4e 43 71 40 02 01 00 63 00 00 0c 00 00 03 0c 55 00 00 02 63 4d 4c 4c 3e 21 30 72 00 3e 00 00 03 00 00 00 60 3f 00 00 00 3f 4d 4c 60 4c 3f 01 00 05 4d 4c 58 4c 3f 5c 0f 42 3e 4d 11 4c 0c 3f 52 38 5e 3f 03 4d 4c 4c 3f 01 00 02 37 57 23 70 3e 4d 4c 0c 30 3f 01 01 03 1a 19 19 0c 3e 6a 3c 74 3e 00 00 01 00 3e 00 00 02 00 00 00 00 3f 00 00 00 3f 01 54 01 05 45 20 30 3e 2e 08 47 61 3e 76 28 5c 3f 74 29 5c 0f 3e 4d 4c 4c 00 3e 00 00 04 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 08 00 00 01 02 03 04 05 06 00 07 f7',
    );
    expect(isAmpProfileResponse(slot12Response)).toBe(true);
    expect(isAmpProfileResponse(buildAmpProfileReadSysEx())).toBe(false); // the 13-byte request
  });

  it('builds a save-to-slot request matching a real bidirectional capture (Save.mmon)', () => {
    // Captured 2026-09-12, official app saving to slot 0x29 (display 42):
    //   To Nanocore:   7d 4e 43 70 00 02 65 00 46 00 01 00 00 29        (16 bytes with F0/F7)
    //   From Nanocore: 7d 4e 43 71 00 02 65 00 46 00 00 01 00 00 29     (17 bytes with F0/F7)
    // An earlier attempt mistook the *reply* shape (one extra leading 0x00) for the request — every
    // device-output-only capture used until then structurally couldn't see host->device traffic, so
    // it had only ever recorded the device's own save-completed acknowledgement. Replaying that
    // ack shape back as a command was naturally rejected ("bad payload") every time.
    for (let i = 0; i < 0x64; i++) buildAmpModelSysEx(0); // advance seq to match the capture's 0x65
    expect(buildSavePresetSysEx(0x29)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x65, 0x00, 0x46, 0x00, 0x01, 0x00, 0x00, 0x29, 0xf7,
    ]);
  });

  it('isSavePresetResponse recognizes the captured reply and checks the slot', () => {
    const reply = hex('f0 7d 4e 43 71 00 02 65 00 46 00 00 01 00 00 29 f7');
    expect(isSavePresetResponse(reply, 0x29)).toBe(true);
    expect(isSavePresetResponse(reply, 0x28)).toBe(false); // wrong slot
    expect(isSavePresetResponse(reply.slice(1, -1), 0x29)).toBe(true); // stripped payload too
    expect(isSavePresetResponse(buildSavePresetSysEx(0x29), 0x29)).toBe(false); // the request itself
  });

  it('builds a set-param-value message matching a real capture of the official app dragging REV Decay (P44.mmon)', () => {
    // Captured 2026-09-12: blockId 6 (REV, per CHAIN_ORDER_BLOCK_IDS), paramIndex 0 (Decay, its
    // type's first param), value 0.1678... (normalized — REV Spring's Decay is 0-12s, so ~2.0s).
    //   To Nanocore: 7d 4e 43 70 02 02 13 00 6d 00 07 00 18 01 06 00 3f 58 2b 3e
    // (captured with conn=0x02; we always send 0x00, same caveat as buildSavePresetSysEx's test)
    for (let i = 0; i < 0x12; i++) buildAmpModelSysEx(0); // advance seq to match the capture's 0x13
    expect(buildSetParamValueSysEx(0x06, 0x00, 0.16781900823116302)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x13, 0x00, 0x6d, 0x00, 0x07, 0x00, 0x18, 0x01, 0x06, 0x00, 0x3f, 0x58, 0x2b, 0x3e, 0xf7,
    ]);
  });

  it('isSetParamValueResponse recognizes the captured reply and checks blockId/paramIndex', () => {
    // From Nanocore, same capture: 7d 4e 43 71 02 02 13 00 6d 00 00 07 00 00 01 06 00 31 08 2c 00 3e
    const reply = hex('f0 7d 4e 43 71 02 02 13 00 6d 00 00 07 00 00 01 06 00 31 08 2c 00 3e f7');
    expect(isSetParamValueResponse(reply, 0x06, 0x00)).toBe(true);
    expect(isSetParamValueResponse(reply, 0x05, 0x00)).toBe(false); // wrong blockId
    expect(isSetParamValueResponse(reply, 0x06, 0x01)).toBe(false); // wrong paramIndex
    expect(isSetParamValueResponse(reply.slice(1, -1), 0x06, 0x00)).toBe(true); // stripped payload too
  });

  it('builds a global-settings poll request matching a real capture (Global.mmon)', () => {
    // Captured 2026-09-12: 7d 4e 43 70 00 02 6e 00 65 00 00 00 — sent every ~3s while ToneCommand's
    // Global Settings screen is open, same cadence as the 0x68 ping.
    for (let i = 0; i < 0x6d; i++) buildAmpModelSysEx(0); // advance seq to match the capture's 0x6e
    expect(buildGlobalSettingsPollSysEx()).toEqual([0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x6e, 0x00, 0x65, 0x00, 0x00, 0x00, 0xf7]);
  });

  it('isGlobalSettingsResponse recognizes a poll reply but not the request itself', () => {
    // From Nanocore, same capture, the very first poll reply (before anything was changed):
    const reply = hex('f0 7d 4e 43 71 00 02 6e 00 65 00 00 07 00 00 01 00 01 00 64 64 00 00 f7');
    expect(isGlobalSettingsResponse(reply)).toBe(true);
    expect(isGlobalSettingsResponse(reply.slice(1, -1))).toBe(true); // stripped payload too
    expect(isGlobalSettingsResponse(buildGlobalSettingsPollSysEx())).toBe(false); // the request (len byte differs)
  });

  it('builds a global-setting-set message matching a real capture of the official app turning Loopback on', () => {
    // Captured with conn=0x02 (we always send 0x00, same caveat noted on buildSavePresetSysEx):
    //   To Nanocore:   7d 4e 43 70 02 02 03 00 66 00 02 00 00 02 01
    //   From Nanocore: 7d 4e 43 71 02 02 03 00 66 00 00 07 00 00 01 00 01 00 64 64 00 00
    for (let i = 0; i < 0x02; i++) buildAmpModelSysEx(0); // advance seq to match the capture's 0x03
    expect(buildGlobalSettingSysEx(GLOBAL_SETTING_FIELD.LOOPBACK, 1)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x03, 0x00, 0x66, 0x00, 0x02, 0x00, 0x00, 0x02, 0x01, 0xf7,
    ]);
    const reply = hex('f0 7d 4e 43 71 02 02 03 00 66 00 00 07 00 00 01 00 01 00 64 64 00 00 f7');
    expect(isGlobalSettingsResponse(reply)).toBe(true);
  });

  it('builds a global-setting-set message matching a real capture of Input Gain going negative (signed encoding)', () => {
    // Captured: 7d 4e 43 70 02 02 55 00 66 00 02 00 00 04 7b — Input Gain set to -5dB, encoded as
    // 0x7b (123) via 7-bit two's complement (123 - 128 = -5). GLOBAL_SETTING_FIELD.INPUT_GAIN is
    // the fieldId (4); the caller passes the already-encoded signed byte as `value`.
    for (let i = 0; i < 0x54; i++) buildAmpModelSysEx(0); // advance seq to match the capture's 0x55
    expect(buildGlobalSettingSysEx(GLOBAL_SETTING_FIELD.INPUT_GAIN, 0x7b)).toEqual([
      0xf0, 0x7d, 0x4e, 0x43, 0x70, 0x00, 0x02, 0x55, 0x00, 0x66, 0x00, 0x02, 0x00, 0x00, 0x04, 0x7b, 0xf7,
    ]);
  });

  it('isGlobalSettingsPush recognizes the unsolicited push, a different (shorter) shape than the poll/set response', () => {
    // From Nanocore, dir=0x72, right after the Input Gain=-5 send above:
    const push = hex('f0 7d 4e 43 72 00 02 55 00 07 00 01 00 02 01 7b 64 64 00 f7');
    expect(isGlobalSettingsPush(push)).toBe(true);
    expect(isGlobalSettingsResponse(push)).toBe(false); // wrong shape for the OTHER checker
  });
});
