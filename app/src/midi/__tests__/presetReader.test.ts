import { describe, expect, it } from 'vitest';
import {
  decodeLiveBlockParams,
  decodePresetParamValues,
  parseBlockOnOffChangedPush,
  parseChainOrderFromAmpProfile,
  parseChainOrderFromPreset,
  parseActiveSlotFromAmpProfile,
  parseGlobalSettingsPush,
  parseGlobalSettingsResponse,
  parseParamValueChangedPush,
  parsePresetName,
  parseReadPresetResponse,
  unpack7BitSafe,
} from '../presetReader';

/**
 * Byte-exact regression tests against real MIDI traffic captured live (direct CoreMIDI listen,
 * not MIDI Monitor — see docs/MIDI_MAPPING_NOTES.md) from a real NanoCore's opcode-`0x41` read
 * response, one block changed + saved + reconnected at a time. Each pair below is a genuine
 * page-1 + page-2 response captured this way; nothing here is synthesized.
 */

function hex(s: string): number[] {
  return s.split(' ').map((b) => parseInt(b, 16));
}

const PAGE1_GATE_SCREAM_FLANGER_DUCK_SPRING = hex(
  'f0 7d 4e 43 71 40 02 54 00 41 00 00 4d 00 00 28 00 00 1d 01 01 00 02 07 00 02 10 70 72 00 65 73 65 74 00 00 00 00 00 00 00 60 13 03 40 00 03 08 00 01 02 03 07 00 05 04 06 10 0f 00 07 30 00 01 02 00 4d 4c 4c 18 3e 01 21 30 72 3e 10 00 14 01 08 00 00 03 00 00 00 00 00 3f 01 00 00 18 00 3f 02 4d 4c 4c 3f 00 10 1e 02 01 00 01 05 08 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 03 4d 4c 4c 3f 10 0f 03 00 02 00 01 02 00 00 00 20 00 00 01 00 00 00 3f 00 10 19 04 05 02 01 04 46 00 1a 19 19 3e 01 53 32 4d 62 3e 02 4d 4c 0c 1c 3f 03 4d 4c 4c 3e 10 00 14 05 04 02 01 03 00 63 63 25 1b 3e 01 67 7b 20 49 3f 02 33 33 33 3e 00 10 1e 06 03 07 01 05 40 00 0c 02 2b 3e 01 4d 31 4c 4c 3e 02 01 15 03 0c 3f 03 4d 4c 4c 3e 04 00 00 00 00 f7',
);
const PAGE2_EQ8 = hex(
  'f0 7d 4e 43 71 00 02 55 00 41 00 00 46 04 00 28 48 00 09 01 3f 00 10 32 07 06 02 01 09 00 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 00 00 00 00 3f 05 00 00 00 00 3f 06 00 00 00 3f 00 07 00 00 00 3f 08 00 00 00 00 3f 22 01 64 20 00 01 0b 21 01 04 24 01 00 1e f7',
);

describe('parseReadPresetResponse (see docs/MIDI_MAPPING_NOTES.md)', () => {
  it('decodes a capture mixing normal- and escape-form tags: FX1=gate, FX2=scream (escape), MOD=flanger (escape), DEL=duck, REV=spring, EQ=eq8', () => {
    expect(parseReadPresetResponse(PAGE1_GATE_SCREAM_FLANGER_DUCK_SPRING, PAGE2_EQ8)).toEqual({
      fx1TypeId: 0, // gate
      fx2TypeId: 0, // scream
      modTypeId: 2, // flanger
      delTypeId: 2, // duck
      revTypeId: 6, // spring (raw 7, -1 correction — see file header caveat)
      eqTypeId: 2, // eq8 (9 entries -> 8 bands)
      modOn: true,
      delOn: true,
      revOn: true,
      fx1On: true,
      ampOn: true,
      cabOn: true,
      eqOn: true,
      ampModelIndex: 11, // MesR1 (12th in the list)
      cabModelIndex: 4, // FdTR212 (5th in the list)
    });
  });

  it('decodes EQ switched off (type held fixed at eq8) — pins down eqOn at content[2]', () => {
    const page1 = hex(
      'f0 7d 4e 43 71 40 02 07 00 41 00 00 4d 00 00 28 00 00 09 01 01 00 02 07 00 02 10 70 72 00 65 73 65 74 00 00 00 00 00 00 00 60 13 03 40 00 03 08 07 05 01 02 03 00 04 06 00 10 0f 00 07 30 00 01 02 00 4d 4c 4c 18 3e 01 21 30 72 3e 10 00 14 01 08 00 00 03 00 00 00 00 00 3f 01 00 00 18 00 3f 02 4d 4c 4c 3f 00 10 1e 02 01 00 01 05 08 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 03 4d 4c 4c 3f 10 0f 03 00 02 00 01 02 00 00 00 20 00 00 01 00 00 00 3f 00 10 19 04 05 02 01 04 46 00 1a 19 19 3e 01 53 32 4d 62 3e 02 4d 4c 0c 1c 3f 03 4d 4c 4c 3e 10 00 14 05 04 02 00 03 00 63 63 25 1b 3e 01 67 7b 20 49 3f 02 33 33 33 3e 00 10 1e 06 03 07 01 05 40 00 0c 02 2b 3e 01 4d 31 4c 4c 3e 02 01 15 03 0c 3f 03 4d 4c 4c 3e 04 00 00 00 00 f7',
    );
    const page2Off = hex(
      'f0 7d 4e 43 71 00 02 08 00 41 00 00 46 04 00 28 48 00 09 01 3f 00 10 32 07 06 02 00 09 00 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 00 00 00 00 3f 05 00 00 00 00 3f 06 00 00 00 3f 00 07 00 00 00 3f 08 00 00 00 00 3f 22 01 64 20 00 01 0b 21 01 00 24 01 00 1e f7',
    );
    const page2On = hex(
      'f0 7d 4e 43 71 00 02 05 00 41 00 00 46 04 00 28 48 00 09 01 3f 00 10 32 07 06 02 01 09 00 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 00 00 00 00 3f 05 00 00 00 00 3f 06 00 00 00 3f 00 07 00 00 00 3f 08 00 00 00 00 3f 22 01 64 20 00 01 0b 21 01 00 24 01 00 1e f7',
    );

    const off = parseReadPresetResponse(page1, page2Off);
    const on = parseReadPresetResponse(page1, page2On);
    expect(off.eqOn).toBe(false);
    expect(on.eqOn).toBe(true);
    expect(off.eqTypeId).toBe(2); // still eq8 — only on/off changed
    expect(on.eqTypeId).toBe(2);
  });

  it('decodes MOD switched off (type held fixed at flanger) — the capture that pinned down the escape-form tag length rule', () => {
    const page1 = hex(
      'f0 7d 4e 43 71 40 02 54 00 41 00 00 4d 00 00 28 00 00 09 01 01 00 02 07 00 02 10 70 72 00 65 73 65 74 00 00 00 00 00 00 00 60 13 03 40 00 03 08 00 01 02 03 07 00 05 04 06 10 0f 00 07 30 00 01 02 00 4d 4c 4c 18 3e 01 21 30 72 3e 10 00 14 01 08 00 00 03 00 00 00 00 00 3f 01 00 00 18 00 3f 02 4d 4c 4c 3f 00 10 1e 02 01 00 01 05 08 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 03 4d 4c 4c 3f 10 0f 03 00 02 00 01 02 00 00 00 20 00 00 01 00 00 00 3f 00 10 19 04 05 02 01 04 46 00 1a 19 19 3e 01 53 32 4d 62 3e 02 4d 4c 0c 1c 3f 03 4d 4c 4c 3e 10 00 14 05 04 02 00 03 00 63 63 25 1b 3e 01 67 7b 20 49 3f 02 33 33 33 3e 00 10 1e 06 03 07 01 05 40 00 0c 02 2b 3e 01 4d 31 4c 4c 3e 02 01 15 03 0c 3f 03 4d 4c 4c 3e 04 00 00 00 00 f7',
    );

    const result = parseReadPresetResponse(page1, PAGE2_EQ8);
    expect(result.modTypeId).toBe(2); // still flanger — only on/off changed
    expect(result.modOn).toBe(false);
  });

  it('reads AMP/CAB model indices from the page-2 footer, independent of page-1 content', () => {
    // Same page 1 as the first test but CAB changed from FdTR212 to Bog412A — confirms AMP/CAB
    // round-trip purely through the page-2 footer, with zero page-1 impact.
    const page2 = hex(
      'f0 7d 4e 43 71 00 02 55 00 41 00 00 46 04 00 28 48 00 09 01 3f 00 10 32 07 06 02 01 09 00 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 00 00 00 00 3f 05 00 00 00 00 3f 06 00 00 00 3f 00 07 00 00 00 3f 08 00 00 00 00 3f 22 01 64 20 00 01 0b 21 01 00 24 01 00 1e f7',
    );

    const result = parseReadPresetResponse(PAGE1_GATE_SCREAM_FLANGER_DUCK_SPRING, page2);
    expect(result.ampModelIndex).toBe(11); // MesR1, unchanged
    expect(result.cabModelIndex).toBe(0); // Bog412A (1st in the list)
  });

  it('decodes an earlier capture with FX1=auto gate, MOD=chorus_ii, DEL=digital, REV=shimmer, EQ=eq8', () => {
    const page1 = hex(
      'f0 7d 4e 43 71 40 02 54 00 41 00 00 4d 00 00 28 00 00 09 01 01 00 02 07 00 02 10 70 72 00 65 73 65 74 00 00 00 00 00 00 00 60 13 03 40 00 03 08 00 01 02 03 07 00 05 04 06 10 0f 00 07 00 01 01 02 00 00 00 00 10 3f 01 1d 5a 24 3e 10 00 14 01 08 02 00 03 00 00 00 00 00 3f 01 00 00 18 00 3f 02 4d 4c 4c 3f 00 10 1e 02 01 00 01 05 08 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 03 4d 4c 4c 3f 10 0f 03 00 02 00 01 02 00 00 00 20 00 00 01 00 00 00 3f 00 10 14 04 05 01 01 03 46 00 76 00 08 3e 01 11 62 76 2c 3e 02 0a 57 23 00 3e 10 19 05 04 0b 01 0c 04 00 1a 19 19 3e 01 64 66 66 66 3e 02 1a 19 01 19 3e 03 00 00 00 3f 00 10 1e 06 03 05 01 05 0a 00 7d 62 09 3e 01 00 10 00 00 00 02 61 7a 14 00 3f 03 00 00 40 3f 04 00 00 00 00 f7',
    );
    const page2 = hex(
      'f0 7d 4e 43 71 00 02 55 00 41 00 00 46 04 00 28 48 00 09 01 3f 00 10 32 07 06 02 01 09 00 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 00 00 00 00 3f 05 00 00 00 00 3f 06 00 00 00 3f 00 07 00 00 00 3f 08 00 00 00 00 3f 22 01 64 20 00 01 06 21 01 04 24 01 00 1e f7',
    );

    const result = parseReadPresetResponse(page1, page2);
    expect(result.fx1TypeId).toBe(1); // auto_gate
    expect(result.modTypeId).toBe(11); // chorus_ii (normal form here, not escape)
    expect(result.delTypeId).toBe(1); // digital
    expect(result.revTypeId).toBe(4); // shimmer (raw 5, -1 correction)
    expect(result.eqTypeId).toBe(2); // eq8
    expect(result.ampModelIndex).toBe(6); // Hiw103 (7th in the list)
    expect(result.cabModelIndex).toBe(4); // FdTR212 (5th in the list)
  });

  it('decodes MOD=chorus (escape x=15) without corrupting REV/EQ — regression for the off-by-one overshoot bug', () => {
    // MODtype.mmon: MOD is chorus here. Before this was fixed, x=15's content length was computed
    // as x+3=18, one byte too many — REV's real 0x10 marker sits one byte earlier, so the forward-
    // only marker search skipped past it and resynced on a later, unrelated 0x10, corrupting
    // revTypeId (read as ~124, nonsense) and everything after it. Not a synthetic case: this exact
    // MOD shape (chorus, x=15) was present, silently corrupting the same fields, in every real
    // capture this session where MOD's type happened to be chorus.
    const page1 = hex(
      'f0 7d 4e 43 71 40 02 08 00 41 00 00 4d 00 00 28 00 00 04 01 01 00 02 07 00 02 10 70 72 00 65 73 65 74 00 00 00 00 00 00 00 60 13 03 40 00 03 08 00 01 02 03 04 00 05 06 07 10 0f 00 07 30 00 00 02 00 4d 4c 4c 18 3e 01 21 30 72 3e 10 00 14 01 08 00 01 03 00 00 00 00 00 3f 01 00 00 18 00 3f 02 4d 4c 4c 3f 00 10 1e 02 01 00 00 05 08 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 04 03 4d 4c 4c 3f 10 0f 03 00 02 00 00 02 00 00 00 20 00 00 01 00 00 00 3f 00 10 19 04 05 00 01 04 44 00 0a 57 23 3e 01 2e 00 47 01 3f 02 66 66 26 18 3f 03 5c 0f 42 3e 10 00 0f 05 04 00 01 02 00 03 3e 1f 1a 3f 01 00 00 01 00 3f 10 1e 06 03 06 18 01 05 00 4d 4c 0c 3f 40 01 00 00 40 3f 02 4d 53 4c 4c 3e 03 38 1e 05 00 3e 04 00 00 00 3f 10 00 32 07 06 f7',
    );
    const page2 = hex(
      'f0 7d 4e 43 71 00 02 09 00 41 00 00 41 04 00 28 48 00 04 01 02 00 00 09 00 00 00 00 3f 00 01 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 00 3f 04 00 00 00 3f 05 00 00 00 00 3f 06 00 00 00 00 3f 07 00 00 00 3f 00 08 00 00 00 3f 22 01 48 64 20 01 7f 21 01 7f 00 24 01 1e f7',
    );

    const result = parseReadPresetResponse(page1, page2);
    expect(result.modTypeId).toBe(0); // chorus
    expect(result.revTypeId).toBe(5); // in-range, not the ~124 garbage the overshoot used to produce
    // ampModelIndex/cabModelIndex/eqTypeId are a SEPARATE, still-unresolved gap in this same
    // capture (AMP and CAB are both off here — ampOn/cabOn below confirm it — and the page-2
    // footer's shape differs when they are, breaking the `0x21 0x01 <cab> 0x24 0x01` anchor this
    // parser looks for). Not addressed by this fix; asserted here so a future fix's regression
    // shows up as a value change here, not a silent one.
    expect(result.ampModelIndex).toBeNull();
    expect(result.cabModelIndex).toBeNull();
    expect(result.eqTypeId).toBeNull();
    expect(result.fx1On).toBe(false);
    expect(result.ampOn).toBe(false);
    expect(result.cabOn).toBe(false);
    expect(result.eqOn).toBe(true);
  });

  it('accepts already-stripped payloads (no F0/F7) the same as full messages', () => {
    const stripped = PAGE1_GATE_SCREAM_FLANGER_DUCK_SPRING.slice(1, -1);
    expect(parseReadPresetResponse(stripped, PAGE2_EQ8)).toEqual(
      parseReadPresetResponse(PAGE1_GATE_SCREAM_FLANGER_DUCK_SPRING, PAGE2_EQ8),
    );
  });
});

describe('parsePresetName (see docs/MIDI_MAPPING_NOTES.md)', () => {
  // Real opcode-0x41 page-1 payloads read from a real NanoCore via direct python-rtmidi queries —
  // factory slots 0 ("ClnArp"), 3 ("EpicSolo", longest factory name), 39 ("BassFuzz"). The name
  // sits after the 02 07 00 02 10 anchor as [c0][c1] 00 [rest], null-padded to a fixed width.
  const SLOT0_CLNARP = hex(
    'f0 7d 4e 43 71 40 02 01 00 41 00 00 4d 10 00 00 00 00 7f 00 01 00 02 07 00 02 10 43 6c 00 6e 41 72 70 00 00 00 00 00 00 00 60 13 03 40 00 03 08 00 01 f7',
  );
  const SLOT3_EPICSOLO = hex(
    'f0 7d 4e 43 71 40 02 01 00 41 00 00 4d 10 00 03 00 00 66 00 01 00 02 07 00 02 10 45 70 00 69 63 53 6f 6c 6f 00 00 00 00 00 60 13 03 40 00 03 08 00 01 f7',
  );
  const SLOT39_BASSFUZZ = hex(
    'f0 7d 4e 43 71 40 02 01 00 41 00 00 4d 00 00 27 00 00 09 01 01 00 02 07 00 02 10 42 61 00 73 73 46 75 7a 7a 00 00 00 00 00 60 13 03 40 00 03 08 00 01 f7',
  );

  it('decodes real factory preset names byte-exact', () => {
    expect(parsePresetName(SLOT0_CLNARP)).toBe('ClnArp');
    expect(parsePresetName(SLOT3_EPICSOLO)).toBe('EpicSolo');
    expect(parsePresetName(SLOT39_BASSFUZZ)).toBe('BassFuzz');
  });

  it('decodes the name "preset" from the older PAGE1 fixture (that slot was named "preset")', () => {
    expect(parsePresetName(PAGE1_GATE_SCREAM_FLANGER_DUCK_SPRING)).toBe('preset');
  });

  it('accepts an already-stripped payload the same as the full message', () => {
    expect(parsePresetName(SLOT0_CLNARP.slice(1, -1))).toBe('ClnArp');
  });

  it('returns null when the anchor is absent (e.g. a page-2 payload)', () => {
    expect(parsePresetName(PAGE2_EQ8)).toBeNull();
    expect(parsePresetName(hex('f0 7d 4e 43 71 00 f7'))).toBeNull();
  });
});

describe('parseChainOrderFromAmpProfile (see docs/MIDI_MAPPING_NOTES.md)', () => {
  // Captured live (MoveFX1.mmon, MIDI Monitor) as the very first opcode-0x63 AMP-profile read of
  // a connection sequence, before any chain-order edit — the device's chain at that moment was
  // confirmed (by the user, reading the device's own screen) to be FX1,EQ,MOD,FX2,AMP,CAB,DEL,REV.
  const AMP_PROFILE_FX1_EQ_MOD_FX2_AMP_CAB_DEL_REV = hex(
    'f0 7d 4e 43 71 40 02 4a 00 63 00 00 28 00 00 03 28 64 01 00 02 63 4d 4c 4c 3e 21 30 72 00 3e 00 00 03 00 00 00 60 3f 00 00 00 3f 4d 4c 00 4c 3f 01 00 05 00 00 01 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 03 4d 4c 4c 3f 01 00 02 40 00 00 00 00 00 00 00 30 3f 01 02 04 1a 19 19 6a 3e 53 4d 62 3e 4d 4c 1c 0c 3f 4d 4c 4c 3e 00 4c 02 03 63 25 1b 3e 67 21 7b 49 3f 33 33 33 3e 00 01 07 05 0c 02 2b 3e 33 4d 4c 4c 3e 01 15 03 06 3f 4d 4c 4c 3e 00 00 00 00 3f 01 02 09 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 08 00 00 07 05 01 02 03 04 00 06 f7',
  );

  it('decodes the chain order from the footer, matching the confirmed real chain', () => {
    expect(parseChainOrderFromAmpProfile(AMP_PROFILE_FX1_EQ_MOD_FX2_AMP_CAB_DEL_REV)).toEqual([
      'fx1',
      'eq',
      'mod',
      'fx2',
      'amp',
      'cab',
      'del',
      'rev',
    ]);
  });

  it('accepts an already-stripped payload (no F0/F7) the same as the full message', () => {
    const stripped = AMP_PROFILE_FX1_EQ_MOD_FX2_AMP_CAB_DEL_REV.slice(1, -1);
    expect(parseChainOrderFromAmpProfile(stripped)).toEqual(
      parseChainOrderFromAmpProfile(AMP_PROFILE_FX1_EQ_MOD_FX2_AMP_CAB_DEL_REV),
    );
  });

  it('returns null for a response too short to contain the footer', () => {
    expect(parseChainOrderFromAmpProfile(hex('f0 7d 4e 43 71 00 f7'))).toBeNull();
  });

  it('returns null when the footer marker/padding bytes are not in the expected shape', () => {
    const corrupted = [...AMP_PROFILE_FX1_EQ_MOD_FX2_AMP_CAB_DEL_REV];
    // The footer's leading 0x08 marker sits 11 bytes before the trailing F7 — clobber it.
    corrupted[corrupted.length - 1 - 11] = 0x99;
    expect(parseChainOrderFromAmpProfile(corrupted)).toBeNull();
  });
});

describe('parseChainOrderFromPreset (see docs/MIDI_MAPPING_NOTES.md)', () => {
  // Real opcode-0x41 page-1 head from slot 25 "Dot8th" — the 0x63 footer decode returns null for
  // this preset, so its chain order (fx1,eq,fx2,mod,del,rev,amp,cab) has to come from here.
  const DOT8TH_HEAD = hex(
    'f0 7d 4e 43 71 40 02 01 00 41 00 00 4d 00 00 19 00 00 13 01 01 00 02 07 00 02 10 44 6f 00 74 38 74 68 00 00 00 00 00 00 00 60 13 03 40 00 03 08 00 07 01 05 04 00 06 02 03 10 23 00 07 30 03 01 f7',
  );

  it('decodes the chain order from the 0x41 param-stream header', () => {
    expect(parseChainOrderFromPreset(DOT8TH_HEAD)).toEqual([
      'fx1', 'eq', 'fx2', 'mod', 'del', 'rev', 'amp', 'cab',
    ]);
  });

  it('returns null when the stream / permutation is missing', () => {
    expect(parseChainOrderFromPreset(hex('f0 7d 4e 43 71 00 f7'))).toBeNull();
  });
});

describe('parseActiveSlotFromAmpProfile (see docs/MIDI_MAPPING_NOTES.md)', () => {
  // Real 0x63 response captured right after a Program Change to slot 12 ("Smear") on real
  // hardware — device on/off (AMP/CAB/DEL/REV) all confirmed against this.
  const SLOT12 = hex(
    'f0 7d 4e 43 71 40 02 01 00 63 00 00 0c 00 00 03 0c 55 00 00 02 63 4d 4c 4c 3e 21 30 72 00 3e 00 00 03 00 00 00 60 3f 00 00 00 3f 4d 4c 60 4c 3f 01 00 05 4d 4c 58 4c 3f 5c 0f 42 3e 4d 11 4c 0c 3f 52 38 5e 3f 03 4d 4c 4c 3f 01 00 02 37 57 23 70 3e 4d 4c 0c 30 3f 01 01 03 1a 19 19 0c 3e 6a 3c 74 3e 00 00 01 00 3e 00 00 02 00 00 00 00 3f 00 00 00 3f 01 54 01 05 45 20 30 3e 2e 08 47 61 3e 76 28 5c 3f 74 29 5c 0f 3e 4d 4c 4c 00 3e 00 00 04 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 08 00 00 01 02 03 04 05 06 00 07 f7',
  );

  it('reads the loaded slot number from the 0x63 header', () => {
    expect(parseActiveSlotFromAmpProfile(SLOT12)).toBe(12);
    expect(parseActiveSlotFromAmpProfile(SLOT12.slice(1, -1))).toBe(12); // already stripped
  });

  it('returns null for a too-short or out-of-range response', () => {
    expect(parseActiveSlotFromAmpProfile(hex('f0 7d 4e 43 71 00 f7'))).toBeNull();
  });
});

describe('parseParamValueChangedPush (see docs/MIDI_MAPPING_NOTES.md)', () => {
  // MODtype.mmon: turning MOD's type encoder fired a burst of these — captured live, all real.
  const MOD_PARAM0 = hex('f0 7d 4e 43 72 00 02 62 00 06 00 05 00 04 66 66 66 3e f7');
  const MOD_PARAM1 = hex('f0 7d 4e 43 72 00 02 62 00 06 00 05 01 03 4d 4c 0c 3f f7');
  const MOD_PARAM2 = hex('f0 7d 4e 43 72 00 02 62 00 06 00 05 02 00 00 00 00 3f f7');
  const MOD_PARAM3 = hex('f0 7d 4e 43 72 00 02 62 00 06 00 05 03 00 66 66 26 3f f7');

  it('decodes blockId/paramIndex/value from real captured examples', () => {
    expect(parseParamValueChangedPush(MOD_PARAM0)).toEqual({ blockId: 'mod', paramIndex: 0, x: 4, value: expect.closeTo(0.225, 3) });
    expect(parseParamValueChangedPush(MOD_PARAM1)).toEqual({ blockId: 'mod', paramIndex: 1, x: 3, value: expect.closeTo(0.548, 3) });
    expect(parseParamValueChangedPush(MOD_PARAM2)).toEqual({ blockId: 'mod', paramIndex: 2, x: 0, value: 0.5 });
    expect(parseParamValueChangedPush(MOD_PARAM3)).toEqual({ blockId: 'mod', paramIndex: 3, x: 0, value: expect.closeTo(0.65, 3) });
  });

  it('every real captured example decodes into the normalized 0.0-1.0 range', () => {
    // All 13 messages from the MODtype.mmon burst, not just the 4 above.
    const raw = [
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 00 04 66 66 66 3e f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 01 03 4d 4c 0c 3f f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 02 00 00 00 00 3f f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 03 00 66 66 26 3f f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 00 03 63 25 1b 3e f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 01 02 48 61 1a 3f f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 02 07 4d 4c 4c 3e f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 00 03 1a 19 19 3e f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 01 04 66 66 66 3e f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 02 07 1a 19 19 3e f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 03 00 00 00 00 3f f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 00 03 3e 1f 1a 3f f7',
      'f0 7d 4e 43 72 00 02 62 00 06 00 05 01 04 00 00 00 3f f7',
    ];
    for (const h of raw) {
      const parsed = parseParamValueChangedPush(hex(h));
      expect(parsed).not.toBeNull();
      expect(parsed!.blockId).toBe('mod');
      expect(parsed!.value).toBeGreaterThanOrEqual(0);
      expect(parsed!.value).toBeLessThanOrEqual(1);
    }
  });

  it('returns null for a different opcode', () => {
    expect(parseParamValueChangedPush(hex('f0 7d 4e 43 71 00 02 05 00 41 00 01 00 00 00 f7'))).toBeNull();
  });

  it('accepts an already-stripped payload (no F0/F7) the same as the full message', () => {
    const stripped = MOD_PARAM0.slice(1, -1);
    expect(parseParamValueChangedPush(stripped)).toEqual(parseParamValueChangedPush(MOD_PARAM0));
  });
});

describe('parseBlockOnOffChangedPush (see docs/MIDI_MAPPING_NOTES.md)', () => {
  // Captured live (Polling_2.mmon): activating MOD then, later, deactivating FX1 — with only
  // ToneCommand idling (no other edit source), so these pushes unambiguously reflect the pedal.
  const MOD_ON = hex('f0 7d 4e 43 72 00 02 61 00 02 00 05 01 f7');
  const FX1_OFF = hex('f0 7d 4e 43 72 00 02 61 00 02 00 00 00 f7');

  it('decodes which block changed and its new state', () => {
    expect(parseBlockOnOffChangedPush(MOD_ON)).toEqual({ blockId: 'mod', on: true });
    expect(parseBlockOnOffChangedPush(FX1_OFF)).toEqual({ blockId: 'fx1', on: false });
  });

  it('returns null for a different opcode', () => {
    expect(parseBlockOnOffChangedPush(hex('f0 7d 4e 43 71 00 02 05 00 41 00 01 00 00 00 f7'))).toBeNull();
  });
});

describe('unpack7BitSafe (see docs/MIDI_MAPPING_NOTES.md)', () => {
  it('restores bit 7 using the preceding header byte', () => {
    // header 0x03 = bits 0 and 1 set -> restore bit 7 on the first two of the next 7 bytes.
    expect(unpack7BitSafe([0x03, 0x36, 0x73, 0x1d, 0x00, 0x3f, 0x01, 0x00])).toEqual([
      0xb6, 0xf3, 0x1d, 0x00, 0x3f, 0x01, 0x00,
    ]);
  });

  it('handles a final partial (< 7 byte) group', () => {
    expect(unpack7BitSafe([0x01, 0x05])).toEqual([0x85]);
  });

  it('accepts a start offset, ignoring bytes before it', () => {
    expect(unpack7BitSafe([0xff, 0xff, 0x00, 0x36], 2)).toEqual([0x36]);
  });
});

describe('decodePresetParamValues (see docs/MIDI_MAPPING_NOTES.md)', () => {
  // Real opcode-0x41 page-1 payloads from a real NanoCore (direct python-rtmidi reads), with the
  // expected normalized values taken from the official app's bundled factory_presets.json.
  const SLOT0_CLNARP_P1 = hex(
    'f0 7d 4e 43 71 40 02 01 00 41 00 00 4d 10 00 00 00 00 7f 00 01 00 02 07 00 02 10 43 6c 00 6e 41 72 70 00 00 00 00 00 00 00 60 13 03 40 00 03 08 00 01 02 03 04 00 05 06 07 10 23 00 07 30 03 01 06 00 36 73 1d 00 3f 01 00 00 00 00 02 01 6c 51 38 3e 03 29 5c 09 0f 3d 04 38 1e 05 3e 04 05 52 38 1e 3f 10 14 00 01 08 00 00 03 00 00 00 00 00 3f 01 00 00 00 0c 3f 02 4d 4c 4c 3f 10 00 1e 02 01 00 01 05 00 03 1a 19 19 3f 01 00 00 10 00 3f 02 1f 05 2b 3f 44 03 0a 57 63 3f 04 4d 01 4c 4c 3f 10 0f 03 02 30 00 01 02 00 4d 4c 0c 00 3f 01 33 33 33 3f 10 00 19 04 05 00 00 04 00 63 1a 19 19 3e 01 41 4a 00 21 3f 02 00 00 00 3f 06 03 1a 19 19 3f 10 0f 00 05 04 00 01 02 00 5c 73 0f 42 3e 01 4d 4c 4c 00 3e 10 1e 06 03 01 01 00 05 00 7b 14 2e 3e 01 01 6c 51 38 f7',
  );
  const SLOT0_CLNARP_P2 = hex(
    'f0 7d 4e 43 71 00 02 01 00 41 00 00 3c 14 00 00 48 00 7f 00 3e 40 02 71 3d 4a 3f 03 4d 01 4c 4c 3e 04 7b 14 2e 00 3e 10 19 07 06 00 00 00 04 00 00 00 00 3f 01 00 00 00 00 3f 02 00 00 00 00 3f 03 00 00 00 3f 00 22 01 54 20 01 05 21 00 01 04 24 01 1e f7',
  );
  // slot 19 "AutoWah": FX1 Compressor (all 6 params incl makeup) + FX2 v10 (Wah) whose pinned
  // last param isn't stored — exercises both the full-length and short-list paths.
  const SLOT19_AUTOWAH_P1 = hex(
    'f0 7d 4e 43 71 40 02 01 00 41 00 00 4d 00 00 13 00 00 09 01 01 00 02 07 00 02 10 41 75 00 74 6f 57 61 68 00 00 00 00 00 00 60 13 03 40 00 03 08 00 01 02 03 04 00 05 06 07 10 23 00 07 30 03 01 06 00 03 40 2a 0c 3f 01 41 4a 21 3e 02 60 00 00 00 00 03 4d 4c 38 4c 3d 04 4d 4c 4c 3d 02 05 2e 47 61 3f 10 1e 00 01 08 0a 01 05 00 14 31 2e 07 3f 01 1a 19 19 1c 3f 02 65 50 22 3e 03 60 00 00 00 3f 04 4d 4c 00 4c 3f 10 1e 02 01 00 00 01 05 00 00 00 00 3f 06 01 1a 19 19 3f 02 00 20 00 00 3f 03 48 61 3a 0c 3f 04 4d 4c 4c 3f 10 00 0f 03 02 00 01 02 00 00 00 00 00 3f 01 66 66 00 26 3f 10 19 04 05 00 18 00 04 00 1a 19 19 3e 06 01 41 4a 21 3f 02 00 30 00 00 3f 03 1a 19 19 00 3f 10 0f 05 04 00 00 00 02 00 00 00 00 3f 01 00 00 00 00 3f 10 1e 06 00 03 06 00 f7',
  );
  const SLOT19_AUTOWAH_P2 = hex(
    'f0 7d 4e 43 71 00 02 01 00 41 00 00 46 04 00 13 48 00 09 01 05 06 00 4d 4c 0c 3f 01 00 70 00 40 3f 02 4d 4c 4c 14 3e 03 38 1e 05 3e 04 00 00 00 00 3f 10 19 07 00 06 00 00 04 00 00 00 00 00 3f 01 00 00 00 3f 00 02 00 00 00 3f 03 00 00 00 00 3f 22 01 55 20 00 01 05 21 01 04 24 01 01 7f f7',
  );

  const near = (got: number[], want: number[]) => {
    expect(got.length).toBe(want.length);
    got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 3));
  };

  it('decodes all 8 blocks\' on/off + normalized params from a real two-page response', () => {
    const byId = Object.fromEntries(
      decodePresetParamValues(SLOT0_CLNARP_P1, SLOT0_CLNARP_P2).map((b) => [b.blockId, b]),
    );
    // On/off (content byte 3) — matches factory_presets.json for slot 0 "ClnArp" exactly.
    expect(Object.fromEntries(Object.values(byId).map((b) => [b.blockId, b.on]))).toEqual({
      fx1: true, fx2: false, amp: true, cab: true, del: false, mod: true, rev: true, eq: false,
    });
    near(byId.fx1.values, [0.617, 0.0, 0.18, 0.07, 0.13, 0.62]);
    near(byId.fx2.values, [0.5, 0.5, 0.8]);
    near(byId.amp.values, [0.6, 0.5, 0.67, 0.89, 0.8]);
    near(byId.cab.values, [0.55, 0.7]);
    near(byId.del.values, [0.15, 0.632, 0.5, 0.6]);
    near(byId.mod.values, [0.38, 0.4]);
    near(byId.rev.values, [0.17, 0.18, 0.79, 0.2, 0.17]); // straddles the page-1/page-2 boundary
    // EQ is entirely in page 2; it stores one extra trailing value beyond its band gains (always
    // 0.5 in the factory presets — an output level or unexposed band the editor doesn't model).
    near(byId.eq.values, [0.5, 0.5, 0.5, 0.5]);
  });

  it('returns only the parameters actually stored (FX2 Wah pins and omits its last)', () => {
    const byId = Object.fromEntries(
      decodePresetParamValues(SLOT19_AUTOWAH_P1, SLOT19_AUTOWAH_P2).map((b) => [b.blockId, b]),
    );
    near(byId.fx1.values, [0.667, 0.158, 0.0, 0.05, 0.1, 0.88]); // Compressor, all 6 incl makeup
    near(byId.fx2.values, [0.53, 0.6, 0.318, 0.5, 0.8]); // 5 of Wah's 6 — the pinned last is absent
    near(byId.rev.values, [0.55, 0.75, 0.4, 0.26, 0.5]);
  });

  it('carries the selected variant (REV serialization skips internal id 4)', () => {
    const byId = Object.fromEntries(
      decodePresetParamValues(SLOT19_AUTOWAH_P1, SLOT19_AUTOWAH_P2).map((b) => [b.blockId, b]),
    );
    expect(byId.fx1.variant).toBe(3); // Compressor
    expect(byId.fx2.variant).toBe(10); // Wah
    expect(byId.rev.variant).toBe(6); // internal id — the editor's CC id for this is 6 - 1 = 5
  });

  it('without page 2, blocks whose params run past the page boundary come back truncated', () => {
    const byId = Object.fromEntries(decodePresetParamValues(SLOT0_CLNARP_P1).map((b) => [b.blockId, b]));
    near(byId.fx1.values, [0.617, 0.0, 0.18, 0.07, 0.13, 0.62]); // fully in page 1, unaffected
    expect(byId.rev.values.length).toBeLessThan(5); // only the params that fit in page 1
    expect(byId.eq).toBeUndefined(); // entirely in page 2
  });

  it('returns [] for a payload without the param-stream anchor', () => {
    expect(decodePresetParamValues(hex('f0 7d 4e 43 71 00 f7'))).toEqual([]);
  });
});

describe('decodeLiveBlockParams (opcode 0x63, LIVE state — see docs/MIDI_MAPPING_NOTES.md)', () => {
  // Real hardware, 2026-09-13: FX1 = Compressor, Threshold live-set to two different known
  // values via buildSetParamValueSysEx (0x6d) in between reads — everything else untouched.
  const LIVE_FX1_COMPRESSOR = hex(
    'f0 7d 4e 43 71 40 02 02 00 63 00 00 20 00 00 03 2e 54 01 03 06 06 6d 67 7b 3d 00 00 00 02 00 6c 51 38 3e 29 5c 05 0f 3d 38 1e 05 3e 52 01 38 1e 3f 00 00 03 00 00 00 00 3f 00 00 00 3f 03 4d 4c 4c 3f 01 00 05 01 6e 7c 3f 3f 00 00 00 44 3f 1f 05 2b 3f 0a 57 0c 63 3f 4d 4c 4c 3f 01 0c 00 02 4d 4c 0c 3f 33 40 33 33 3f 00 00 04 1a 19 19 19 3e 41 4a 21 3f 30 00 00 00 3f 1a 19 19 60 3f 01 00 02 5c 0f 42 0e 3e 4d 4c 4c 3e 01 01 20 05 7b 14 2e 3e 6c 51 40 38 3e 71 3d 4a 3f 4d 01 4c 4c 3e 7b 14 2e 3e 00 00 00 04 00 00 00 3f 00 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 08 00 00 01 02 03 04 05 06 07 f7',
  );
  // Same live session: FX2's type switched to id 7 via CC and turned on (FX1 = Compressor still,
  // with Threshold/Ratio now holding the two values set live just before this read).
  const LIVE_FX2_TYPE7 = hex(
    'f0 7d 4e 43 71 40 02 01 00 63 00 00 18 00 00 03 2e 54 01 03 06 52 12 03 60 3f 7a 7e 2a 02 3e 6c 51 38 3e 29 5c 05 0f 3d 38 1e 05 3e 52 01 38 1e 3f 01 07 01 00 40 00 00 3f 01 00 05 6e 00 7c 3f 3f 00 00 00 3f 22 1f 05 2b 3f 0a 57 63 06 3f 4d 4c 4c 3f 01 00 06 02 4d 4c 0c 3f 33 33 60 33 3f 00 00 04 1a 19 0c 19 3e 41 4a 21 3f 00 18 00 00 3f 1a 19 19 3f 30 01 00 02 5c 0f 42 3e 07 4d 4c 4c 3e 01 01 05 10 7b 14 2e 3e 6c 51 38 60 3e 71 3d 4a 3f 4d 4c 00 4c 3e 7b 14 2e 3e 00 00 00 04 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 08 00 01 00 02 03 04 05 06 07 f7',
  );
  // Same live session: FX1 switched to Gate (2 params, not Compressor's 6) and turned on.
  const LIVE_FX1_GATE = hex(
    'f0 7d 4e 43 71 40 02 01 00 63 00 00 08 00 00 03 2e 54 01 00 02 63 4d 4c 4c 3e 21 30 72 00 3e 01 07 01 00 00 00 10 3f 01 00 05 6e 7c 3f 40 3f 00 00 00 3f 1f 05 48 2b 3f 0a 57 63 3f 4d 41 4c 4c 3f 01 00 02 4d 01 4c 0c 3f 33 33 33 3f 18 00 00 04 1a 19 19 3e 03 41 4a 21 3f 00 00 00 06 3f 1a 19 19 3f 01 00 6c 02 5c 0f 42 3e 4d 4c 01 4c 3e 01 01 05 7b 14 04 2e 3e 6c 51 38 3e 71 18 3d 4a 3f 4d 4c 4c 3e 00 7b 14 2e 3e 00 00 04 00 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 08 00 01 02 03 00 04 05 06 07 f7',
  );

  const near = (got: number[], want: number[]) => {
    expect(got.length).toBe(want.length);
    got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 3));
  };

  it('decodes FX1 Compressor (6 params) plus the other 7 blocks, all with plausible on/type/values', () => {
    const byId = Object.fromEntries(decodeLiveBlockParams(LIVE_FX1_COMPRESSOR).map((b) => [b.blockId, b]));
    expect(byId.fx1.variant).toBe(3); // Compressor
    near(byId.fx1.values, [0.123, 0.0, 0.18, 0.07, 0.13, 0.62]); // Threshold live-set to ~0.123456
    expect(byId.amp.on).toBe(true);
    expect(byId.amp.values.length).toBe(5); // AMP's 5 commonParams
    expect(byId.cab.on).toBe(true);
    expect(byId.cab.values.length).toBe(2); // CAB's 2 commonParams
  });

  it('FX1 Threshold changing live shows up immediately, byte-exact to the value just set', () => {
    const byId = Object.fromEntries(decodeLiveBlockParams(LIVE_FX2_TYPE7).map((b) => [b.blockId, b]));
    near(byId.fx1.values, [0.877, 0.333, 0.18, 0.07, 0.13, 0.62]); // Threshold->0.876543, Ratio->0.333333
  });

  it("FX2's live type switch (via CC) and on/off show up in the same block position", () => {
    const byId = Object.fromEntries(decodeLiveBlockParams(LIVE_FX2_TYPE7).map((b) => [b.blockId, b]));
    expect(byId.fx2.on).toBe(true);
    expect(byId.fx2.variant).toBe(7); // set live via CC41=7
    expect(byId.fx2.values.length).toBe(1); // this FX2 type's own param count
  });

  it("FX1's param count follows its own live type, not a fixed 6 — Gate has 2, not Compressor's 6", () => {
    const byId = Object.fromEntries(decodeLiveBlockParams(LIVE_FX1_GATE).map((b) => [b.blockId, b]));
    expect(byId.fx1.variant).toBe(0); // Gate
    expect(byId.fx1.values.length).toBe(2);
    expect(byId.fx1.on).toBe(true);
  });

  it('returns [] for a payload too short to contain a usable preamble', () => {
    expect(decodeLiveBlockParams(hex('f0 7d 4e 43 71 00 f7'))).toEqual([]);
  });

  // Real hardware, 2026-09-13 (same session): AMP's model set live to id 9 via
  // buildSetFieldSysEx(SYSEX_FIELD.AMP_MODEL) and acked by the device — but its `variant` byte
  // here stayed 0 regardless (confirmed across several different attempted ids, not just this
  // one), while its own param values (gain, already live-set to 0.777 in an earlier step of the
  // same session) tracked correctly in this very response. See `decodeLiveBlockParams`'s doc
  // comment: this response genuinely doesn't carry AMP/CAB's live model index anywhere, not a
  // decode-offset bug — `store/patchStore.ts` deliberately doesn't trust this field for them.
  const LIVE_AMP_MODEL_ATTEMPT = hex(
    'f0 7d 4e 43 71 40 02 3d 00 63 00 00 20 00 00 03 2e 54 01 03 06 06 37 09 41 3e 00 00 00 02 00 6c 51 38 3e 29 5c 05 0f 3d 38 1e 05 3e 52 01 38 1e 3f 01 00 03 64 00 3b 1f 3f 00 00 00 3f 03 4d 4c 4c 3f 01 00 05 02 79 69 46 3f 00 00 00 44 3f 1f 05 2b 3f 0a 57 0c 63 3f 4d 4c 4c 3f 01 0c 00 02 4d 4c 0c 3f 33 40 33 33 3f 01 04 03 4d 39 4c 4c 3e 70 27 06 3e 00 00 00 00 3f 01 02 03 33 63 25 1b 3e 67 7b 49 08 3f 33 33 33 3e 01 01 20 05 7b 14 2e 3e 6c 51 40 38 3e 71 3d 4a 3f 4d 01 4c 4c 3e 7b 14 2e 3e 00 00 00 04 00 00 00 3f 00 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 08 00 00 01 02 03 04 05 06 07 f7',
  );
  // Same session: MOD's type switched live to id 3 (a real, valid MOD type id) via CC45 — its
  // `variant` here DOES track correctly, confirming MOD (unlike AMP/CAB) genuinely exposes its
  // live type in this response.
  const LIVE_MOD_TYPE3 = hex(
    'f0 7d 4e 43 71 40 02 3e 00 63 00 00 28 00 00 03 2e 54 01 03 06 06 37 09 41 3e 00 00 00 02 00 6c 51 38 3e 29 5c 05 0f 3d 38 1e 05 3e 52 01 38 1e 3f 01 00 03 64 00 3b 1f 3f 00 00 00 3f 03 4d 4c 4c 3f 01 00 05 02 79 69 46 3f 00 00 00 44 3f 1f 05 2b 3f 0a 57 0c 63 3f 4d 4c 4c 3f 01 0c 00 02 4d 4c 0c 3f 33 40 33 33 3f 01 04 03 4d 39 4c 4c 3e 70 27 06 3e 00 00 00 00 3f 01 03 05 34 00 00 00 3e 1a 19 19 00 3f 00 00 00 00 00 00 10 00 00 00 00 00 3f 01 40 01 05 7b 14 2e 3e 6c 00 51 38 3e 71 3d 4a 3f 03 4d 4c 4c 3e 7b 14 2e 00 3e 00 00 04 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 08 00 00 01 02 03 04 05 06 00 07 f7',
  );

  it("AMP's live model attempt never moves its variant byte, even though its own param values do track live", () => {
    const byId = Object.fromEntries(decodeLiveBlockParams(LIVE_AMP_MODEL_ATTEMPT).map((b) => [b.blockId, b]));
    expect(byId.amp.variant).toBe(0); // stuck, despite setting model id 9 moments before this read
    near(byId.amp.values, [0.777, 0.5, 0.67, 0.89, 0.8]); // gain (live-set earlier) still tracks correctly
  });

  it('MOD, unlike AMP/CAB, genuinely exposes its live type switch', () => {
    const byId = Object.fromEntries(decodeLiveBlockParams(LIVE_MOD_TYPE3).map((b) => [b.blockId, b]));
    expect(byId.mod.variant).toBe(3); // set live via CC45=3, a real MOD type id
    expect(byId.mod.on).toBe(true);
  });

  // Real hardware, 2026-09-13 (same session): MOD Phaser II — documented as fully CC-dead — set
  // all 4 params live via buildSetParamValueSysEx and read them back landing exactly, confirming
  // (like Motion Wah before it) this is a SysEx-only type, not a genuine firmware limitation.
  const LIVE_PHASER_II_ALL_SET = hex(
    'f0 7d 4e 43 71 40 02 18 00 63 00 00 2c 00 00 03 29 64 00 00 02 63 4d 4c 4c 3e 21 30 72 00 3e 00 00 03 00 00 00 60 3f 00 00 00 3f 4d 4c 00 4c 3f 00 00 05 00 00 01 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 03 4d 4c 4c 3f 00 00 02 40 00 00 00 00 00 00 00 20 3f 00 00 04 0a 57 23 02 3e 2e 47 01 3f 66 66 18 26 3f 5c 0f 42 3e 01 40 0c 04 66 66 66 3f 4d 01 4c 4c 3f 33 33 33 3f 03 1a 19 19 3f 00 06 05 03 4d 4c 0c 3f 00 00 40 2e 3f 4d 4c 4c 3e 38 1e 01 05 3e 00 00 00 3f 00 00 02 09 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 08 00 01 02 00 03 04 05 06 07 f7',
  );
  // Same session: MOD Jet Flanger — Feedback/Phase/Mix documented as CC-dead — set live via
  // SysEx and landed exactly, same fix as Phaser II above.
  const LIVE_JET_FLANGER_FPM_SET = hex(
    'f0 7d 4e 43 71 40 02 1c 00 63 00 00 30 00 00 03 29 64 00 00 02 63 4d 4c 4c 3e 21 30 72 00 3e 00 00 03 00 00 00 60 3f 00 00 00 3f 4d 4c 00 4c 3f 00 00 05 00 00 01 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 03 4d 4c 4c 3f 00 00 02 40 00 00 00 00 00 00 00 20 3f 00 00 04 0a 57 23 02 3e 2e 47 01 3f 66 66 18 26 3f 5c 0f 42 3e 01 18 11 05 17 59 4e 3d 33 00 33 33 3f 66 66 66 3f 03 4d 4c 4c 3f 33 33 33 30 3f 00 06 05 4d 4c 0c 60 3f 00 00 40 3f 4d 4c 15 4c 3e 38 1e 05 3e 00 00 00 00 3f 00 02 09 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 00 00 00 3f 00 00 00 3f 00 08 00 01 02 03 04 05 00 06 07 f7',
  );

  it('MOD Phaser II is fully SysEx-controllable, not CC-dead-and-inert as its old warning claimed', () => {
    const byId = Object.fromEntries(decodeLiveBlockParams(LIVE_PHASER_II_ALL_SET).map((b) => [b.blockId, b]));
    expect(byId.mod.variant).toBe(12);
    expect(byId.mod.on).toBe(true);
    near(byId.mod.values, [0.9, 0.8, 0.7, 0.6]); // Depth/Rate/Feedback/Mix, each set live moments before
  });

  it("MOD Jet Flanger's Feedback/Phase/Mix are SysEx-controllable too (Rate/Depth already worked via CC)", () => {
    const byId = Object.fromEntries(decodeLiveBlockParams(LIVE_JET_FLANGER_FPM_SET).map((b) => [b.blockId, b]));
    expect(byId.mod.variant).toBe(17);
    near(byId.mod.values, [0.101, 0.7, 0.9, 0.8, 0.7]); // Rate/Depth untouched, Feedback/Phase/Mix set live
  });
});

describe('parseGlobalSettingsResponse / parseGlobalSettingsPush (Global.mmon, see MIDI_MAPPING_NOTES.md)', () => {
  it('decodes a poll reply (the very first one, before anything was changed)', () => {
    const reply = hex('f0 7d 4e 43 71 00 02 6e 00 65 00 00 07 00 00 01 00 01 00 64 64 00 00 f7');
    expect(parseGlobalSettingsResponse(reply)).toEqual({
      wireless: false,
      loopback: true,
      inputGainDb: 0,
      usbVolume: 100,
      btVolume: 100,
      midiChannel: 0,
    });
    expect(parseGlobalSettingsResponse(reply.slice(1, -1))).toEqual(parseGlobalSettingsResponse(reply)); // stripped too
  });

  it('decodes a set-response with every field changed from default', () => {
    // Real state after the full Global.mmon sequence: wireless off, loopback on, gain -5dB,
    // USB 100%, BT 100%, MIDI channel 16.
    const reply = hex('f0 7d 4e 43 71 00 02 28 01 66 00 00 07 10 00 01 00 01 7b 64 64 00 10 f7');
    expect(parseGlobalSettingsResponse(reply)).toEqual({
      wireless: false,
      loopback: true,
      inputGainDb: -5,
      usbVolume: 100,
      btVolume: 100,
      midiChannel: 16,
    });
  });

  it('returns null for a message that is not a global-settings response', () => {
    expect(parseGlobalSettingsResponse(hex('f0 7d 4e 43 71 00 02 01 00 68 00 00 04 08 00 02 01 08 13 f7'))).toBeNull();
  });

  it('decodes the unsolicited push at its own (shorter) offsets, and rejects the other shape', () => {
    // From Nanocore, dir=0x72, right after Input Gain was set to -5:
    const push = hex('f0 7d 4e 43 72 00 02 55 00 07 00 01 00 02 01 7b 64 64 00 f7');
    expect(parseGlobalSettingsPush(push)).toEqual({
      wireless: false,
      loopback: true,
      inputGainDb: -5,
      usbVolume: 100,
      btVolume: 100,
      midiChannel: 0,
    });
    expect(parseGlobalSettingsResponse(push)).toBeNull(); // wrong shape for the poll/set parser
  });
});
